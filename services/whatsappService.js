// backend/services/whatsappService.js
//
// Multi-tenant rewrite: each business owner links their OWN WhatsApp
// number/QR code, sent through their OWN whatsapp-web.js Client instance,
// completely independent of every other owner's session. Previously this
// was a single module-level Client shared by the entire server -- one
// phone number sending messages for every tenant regardless of which
// business the customer belonged to. Now every exported function takes an
// `ownerId` as its first argument and looks up (or lazily creates) that
// owner's own session.
//
// Sessions are created lazily, one Chromium instance per owner that has
// actually tried to connect (via getQR), NOT eagerly for every owner in the
// system at server startup -- each headless Chrome instance is a real
// CPU/RAM cost, so an owner who never opens their WhatsApp Manager screen
// never gets one spun up for them.
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");

const AUTH_DIR = path.resolve(__dirname, "../.wwebjs_auth");

// Map<string ownerId, SessionState>
const sessions = new Map();

function newSessionState() {
  return {
    client: null,
    isReady: false,
    qrDataUrl: null,
    qrGeneratedAt: null,
    qrCount: 0,
    initializing: false,
    messageQueue: [],
  };
}

// --------------------------------------------------------------------------------------
// NORMALIZE PHONE (unchanged from the single-session version)
// --------------------------------------------------------------------------------------
function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.toString().replace(/\D/g, "");
  if (!cleaned) return null;

  if (cleaned.startsWith("00")) {
    cleaned = cleaned.slice(2);
  }

  if (cleaned.startsWith("920") && cleaned.length === 13) {
    cleaned = "92" + cleaned.slice(3);
  }

  if (!cleaned.startsWith("92")) {
    cleaned = cleaned.replace(/^0+/, "");
    if (cleaned.length === 10) {
      cleaned = "92" + cleaned;
    }
  }

  if (!cleaned.startsWith("92") || cleaned.length !== 12) return null;
  return cleaned;
}

async function resolveChatId(client, normalizedPhone) {
  const numberId = await client.getNumberId(normalizedPhone);
  if (!numberId) {
    throw new Error(`Number is not registered on WhatsApp: ${normalizedPhone}`);
  }
  return numberId._serialized;
}

// --------------------------------------------------------------------------------------
// SESSION LIFECYCLE
// --------------------------------------------------------------------------------------

// Peek at an owner's session without creating one. Used by getStatus so
// simply viewing the WhatsApp Manager screen doesn't spin up a browser.
function peekSession(ownerId) {
  return sessions.get(String(ownerId)) || null;
}

// Get-or-create: used by getQR (the explicit "start connecting" action) and
// by nothing else, so a session is only ever born when an owner actually
// asks to link their number.
function getOrCreateSession(ownerId) {
  const key = String(ownerId);
  let session = sessions.get(key);
  if (session) return session;

  session = newSessionState();
  sessions.set(key, session);
  initializeClient(key, session);
  return session;
}

