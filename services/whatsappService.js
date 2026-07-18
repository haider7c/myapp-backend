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
let socketReady = false;
let initializing = false;
let serviceInstance = null;

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
async function resolveWaVersion() {
  try {
    const result = await fetchLatestWaWebVersion({});
    if (result?.version) {
      console.log(
        `📦 Using live WhatsApp Web version: ${result.version.join(".")} (isLatest: ${result.isLatest})`,
      );
      return result.version;
    }
  } catch (error) {
    console.warn("⚠️  fetchLatestWaWebVersion failed, falling back:", error.message);
  }

  const fallback = await fetchLatestBaileysVersion();
  console.log(
    `📦 Using Baileys-pinned WhatsApp Web version: ${fallback.version.join(".")} (isLatest: ${fallback.isLatest})`,
  );
  return fallback.version;
}

// --------------------------------------------------------------------------------------
// INITIALIZE WHATSAPP SOCKET
// --------------------------------------------------------------------------------------
async function initializeWhatsApp() {
  if (initializing) return { getQR, getStatus, sendMessage, sendDocument };
  initializing = true;

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const version = await resolveWaVersion();

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
      console.log("📱 QR Generated");
      socketReady = false;
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connected successfully!");
      socketReady = true;
      qrBase64 = null;

      flushQueue();
    }

    if (connection === "close") {
      const reasonCode =
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.message ||
        "unknown";

      console.log("⚠️ WhatsApp disconnected:", reasonCode);
      socketReady = false;

      if (reasonCode !== DisconnectReason.loggedOut) {
        console.log("♻️ Reconnecting in 5 seconds...");
        setTimeout(() => {
          serviceInstance = null;
          initializeWhatsApp();
        }, 5000);
      } else {
        console.log("❌ Logged out. Delete .auth_whatsapp to reconnect.");
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  initializing = false;

  return { getQR, getStatus, sendMessage, sendDocument };
}

// --------------------------------------------------------------------------------------
// HELPERS RETURNED TO ROUTES
// --------------------------------------------------------------------------------------
function getQR() {
  return qrBase64;
}

function getStatus() {
  return {
    isConnected: socketReady,
    socketReady,
    hasQR: !!qrBase64,
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
