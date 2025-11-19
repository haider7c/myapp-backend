// backend/routes/reminderRoutes.js
const express = require("express");
const router = express.Router();

const createWhatsAppService = require("../services/whatsappService");
const { sendReminders } = require("../services/reminderService");

const whatsappServicePromise = createWhatsAppService();

router.post("/run", async (req, res) => {
  try {
    const service = await whatsappServicePromise;
    await sendReminders(service);

    res.json({ success: true, message: "Reminders sent" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
