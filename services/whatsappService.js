// backend/services/whatsappService.js
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const pino = require("pino");

let sock = null;
let qrBase64 = null;
let socketReady = false;
let initializing = false;

let serviceInstance = null;

async function createWhatsAppService() {
  if (serviceInstance) return serviceInstance;

  serviceInstance = initializeWhatsApp();
  return serviceInstance;
}

async function initializeWhatsApp() {
  if (initializing) return { getQR, getStatus, sendMessage };
  initializing = true;

  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),   // ✅ FIXED
    browser: Browsers.macOS("Desktop"),
    syncFullHistory: false
  });

  console.log("🚀 WhatsApp socket initialized");

  sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      qrBase64 = await QRCode.toDataURL(qr);
      console.log("📱 QR Generated");
      socketReady = false;
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connected successfully!");
      socketReady = true;
      qrBase64 = null;
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log("⚠️ WhatsApp disconnected:", code);

      socketReady = false;

      if (code !== DisconnectReason.loggedOut) {
        console.log("♻️ Reconnecting in 5 seconds...");

        setTimeout(() => {
          serviceInstance = null;
          createWhatsAppService();
        }, 5000);
      }
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
    hasQR: !!qrBase64
  };
}

async function sendMessage(phone, message) {
  if (!socketReady || !sock) {
    return { success: false, error: "WhatsApp socket not ready" };
  }

  try {
    let num = phone.replace(/\D/g, "").replace(/^0/, "");
    const jid = `92${num}@s.whatsapp.net`;

    await sock.sendMessage(jid, { text: message });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = createWhatsAppService;
