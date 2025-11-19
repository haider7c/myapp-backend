// backend/services/whatsappService.js
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const pino = require("pino");
const path = require("path");
const fs = require("fs");

const AUTH_DIR = path.resolve(__dirname, "../.auth_whatsapp"); // persist this folder

// ensure auth dir exists
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

let sock = null;
let qrBase64 = null;
let socketReady = false;
let initializing = false;
let serviceInstance = null;

const messageQueue = []; // { phone, message, resolve, reject }

function normalizePhone(phone) {
  if (!phone) return null;
  let num = phone.toString().trim().replace(/\D/g, ""); // remove non-digits

  // drop leading '+' if any (already removed by regex)
  // If starts with '0' and length 11 -> convert to 92...
  if (num.startsWith("0") && num.length === 11) {
    return "92" + num.substring(1);
  }

  // If length 10 (e.g. 3001234567) -> add 92
  if (num.length === 10) return "92" + num;

  // If already has 92 and length 12 -> keep
  if (num.startsWith("92") && num.length === 12) return num;

  // If user accidentally passed '00300...' handle it
  if (num.startsWith("00") && num.length >= 12 && num.startsWith("0092")) {
    return num.replace(/^00/, "");
  }

  // otherwise invalid
  return null;
}

async function createWhatsAppService() {
  if (serviceInstance) return serviceInstance;
  serviceInstance = initializeWhatsApp();
  return serviceInstance;
}

async function initializeWhatsApp() {
  // if already in flight, return the public API (it will be filled)
  if (initializing) return { getQR, getStatus, sendMessage };
  initializing = true;

  // create auth state inside persistent folder
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: Browsers.macOS("FriendliAI-desktop"),
    printQRInTerminal: false,
    syncFullHistory: false,
  });

  console.log("🚀 WhatsApp socket initialized");

  // connection updates
  sock.ev.on("connection.update", async (update) => {
    try {
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
        // flush queued messages
        flushQueue();
      }

      if (connection === "close") {
        const reasonCode =
          lastDisconnect?.error?.output?.statusCode ||
          lastDisconnect?.error?.message ||
          "unknown";
        console.log("⚠️ WhatsApp disconnected:", reasonCode);
        socketReady = false;

        // if not logged out, try reconnect after a short delay
        if (reasonCode !== DisconnectReason.loggedOut) {
          console.log("♻️ Reconnecting in 5s...");
          setTimeout(() => {
            serviceInstance = null;
            initializeWhatsApp().catch((e) =>
              console.error("reconnect init error:", e)
            );
          }, 5000);
        } else {
          console.log(
            "🚫 Logged out. Remove auth files and re-scan QR to reconnect."
          );
        }
      }
    } catch (e) {
      console.error("connection.update handler error:", e);
    }
  });

  sock.ev.on("creds.update", saveCreds);

  initializing = false;

  return { getQR, getStatus, sendMessage };
}

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

async function flushQueue() {
  if (!socketReady || !sock) return;
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

async function _sendNow(phone, message) {
  if (!sock || !socketReady) throw new Error("socket-not-ready");
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error("invalid-phone");
  const jid = `${normalized}@s.whatsapp.net`;
  // send text
  return sock.sendMessage(jid, { text: message });
}

function sendMessage(phone, message, { queueIfNotReady = true } = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const normalized = normalizePhone(phone);
      if (!normalized) return reject(new Error("invalid-phone"));

      if (!socketReady || !sock) {
        if (queueIfNotReady) {
          // push to queue and resolve after send
          messageQueue.push({
            phone,
            message,
            resolve,
            reject,
          });
          return;
        } else {
          return reject(new Error("socket-not-ready"));
        }
      }

      // send immediately
      try {
        await _sendNow(phone, message);
        resolve({ success: true });
      } catch (err) {
        reject(err);
      }
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = createWhatsAppService;
