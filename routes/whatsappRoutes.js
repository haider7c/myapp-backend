// backend/routes/whatsappRoutes.js
//
// Multi-tenant note: every route here now resolves an `ownerId` and passes
// it through to whatsappService so each business owner's messages go
// through THEIR OWN linked WhatsApp number, not a single shared one.
//
// Some of these routes are called by app screens/scripts that don't send an
// Authorization header at all (the mobile app's WhatsAppManager status/QR
// polling used to, and some legacy bulk-send screens still don't, plus the
// standalone nightly cron in cron/reminderScheduler.js posts here directly
// with no token). Rather than hard-require auth everywhere and break those
// existing callers, resolveOwnerId() below prefers a real logged-in
// identity when one is present, and otherwise falls back to the original
// (oldest) owner in the system -- which is exactly who was already sending
// every message before this change, so nothing breaks for callers that
// haven't been updated to send a token yet.
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");

const createWhatsAppService = require("../services/whatsappService");
const ExpiryChecker = require("../services/expiryChecker");
const BillStatus = require("../models/BillStatus");
const Customer = require("../models/Customer");
const User = require("../models/User");
const auth = require("../middleware/auth");
const { logActivity } = require("../services/activityLogger");

// create ONE INSTANCE shared for all routes (the service itself is now a
// multi-session manager, not a single connected client)
const whatsappServicePromise = createWhatsAppService();
const expiryChecker = new ExpiryChecker(whatsappServicePromise);

let cachedDefaultOwnerId = null;
async function getDefaultOwnerId() {
  if (cachedDefaultOwnerId) return cachedDefaultOwnerId;
  const oldest = await User.findOne({ role: "owner" }).sort({ createdAt: 1 }).select("_id");
  cachedDefaultOwnerId = oldest?._id?.toString() || null;
  return cachedDefaultOwnerId;
}

// Best-effort identity resolution: valid token -> that user's owner;
// explicit ownerId in the body -> that; otherwise the original owner, so
// every not-yet-updated caller keeps behaving exactly as it did when there
// was only one shared session.
async function resolveOwnerId(req) {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("role ownerId");
      if (user) return user.role === "owner" ? user._id.toString() : user.ownerId?.toString();
    } catch (err) {
      // fall through to the other resolution strategies below
    }
  }
  if (req.body?.ownerId) return req.body.ownerId;
  return getDefaultOwnerId();
}

// GET STATUS
router.get("/status", async (req, res) => {
  const service = await whatsappServicePromise;
  const ownerId = await resolveOwnerId(req);
  res.json(service.getStatus(ownerId));
});

// GET QR
router.get("/qr", async (req, res) => {
  const service = await whatsappServicePromise;
  const ownerId = await resolveOwnerId(req);
  const qr = service.getQR(ownerId);

  if (!qr) return res.status(404).json({ message: "QR not ready" });

  res.json({ qr });
});

