// backend/services/whatsappService.js
//
// Ported from the desktop billing app's proven whatsapp-web.js
// implementation (src/services/whatsappService.js in ISP-Customer-Billing),
// which drives a real headless Chrome session against web.whatsapp.com --
// exactly like scanning a QR in an actual browser. This sidesteps every
// protocol-level version-matching/pairing-code issue that the previous
// Baileys-based implementation kept hitting (stale bundled WA-web
// versions, QR rotation timing, pairing-code socket-state races, etc.),
// since a real browser always negotiates its own compatible version with
// WhatsApp's servers the same way the actual WhatsApp Web site does.
//
// Kept the exact same exported interface (getQR, getStatus, sendMessage,
// sendDocument) as the old service so routes/whatsappRoutes.js and the
// mobile app's polling of /api/whatsapp/status and /api/whatsapp/qr don't
// need any changes.
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");

const AUTH_DIR = path.resolve(__dirname, "../.wwebjs_auth");

let client = null;
let isReady = false;
let qrDataUrl = null;
let qrGeneratedAt = null;
let qrCount = 0;
let initializing = false;
let serviceInstance = null;

const messageQueue = [];

// NORMALIZE PHONE (same rules as before, output format changes to match
// whatsapp-web.js's @c.us JID suffix instead of Baileys' @s.whatsapp.net)
function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.toString().replace(/\D/g, "");
  cleaned = cleaned.replace(/^0+/, "");
  if (!cleaned.startsWith("92") && cleaned.length === 10) {
    cleaned = "92" + cleaned;
  }
  if (cleaned.length !== 12) return null;
  return cleaned;
}

function toChatId(normalizedPhone) {
  return `${normalizedPhone}@c.us`;
}

// --------------------------------------------------------------------------------------
// SEND TEXT NOW
// --------------------------------------------------------------------------------------
async function _sendNow(phone, message) {
  if (!client || !isReady) throw new Error("socket-not-ready");

  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error("invalid-phone");

  return client.sendMessage(toChatId(normalized), message);
}

// --------------------------------------------------------------------------------------
// PUBLIC API: SEND MESSAGE (QUEUE IF NEEDED)
// --------------------------------------------------------------------------------------
function sendMessage(phone, message, { queueIfNotReady = true } = {}) {
  return new Promise(async (resolve, reject) => {
    const normalized = normalizePhone(phone);
    if (!normalized) return reject(new Error("invalid-phone"));

    if (!client || !isReady) {
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
  if (!client || !isReady) throw new Error("socket-not-ready");

  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error("invalid-phone");
  if (!fs.existsSync(filePath)) throw new Error("File does not exist: " + filePath);

  const media = MessageMedia.fromFilePath(filePath);
  if (fileName) media.filename = fileName;

  return client.sendMessage(toChatId(normalized), media);
}

// --------------------------------------------------------------------------------------
async function flushQueue() {
  if (!isReady) return;

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

async function destroyClient() {
  if (client) {
    try {
      await client.destroy();
    } catch (error) {
      console.error("Error destroying client:", error.message);
    }
    client = null;
  }
}

// --------------------------------------------------------------------------------------
// INITIALIZE WHATSAPP CLIENT
// --------------------------------------------------------------------------------------
function initializeWhatsApp() {
  if (initializing) return { getQR, getStatus, sendMessage, sendDocument };
  initializing = true;

  console.log("🔄 Initializing WhatsApp client (whatsapp-web.js, real browser session)...");

  client = new Client({
    authStrategy: new LocalAuth({
      clientId: "isp-os-backend",
      dataPath: AUTH_DIR,
    }),
    puppeteer: {
      headless: true,
      // Standard server-safe flags for running headless Chromium without a
      // display and with restricted permissions (matches what already
      // works in the desktop app's own Puppeteer config).
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
      // No executablePath override here (unlike the desktop app, which
      // points at an installed Google Chrome) — this server has no
      // desktop browser installed, so we rely on Puppeteer's own bundled
      // Chromium, downloaded automatically on `npm install`.
    },
    // Deliberately NOT pinning webVersionCache to a specific remote HTML
    // snapshot (the desktop app pins one, copied here initially). WhatsApp
    // periodically stops serving old web-client versions; when that
    // happens the page authenticates against locally stored session data
    // but then WhatsApp's servers reject the stale client build, so
    // whatsapp-web.js reloads the page and re-authenticates in an endless
    // loop — which is exactly what was observed (7+ repeated
    // "authenticated" events, climbing CPU, never reaching "ready").
    // Leaving webVersionCache unset makes it fetch whatever version
    // web.whatsapp.com is actually serving right now, the same fix
    // already applied to the Baileys attempt for the identical failure
    // mode.
  });

  client.on("qr", async (qr) => {
    qrDataUrl = await QRCode.toDataURL(qr);
    qrGeneratedAt = Date.now();
    qrCount += 1;
    isReady = false;
    console.log(`📱 QR #${qrCount} generated at`, new Date(qrGeneratedAt).toISOString());
  });

  client.on("ready", () => {
    console.log("✅ WhatsApp client is ready!");
    isReady = true;
    qrDataUrl = null;
    qrGeneratedAt = null;
    flushQueue();
  });

  client.on("authenticated", () => {
    console.log("✅ WhatsApp client authenticated!");
  });

  client.on("auth_failure", (msg) => {
    console.error("❌ WhatsApp authentication failed:", msg);
    isReady = false;
  });

  client.on("disconnected", (reason) => {
    console.log("❌ WhatsApp client disconnected:", reason);
    isReady = false;
    qrDataUrl = null;
    qrGeneratedAt = null;

    setTimeout(() => {
      console.log("♻️ Attempting to reconnect WhatsApp...");
      destroyClient().then(() => {
        serviceInstance = initializeWhatsApp();
      });
    }, 5000);
  });

  client.on("loading_screen", (percent, message) => {
    console.log(`📱 WhatsApp loading: ${percent}% ${message}`);
  });

  client
    .initialize()
    .then(() => console.log("✅ WhatsApp client initialization started"))
    .catch((error) => console.error("❌ WhatsApp client initialization failed:", error.message));

  initializing = false;

  return { getQR, getStatus, sendMessage, sendDocument };
}

// --------------------------------------------------------------------------------------
// HELPERS RETURNED TO ROUTES
// --------------------------------------------------------------------------------------
function getQR() {
  return qrDataUrl;
}

function getStatus() {
  return {
    isConnected: isReady,
    socketReady: isReady,
    hasQR: !!qrDataUrl,
    qrAgeSeconds: qrGeneratedAt ? Math.round((Date.now() - qrGeneratedAt) / 1000) : null,
    qrCount,
  };
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
