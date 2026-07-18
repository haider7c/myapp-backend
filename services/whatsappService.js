// backend/services/whatsappService.js
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  Browsers,
} = require("@whiskeysockets/baileys");

const QRCode = require("qrcode");
const pino = require("pino");
const path = require("path");
const fs = require("fs");

const AUTH_DIR = path.resolve(__dirname, "../.auth_whatsapp");

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

let sock = null;
let qrBase64 = null;
let qrGeneratedAt = null;
let qrCount = 0;
let socketReady = false;
let initializing = false;
let serviceInstance = null;
let reconnectTimer = null;

// Pairing-code request state. requestPairingCode() sets pendingPairingPhone
// and forces a brand new socket; the connection.update handler below is the
// only place that actually calls sock.requestPairingCode(), and only once
// the socket has reached a state where that call can succeed (per Baileys'
// own documented pattern: when connection === "connecting" or a qr has just
// been issued). This removes the need to guess/sleep for the right timing
// from the outside — calling requestPairingCode() too early against a socket
// whose transport isn't open yet is exactly what was failing with
// "Connection Closed" before.
let pendingPairingPhone = null;
let pairingCode = null;
let pairingCodeGeneratedAt = null;
let pairingCodeRequestedFor = null;
let pairingCodeError = null;

const messageQueue = [];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// NORMALIZE PHONE
function normalizePhone(phone) {
  if (!phone) return null;
  let num = phone.toString().trim().replace(/\D/g, "");

  if (num.startsWith("0") && num.length === 11) return "92" + num.substring(1);
  if (num.length === 10) return "92" + num;
  if (num.startsWith("92") && num.length === 12) return num;
  if (num.startsWith("0092")) return num.replace(/^00/, "");
  return null;
}

// --------------------------------------------------------------------------------------
// SEND TEXT NOW
// --------------------------------------------------------------------------------------
async function _sendNow(phone, message) {
  if (!sock || !socketReady) throw new Error("socket-not-ready");

  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error("invalid-phone");

  const jid = `${normalized}@s.whatsapp.net`;

  return sock.sendMessage(jid, { text: message });
}

// --------------------------------------------------------------------------------------
// PAIRING CODE (alternative to QR scanning)
// --------------------------------------------------------------------------------------
// WhatsApp's "Link with phone number" flow: instead of scanning a QR that
// rotates every ~20-30s, this asks WhatsApp to generate an 8-character code
// tied to a specific phone number, typed into WhatsApp (Linked Devices ->
// Link with phone number instead) rather than scanning anything.
//
// This forces a brand new socket generation and waits for the
// connection.update handler to actually fire the pairing request once the
// socket is in the right state, instead of calling
// sock.requestPairingCode() immediately against whatever socket happens to
// exist (which fails with "Connection Closed" if that socket's transport
// isn't currently open — exactly what happened when calling this right
// after a previous failed attempt left a dead socket behind).
async function requestPairingCode(phoneNumber) {
  const normalized = normalizePhone(phoneNumber);
  if (!normalized) throw new Error("invalid-phone");
  if (socketReady) throw new Error("already-connected");

  pendingPairingPhone = normalized;
  pairingCode = null;
  pairingCodeGeneratedAt = null;
  pairingCodeRequestedFor = null;
  pairingCodeError = null;

  // Detach the old socket's listeners before replacing it so a delayed
  // event from the previous (likely already-dead) connection can't fire
  // into this new attempt's state.
  if (sock?.ev) {
    sock.ev.removeAllListeners("connection.update");
    sock.ev.removeAllListeners("creds.update");
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  serviceInstance = initializeWhatsApp();
  await serviceInstance;

  const TIMEOUT_MS = 25000;
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    if (pairingCodeRequestedFor === normalized && pairingCode) {
      return pairingCode;
    }
    if (pairingCodeError) {
      throw new Error(pairingCodeError);
    }
    await delay(300);
  }
  throw new Error("timed-out-waiting-for-socket-to-be-ready");
}

// --------------------------------------------------------------------------------------
// PUBLIC API: SEND MESSAGE (QUEUE IF NEEDED)
// --------------------------------------------------------------------------------------
function sendMessage(phone, message, { queueIfNotReady = true } = {}) {
  return new Promise(async (resolve, reject) => {
    const normalized = normalizePhone(phone);
    if (!normalized) return reject(new Error("invalid-phone"));

    if (!sock || !socketReady) {
      if (queueIfNotReady) {
        messageQueue.push({ phone, message, resolve, reject });
        return;
      } else {
        return reject(new Error("socket-not-ready"));
      }
    }

    try {
      await _sendNow(phone, message);
      resolve({ success: true });
    } catch (err) {
      reject(err);
    }
  });
}