function initializeClient(ownerId, session) {
  session.initializing = true;
  console.log(`🔄 Initializing WhatsApp client for owner ${ownerId}...`);

  const client = new Client({
    authStrategy: new LocalAuth({
      // Namespaced per owner so each business's login/session persists
      // independently on disk -- scanning a QR for owner A never touches
      // owner B's linked session.
      clientId: `owner_${ownerId}`,
      dataPath: AUTH_DIR,
    }),
    // Same server-contention-tolerant timeouts as before -- now matter even
    // more since multiple owners' Chromium instances may be competing for
    // CPU on the same box simultaneously.
    authTimeoutMs: 0,
    qrMaxRetries: 0,
    puppeteer: {
      headless: true,
      protocolTimeout: 300000,
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
    },
  });
  session.client = client;

  client.on("qr", async (qr) => {
    session.qrDataUrl = await QRCode.toDataURL(qr);
    session.qrGeneratedAt = Date.now();
    session.qrCount += 1;
    session.isReady = false;
    console.log(`📱 [owner ${ownerId}] QR #${session.qrCount} generated at`, new Date(session.qrGeneratedAt).toISOString());
  });

  client.on("ready", () => {
    console.log(`✅ [owner ${ownerId}] WhatsApp client is ready!`);
    session.isReady = true;
    session.qrDataUrl = null;
    session.qrGeneratedAt = null;
    flushQueue(ownerId, session);
  });

  client.on("authenticated", () => {
    console.log(`✅ [owner ${ownerId}] WhatsApp client authenticated!`);
  });

  client.on("auth_failure", (msg) => {
    console.error(`❌ [owner ${ownerId}] WhatsApp authentication failed:`, msg);
    session.isReady = false;
  });

  client.on("disconnected", (reason) => {
    console.log(`❌ [owner ${ownerId}] WhatsApp client disconnected:`, reason);
    session.isReady = false;
    session.qrDataUrl = null;
    session.qrGeneratedAt = null;

    setTimeout(() => {
      console.log(`♻️ [owner ${ownerId}] Attempting to reconnect WhatsApp...`);
      destroySession(ownerId).then(() => {
        getOrCreateSession(ownerId);
      });
    }, 5000);
  });

  client.on("loading_screen", (percent, message) => {
    console.log(`📱 [owner ${ownerId}] WhatsApp loading: ${percent}% ${message}`);
  });

  client
    .initialize()
    .then(() => console.log(`✅ [owner ${ownerId}] WhatsApp client initialization started`))
    .catch((error) => console.error(`❌ [owner ${ownerId}] WhatsApp client initialization failed:`, error.message));

  session.initializing = false;
}

async function destroySession(ownerId) {
  const key = String(ownerId);
  const session = sessions.get(key);
  if (session?.client) {
    try {
      await session.client.destroy();
    } catch (error) {
      console.error(`Error destroying client for owner ${ownerId}:`, error.message);
    }
  }
  sessions.delete(key);
}

// Explicit unlink -- logs the owner's number out and frees the Chromium
// instance, rather than just leaving a dead session around.
async function disconnectSession(ownerId) {
  const key = String(ownerId);
  const session = sessions.get(key);
  if (!session) return { success: true, wasConnected: false };
  try {
    if (session.client) await session.client.logout().catch(() => {});
  } finally {
    await destroySession(ownerId);
  }
  return { success: true, wasConnected: true };
}

// --------------------------------------------------------------------------------------
// SEND TEXT NOW
// --------------------------------------------------------------------------------------
async function _sendNow(ownerId, phone, message) {
  const session = peekSession(ownerId);
  if (!session?.client || !session.isReady) throw new Error("socket-not-ready");

  const normalized = normalizePhone(phone);
  if (!normalized) {
    console.error(`❌ WhatsApp send skipped — could not normalize phone: "${phone}"`);
    throw new Error("invalid-phone");
  }

  try {
    const chatId = await resolveChatId(session.client, normalized);
    return await session.client.sendMessage(chatId, message);
  } catch (err) {
    console.error(`❌ [owner ${ownerId}] WhatsApp send failed for "${phone}" (normalized: ${normalized}):`, err.message);
    throw err;
  }
}

// --------------------------------------------------------------------------------------
// PUBLIC API: SEND MESSAGE (QUEUE IF NEEDED)
// --------------------------------------------------------------------------------------
// Does NOT lazily create a session -- if this owner has never connected
// WhatsApp at all, sending fails fast with a clear error instead of
// spinning up a browser just to queue a message nobody will ever be there
// to deliver.
function sendMessage(ownerId, phone, message, { queueIfNotReady = true } = {}) {
  return new Promise(async (resolve, reject) => {
    const normalized = normalizePhone(phone);
    if (!normalized) return reject(new Error("invalid-phone"));

    const session = peekSession(ownerId);
    if (!session) {
      return reject(new Error("WhatsApp is not connected for this account. Scan the QR code from WhatsApp Manager first."));
    }

    if (!session.client || !session.isReady) {
      if (queueIfNotReady) {
        session.messageQueue.push({ phone, message, resolve, reject });
        return;
      } else {
        return reject(new Error("socket-not-ready"));
      }
    }

    try {
      await _sendNow(ownerId, phone, message);
      resolve({ success: true });
    } catch (err) {
      reject(err);
    }
  });
}

