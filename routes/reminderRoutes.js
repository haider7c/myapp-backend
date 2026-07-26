// backend/routes/reminderRoutes.js
const express = require("express");
const router = express.Router();

const createWhatsAppService = require("../services/whatsappService");
const { sendReminders } = require("../services/reminderService");
const auth = require("../middleware/auth");

const whatsappServicePromise = createWhatsAppService();

function ownerScope(req) {
  return req.user.role === "owner" ? req.user.id : req.user.ownerId;
}

// Was previously unauthenticated and sent to every customer in the entire
// system regardless of tenant. Now requires login and only reaches the
// requester's own customers.
router.post("/run", auth, async (req, res) => {
  try {
    const service = await whatsappServicePromise;
    await sendReminders(service, ownerScope(req));

    res.json({ success: true, message: "Reminders sent" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
