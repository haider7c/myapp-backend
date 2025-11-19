// backend/routes/whatsappRoutes.js
const express = require("express");
const router = express.Router();

const createWhatsAppService = require("../services/whatsappService");

// create ONE INSTANCE shared for all routes
const whatsappServicePromise = createWhatsAppService();

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

module.exports = router;