// --------------------------------------------------------------------------------------
// SEND DOCUMENT
// --------------------------------------------------------------------------------------
async function sendDocument(phone, filePath, fileName) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error("invalid-phone");
  if (!fs.existsSync(filePath)) throw new Error("File does not exist: " + filePath);

  const jid = `${normalized}@s.whatsapp.net`;

  return sock.sendMessage(jid, {
    document: fs.readFileSync(filePath),
    mimetype: "application/pdf",
    fileName,
  });
}

// --------------------------------------------------------------------------------------
// RESOLVE WA WEB VERSION TO CONNECT WITH
// --------------------------------------------------------------------------------------
// fetchLatestBaileysVersion() reads a version pinned in Baileys' own repo,
// which can lag behind what WhatsApp's web client is actually running. When
// that happens, WhatsApp lets the socket connect and generate a QR, but
// then refuses to finish linking a *new* device and the phone shows
// "Couldn't link device — An error occurred. Try again." — even though
// everything about the network/account is fine. fetchLatestWaWebVersion()
// asks WhatsApp's own web client directly for the version it's currently
// serving, which is what actually needs to match for new-device pairing to
// succeed. Fall back to fetchLatestBaileysVersion() only if that lookup
// itself fails (e.g. no outbound internet to web.whatsapp.com yet).
//
// This server has a known intermittent DNS issue (the same box occasionally
// fails SRV lookups for MongoDB Atlas with ESERVFAIL). If that flakiness
// also hits this HTTPS call, a single failed attempt would silently fall
// back to the stale bundled version and quietly reintroduce the exact
// "Couldn't link device" bug this function exists to avoid. Retry a few
// times with a short delay before giving up on the live lookup.
async function resolveWaVersion() {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await fetchLatestWaWebVersion({});
      if (result?.version) {
        console.log(
          `📦 Using live WhatsApp Web version: ${result.version.join(".")} (isLatest: ${result.isLatest})`,
        );
        return result.version;
      }
      throw new Error("fetchLatestWaWebVersion returned no version");
    } catch (error) {
      console.warn(
        `⚠️  fetchLatestWaWebVersion failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${error.message}`,
      );
      if (attempt < MAX_ATTEMPTS) {
        await delay(1500 * attempt);
      }
    }
  }

  const fallback = await fetchLatestBaileysVersion();
  console.warn(
    `📦 Live version lookup failed ${MAX_ATTEMPTS} times — falling back to Baileys-pinned ` +
    `version: ${fallback.version.join(".")} (isLatest: ${fallback.isLatest}). ` +
    `If linking fails again right after this message, the network path to ` +
    `web.whatsapp.com is the thing to fix, not the pairing logic.`,
  );
  return fallback.version;
}

