// backend/routes/whatsappRoutes.js
const express = require("express");
const router = express.Router();

const createWhatsAppService = require("../services/whatsappService");
const ExpiryChecker = require("../services/expiryChecker");
const BillStatus = require("../models/BillStatus");

// create ONE INSTANCE shared for all routes
const whatsappServicePromise = createWhatsAppService();
const expiryChecker = new ExpiryChecker(whatsappServicePromise);

// GET STATUS
router.get("/status", async (req, res) => {
  const service = await whatsappServicePromise;
  res.json(service.getStatus());
});

// GET QR
router.get("/qr", async (req, res) => {
  const service = await whatsappServicePromise;
  const qr = service.getQR();

  if (!qr) return res.status(404).json({ message: "QR not ready" });

  res.json({ qr });
});

// SEND MESSAGE
router.post("/send", async (req, res) => {
  const service = await whatsappServicePromise;

  const { phone, message } = req.body;

  const result = await service.sendMessage(phone, message);

  if (result.success) res.json({ success: true });
  else res.status(500).json(result);
});


// backend/routes/whatsappRoutes.js
router.post("/send-document", async (req, res) => {
  try {
    const service = await whatsappServicePromise;
    const { phone, filePath, fileName } = req.body;

    const result = await service.sendDocument(phone, filePath, fileName);

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
router.post("/send-test", async (req, res) => {
  try {
    const service = await whatsappServicePromise;
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ success: false, error: "Phone and message are required" });
    }
    if (!service.getStatus().isConnected) {
      return res.status(503).json({ success: false, error: "WhatsApp is not connected. Please scan the QR code first." });
    }
    const result = await service.sendMessage(phone, message);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/send-expiry-reminder/:customerId", async (req, res) => {
  try {
    const service = await whatsappServicePromise;
    if (!service.getStatus().isConnected) {
      return res.status(503).json({ success: false, error: "WhatsApp is not connected" });
    }
    const result = await expiryChecker.sendExpiryReminder(req.params.customerId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/send-bill-reminder/:customerId", async (req, res) => {
  try {
    const service = await whatsappServicePromise;
    if (!service.getStatus().isConnected) {
      return res.status(503).json({ success: false, error: "WhatsApp is not connected" });
    }
    const result = await expiryChecker.sendBillReminder(req.params.customerId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/send-payment-receipt/:customerId", async (req, res) => {
  try {
    const service = await whatsappServicePromise;
    if (!service.getStatus().isConnected) {
      return res.status(503).json({ success: false, error: "WhatsApp is not connected" });
    }
    const { amount, method, transactionId } = req.body;
    const result = await expiryChecker.sendPaymentReceipt(req.params.customerId, { amount, method, transactionId });
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
