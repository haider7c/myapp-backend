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
//
// Handles a data-entry mistake that was silently breaking sends for some
// customers: staff sometimes save a number as "+92 0300-1234567" — country
// code AND the local leading 0 both present — which used to produce 13
// digits ("9203001234567") and get rejected outright as invalid, because
// the old code only stripped a leading zero at the very start of the
// string, not the one sitting right after "92". That number never even
// reached WhatsApp, even though the number itself is perfectly valid and
// registered.
function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.toString().replace(/\D/g, "");
  if (!cleaned) return null;

  // "0092..." international-dialing prefix -> "92..."
  if (cleaned.startsWith("00")) {
    cleaned = cleaned.slice(2);
  }

  // "920300XXXXXXX" (13 digits: country code + stray local 0 + 10-digit
  // subscriber number) -> drop the stray 0 right after the country code.
  if (cleaned.startsWith("920") && cleaned.length === 13) {
    cleaned = "92" + cleaned.slice(3);
  }

  // Local format ("0300XXXXXXX") -> strip the leading 0(s), then add 92.
  if (!cleaned.startsWith("92")) {
    cleaned = cleaned.replace(/^0+/, "");
    if (cleaned.length === 10) {
      cleaned = "92" + cleaned;
    }
  }

  if (!cleaned.startsWith("92") || cleaned.length !== 12) return null;
  return cleaned;
}

function toChatId(normalizedPhone) {
  return `${normalizedPhone}@c.us`;
}

// Resolves the actual WhatsApp ID for a normalized phone number instead of
// blindly guessing "<number>@c.us". This is what whatsapp-web.js itself
// recommends (Client.getNumberId) — it queries WhatsApp directly, so it
// (a) confirms the number is actually registered on WhatsApp, giving a
// clear "not registered" error instead of a silent no-op/failure, and
// (b) returns the real serialized ID for numbers where the guessed
// "<digits>@c.us" doesn't match what WhatsApp expects.
async function resolveChatId(normalizedPhone) {
  const numberId = await client.getNumberId(normalizedPhone);
  if (!numberId) {
    throw new Error(`Number is not registered on WhatsApp: ${normalizedPhone}`);
  }
  return numberId._serialized;
}

// --------------------------------------------------------------------------------------
// SEND TEXT NOW
// --------------------------------------------------------------------------------------
async function _sendNow(phone, message) {
  if (!client || !isReady) throw new Error("socket-not-ready");

  const normalized = normalizePhone(phone);
  if (!normalized) {
    console.error(`❌ WhatsApp send skipped — could not normalize phone: "${phone}"`);
    throw new Error("invalid-phone");
  }

  try {
    const chatId = await resolveChatId(normalized);
    return await client.sendMessage(chatId, message);
  } catch (err) {
    // Log the raw phone + normalized number alongside the real error so a
    // "some contacts don't get the message" report can be traced back to a
    // specific number/reason instead of a generic failure.
    console.error(`❌ WhatsApp send failed for "${phone}" (normalized: ${normalized}):`, err.message);
    throw err;
  }
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

  const chatId = await resolveChatId(normalized);
  return client.sendMessage(chatId, media);
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
    // This host also runs a full desktop Chrome session with many tabs
    // (confirmed via ps aux: 7+ renderer processes, ~2.5GB+ RSS), which
    // periodically starves the headless linking browser of CPU — observed
    // directly as irregular ~20s QR rotation ballooning to 60-71s gaps.
    // authTimeoutMs/qrMaxRetries are relaxed so a slow/contended machine
    // gets to actually finish the handshake instead of the library giving
    // up and cycling a fresh QR before the scan completes.
    authTimeoutMs: 0,
    qrMaxRetries: 0,
    puppeteer: {
      headless: true,
      // Generous protocol timeout so slow message round-trips under CPU
      // contention don't get treated as a dead browser and killed.
      protocolTimeout: 300000,
      // Standard server-safe flags, plus flags that trim the headless
      // browser's own baseline overhead (extensions, sync, background
      // networking, throttling) so it competes less for CPU/RAM against
      // the desktop Chrome session running on the same machine.
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-sync",
        "--disable-translate",
        "--disable-default-apps",
        "--mute-audio",
        "--no-default-browser-check",
        "--disable-client-side-phishing-detection",
        "--disable-hang-monitor",
        "--disable-popup-blocking",
        "--disable-prompt-on-repost",
        "--disable-domain-reliability",
        "--disable-component-update",
        "--disable-ipc-flooding-protection",
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