// --------------------------------------------------------------------------------------
// INITIALIZE WHATSAPP SOCKET
// --------------------------------------------------------------------------------------
async function initializeWhatsApp() {
  if (initializing) return { getQR, getStatus, sendMessage, sendDocument, requestPairingCode };
  initializing = true;

  // Cancel any pending reconnect from a previous socket generation so we
  // never end up with two sockets racing to use the same auth directory
  // at once (that alone is enough to make WhatsApp invalidate one of them
  // with an immediate 401 after a seemingly successful pairing).
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const version = await resolveWaVersion();

  const authFiles = fs.existsSync(AUTH_DIR) ? fs.readdirSync(AUTH_DIR) : [];
  console.log(
    `🔑 Auth dir has ${authFiles.length} file(s) before connecting (creds present: ${authFiles.includes("creds.json")})`,
  );

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: Browsers.macOS("FriendliAI-desktop"),
    printQRInTerminal: false,
  });

  console.log("🚀 WhatsApp socket initialized");

  // --------------------------------------------------------------------------------------
  // CONNECTION EVENTS
  // --------------------------------------------------------------------------------------
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrBase64 = await QRCode.toDataURL(qr);
      qrGeneratedAt = Date.now();
      qrCount += 1;
      console.log(`📱 QR #${qrCount} generated at`, new Date(qrGeneratedAt).toISOString());
      socketReady = false;
    }

    if (connection === "connecting") {
      console.log("🔄 WhatsApp socket connecting...");
    }

    // Fire the pending pairing-code request the moment the socket is
    // actually in a state where WhatsApp will accept it — right as it
    // starts connecting, or as soon as a qr comes through (both signal the
    // transport is live and pre-auth).
    if ((connection === "connecting" || qr) && pendingPairingPhone && pairingCodeRequestedFor !== pendingPairingPhone) {
      try {
        const code = await sock.requestPairingCode(pendingPairingPhone);
        pairingCode = code;
        pairingCodeGeneratedAt = Date.now();
        pairingCodeRequestedFor = pendingPairingPhone;
        console.log(`🔗 Pairing code for ${pendingPairingPhone}: ${code}`);
      } catch (error) {
        pairingCodeError = error.message;
        console.error(`❌ Failed to request pairing code for ${pendingPairingPhone}:`, error.message);
      }
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connected successfully!");
      socketReady = true;
      qrBase64 = null;
      qrGeneratedAt = null;
      pendingPairingPhone = null;

      flushQueue();
    }

    if (connection === "close") {
      const reasonCode =
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.message ||
        "unknown";

      // Log the FULL error, not just the status code, so if WhatsApp sends
      // a human-readable reason (rate limiting, conflict, banned device,
      // etc.) we can actually see it instead of guessing from a number.
      console.log("⚠️ WhatsApp disconnected:", reasonCode);
      console.log(
        "⚠️ Full disconnect detail:",
        JSON.stringify(lastDisconnect?.error?.output?.payload || lastDisconnect?.error?.message || lastDisconnect?.error, null, 2),
      );
      socketReady = false;

      if (reasonCode !== DisconnectReason.loggedOut) {
        console.log("♻️ Reconnecting in 5 seconds...");
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          serviceInstance = initializeWhatsApp();
        }, 5000);
      } else {
        console.log("❌ Logged out (401). WhatsApp itself revoked this session.");
        console.log(
          "   This usually means either (a) too many linking attempts in a short window " +
          "triggered WhatsApp's abuse detection, or (b) the auth state was already stale.",
        );

        // Wipe the now-invalid credentials ourselves instead of relying on
        // someone remembering to run 'npm run clean:sessions' before the
        // next attempt. Leaving a revoked creds.json in place means the
        // very next boot tries to *resume* a session WhatsApp already
        // killed, which fails instantly with the same 401 before a new QR
        // or pairing code can even be issued - exactly what was happening
        // here. Not auto-reconnecting after this: if WhatsApp is actively
        // rate-limiting new links for this number, immediately retrying
        // would only make that worse.
        try {
          const files = fs.readdirSync(AUTH_DIR);
          for (const file of files) {
            fs.unlinkSync(path.join(AUTH_DIR, file));
          }
          console.log(`🧹 Cleared ${files.length} stale auth file(s) — next attempt starts fresh.`);
        } catch (cleanupError) {
          console.error("⚠️ Failed to auto-clear stale auth state:", cleanupError.message);
        }
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  initializing = false;

  return { getQR, getStatus, sendMessage, sendDocument, requestPairingCode };
}

// --------------------------------------------------------------------------------------
// HELPERS RETURNED TO ROUTES
// --------------------------------------------------------------------------------------
function getQR() {
  if (qrBase64 && qrGeneratedAt) {
    const ageSeconds = Math.round((Date.now() - qrGeneratedAt) / 1000);
    if (ageSeconds > 25) {
      console.warn(
        `⚠️  Serving QR #${qrCount} that is already ${ageSeconds}s old — Baileys rotates ` +
        `QR codes roughly every 20-30s, so this one may already be dead. If pairing keeps ` +
        `failing right after a scan, check how often the client re-fetches /qr.`,
      );
    }
  }
  return qrBase64;
}

function getStatus() {
  return {
    isConnected: socketReady,
    socketReady,
    hasQR: !!qrBase64,
    qrAgeSeconds: qrGeneratedAt ? Math.round((Date.now() - qrGeneratedAt) / 1000) : null,
    qrCount,
    pairingCodePending: !!pendingPairingPhone && !pairingCode,
  };
}

// --------------------------------------------------------------------------------------
async function flushQueue() {
  if (!socketReady) return;

  while (messageQueue.length > 0) {
    const job = messageQueue.shift();
    try {
      await _sendNow(job.phone, job.message);
      job.resolve({ success: true });
    } catch (err) {
      job.reject(err);
    }
  }
}

// --------------------------------------------------------------------------------------
// EXPORT SERVICE
// --------------------------------------------------------------------------------------
module.exports = async function createWhatsAppService() {
  if (!serviceInstance) {
    serviceInstance = initializeWhatsApp();
  }
  return serviceInstance;
};