// POST DISCONNECT -- explicitly unlink this account's WhatsApp number and
// free its browser session.
router.post("/disconnect", auth, async (req, res) => {
  try {
    const service = await whatsappServicePromise;
    const ownerId = req.user.role === "owner" ? req.user.id : req.user.ownerId;
    const result = await service.disconnectSession(ownerId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DIAGNOSTIC: check whether a specific customer's phone number is actually
// registered on WhatsApp right now, without sending them anything.
router.get("/check-number/:customerId", auth, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.customerId);
    if (!customer) return res.status(404).json({ ok: false, error: "Customer not found" });
    if (!customer.phone) return res.status(400).json({ ok: false, error: "Customer has no phone number on file" });

    const service = await whatsappServicePromise;
    const result = await service.checkNumber(customer.ownerId, customer.phone);
    res.json({ ...result, customerName: customer.customerName });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// SEND MESSAGE
router.post("/send", async (req, res) => {
  const service = await whatsappServicePromise;
  const ownerId = await resolveOwnerId(req);

  const { phone, message } = req.body;

  try {
    const result = await service.sendMessage(ownerId, phone, message);
    if (result.success) res.json({ success: true });
    else res.status(500).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/send-document", async (req, res) => {
  try {
    const service = await whatsappServicePromise;
    const ownerId = await resolveOwnerId(req);
    const { phone, filePath, fileName } = req.body;

    await service.sendDocument(ownerId, phone, filePath, fileName);

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------
// Expiry / reminder routes — ported from the desktop app so both apps can
// trigger the same customer expiry/bill-due WhatsApp reminders.
// -----------------------------------------------------------------------

// Kept as an alias of /send for compatibility with the desktop app's
// existing "send-test" client call (same behavior as /send).
router.post("/send-test", auth, async (req, res) => {
  try {
    const service = await whatsappServicePromise;
    const ownerId = req.user.role === "owner" ? req.user.id : req.user.ownerId;
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ success: false, error: "Phone and message are required" });
    }
    if (!service.getStatus(ownerId).isConnected) {
      return res.status(503).json({ success: false, error: "WhatsApp is not connected. Please scan the QR code first." });
    }
    const result = await service.sendMessage(ownerId, phone, message);
    if (result.success) {
      logActivity({
        type: "whatsapp_sent",
        reqUser: req.user,
        message: `Sent WhatsApp test message to ${phone}`,
        details: { phone, message, kind: "test" },
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/send-expiry-reminder/:customerId", auth, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.customerId);
    if (!customer) return res.status(404).json({ success: false, error: "Customer not found" });

    const service = await whatsappServicePromise;
    if (!service.getStatus(customer.ownerId).isConnected) {
      return res.status(503).json({ success: false, error: "WhatsApp is not connected for this account" });
    }
    const result = await expiryChecker.sendExpiryReminder(req.params.customerId);
    if (result.success) {
      logActivity({
        type: "whatsapp_sent",
        reqUser: req.user,
        customer,
        message: `Sent expiry reminder to ${customer?.customerName || "customer"}`,
        details: { kind: "expiry_reminder" },
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/send-bill-reminder/:customerId", auth, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.customerId);
    if (!customer) return res.status(404).json({ success: false, error: "Customer not found" });

    const service = await whatsappServicePromise;
    if (!service.getStatus(customer.ownerId).isConnected) {
      return res.status(503).json({ success: false, error: "WhatsApp is not connected for this account" });
    }
    // This route is only ever hit by the manual "Send Reminder" button
    // (billing page, any unpaid customer) — not by the daily cron, which
    // calls expiryChecker.sendBillReminder() directly in a loop. So it
    // always forces the send regardless of whether the bill day is today.
    const result = await expiryChecker.sendBillReminder(req.params.customerId, { force: true });
    if (result.success) {
      logActivity({
        type: "whatsapp_sent",
        reqUser: req.user,
        customer,
        message: `Sent bill reminder to ${customer?.customerName || "customer"}`,
        details: { kind: "bill_reminder" },
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/send-payment-receipt/:customerId", auth, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.customerId);
    if (!customer) return res.status(404).json({ success: false, error: "Customer not found" });

    const service = await whatsappServicePromise;
    if (!service.getStatus(customer.ownerId).isConnected) {
      return res.status(503).json({ success: false, error: "WhatsApp is not connected for this account" });
    }
    const { amount, method, transactionId } = req.body;
    const result = await expiryChecker.sendPaymentReceipt(req.params.customerId, { amount, method, transactionId });
    if (result.success) {
      logActivity({
        type: "whatsapp_sent",
        reqUser: req.user,
        customer,
        message: `Sent payment receipt to ${customer?.customerName || "customer"}${amount ? ` (Rs. ${amount})` : ""}`,
        details: { kind: "payment_receipt", amount, method, transactionId },
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Packages expiring in the next N days, filtered to unpaid customers only
// (same filtering the desktop app applies).
router.get("/expiring-packages", async (req, res) => {
  try {
    const { days = 3 } = req.query;
    const packages = await expiryChecker.getExpiringPackages(parseInt(days));

    const unpaidPackages = [];
    for (const pkg of packages) {
      const bill = await BillStatus.findOne({
        customerId: pkg._id,
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
      });
      if (!bill || bill.billStatus === false) {
        unpaidPackages.push(pkg);
      }
    }
    res.json(unpaidPackages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/due-today", async (req, res) => {
  try {
    const packages = await expiryChecker.getDueTodayPackages();
    res.json(packages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/check-expiring", async (req, res) => {
  try {
    const results = await expiryChecker.checkExpiringPackages();
    res.json({
      success: true,
      results,
      summary: {
        total: results.length,
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/check-due-today", async (req, res) => {
  try {
    const results = await expiryChecker.checkDueTodayPackages();
    res.json({
      success: true,
      results,
      summary: {
        total: results.length,
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