// --------------------------------------------------------------------------------------
// SEND DOCUMENT
// --------------------------------------------------------------------------------------
async function sendDocument(ownerId, phone, filePath, fileName) {
  const session = peekSession(ownerId);
  if (!session?.client || !session.isReady) throw new Error("socket-not-ready");

  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error("invalid-phone");
  if (!fs.existsSync(filePath)) throw new Error("File does not exist: " + filePath);

  const media = MessageMedia.fromFilePath(filePath);
  if (fileName) media.filename = fileName;

  const chatId = await resolveChatId(session.client, normalized);
  return session.client.sendMessage(chatId, media);
}

// --------------------------------------------------------------------------------------
async function flushQueue(ownerId, session) {
  if (!session.isReady) return;

  while (session.messageQueue.length > 0) {
    const job = session.messageQueue.shift();
    try {
      await _sendNow(ownerId, job.phone, job.message);
      job.resolve({ success: true });
    } catch (err) {
      job.reject(err);
    }
  }
}

// --------------------------------------------------------------------------------------
// HELPERS RETURNED TO ROUTES
// --------------------------------------------------------------------------------------

// Pure peek -- never creates a session. Viewing the WhatsApp Manager screen
// should never, by itself, launch a browser for an owner who hasn't asked
// to connect yet.
function getStatus(ownerId) {
  const session = peekSession(ownerId);
  if (!session) {
    return { isConnected: false, socketReady: false, hasQR: false, qrAgeSeconds: null, qrCount: 0, notStarted: true };
  }
  return {
    isConnected: session.isReady,
    socketReady: session.isReady,
    hasQR: !!session.qrDataUrl,
    qrAgeSeconds: session.qrGeneratedAt ? Math.round((Date.now() - session.qrGeneratedAt) / 1000) : null,
    qrCount: session.qrCount,
  };
}

// The explicit "start connecting" call -- lazily creates the session/
// launches Chromium for this owner if one doesn't exist yet.
function getQR(ownerId) {
  const session = getOrCreateSession(ownerId);
  return session.qrDataUrl;
}

// Diagnostic-only: checks whether a phone number is actually registered on
// WhatsApp right now, against this owner's own session, without sending
// anything.
async function checkNumber(ownerId, phone) {
  const session = peekSession(ownerId);
  if (!session?.client || !session.isReady) {
    return { ok: false, error: "WhatsApp is not connected for this account" };
  }
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { ok: false, rawPhone: phone, error: "Could not normalize this phone number into a valid format" };
  }
  try {
    const numberId = await session.client.getNumberId(normalized);
    if (!numberId) {
      return {
        ok: false,
        rawPhone: phone,
        normalizedPhone: normalized,
        error: "WhatsApp reports this number is NOT registered",
      };
    }
    return {
      ok: true,
      rawPhone: phone,
      normalizedPhone: normalized,
      registered: true,
      chatId: numberId._serialized,
    };
  } catch (err) {
    return { ok: false, rawPhone: phone, normalizedPhone: normalized, error: err.message };
  }
}

// --------------------------------------------------------------------------------------
// EXPORT SERVICE
// --------------------------------------------------------------------------------------
// Kept as an async factory returning a resolved promise (matching the old
// interface) so every existing `const service = await whatsappServicePromise;`
// call site in routes/expiryChecker.js needed NO changes beyond adding
// ownerId as the first argument to the methods themselves.
const serviceApi = { getQR, getStatus, sendMessage, sendDocument, checkNumber, disconnectSession };

module.exports = async function createWhatsAppService() {
  return serviceApi;
};

// Exposed as a static property so scripts/routes can reuse the exact same
// normalization logic without needing a WhatsApp client at all.
module.exports.normalizePhone = normalizePhone;
