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

const messageQueue = [];

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
// rotates every ~20-30s and can be scanned a generation too late, this asks
// WhatsApp to generate an 8-character code tied to a specific phone number,
// which you type into WhatsApp (Linked Devices → Link with phone number
// instead) rather than scanning anything. There's nothing to go stale
// between "the server generated it" and "the phone used it," so it sidesteps
// the QR-rotation timing issue entirely. Can only be requested while the
// socket exists and hasn't completed pairing yet.
async function requestPairingCode(phoneNumber) {
  if (!sock) throw new Error("socket-not-initialized");
  if (socketReady) throw new Error("already-connected");

  const normalized = normalizePhone(phoneNumber);
  if (!normalized) throw new Error("invalid-phone");

  const code = await sock.requestPairingCode(normalized);
  console.log(`🔗 Pairing code requested for ${normalized}: ${code}`);
  return code;
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
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

    if (connection === "open") {
      console.log("✅ WhatsApp connected successfully!");
      socketReady = true;
      qrBase64 = null;
      qrGeneratedAt = null;

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
          "triggered WhatsApp's abuse detection, or (b) the auth state is stale. " +
          "Run 'npm run clean:sessions' and wait a few minutes before trying again.",
        );
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
