// routes/customerNoteRoutes.js -- Billing & Customer Management module.
// Mounted at /api/customer-notes in server.js.
const express = require("express");
const router = express.Router();
const CustomerNote = require("../models/CustomerNote");
const Customer = require("../models/Customer");
const User = require("../models/User");
const auth = require("../middleware/auth");
const { logActivity } = require("../services/activityLogger");

// GET all notes for a customer, newest first.
router.get("/:customerId", auth, async (req, res) => {
  try {
    const notes = await CustomerNote.find({ customerId: req.params.customerId }).sort({ createdAt: -1 });
    res.json({ success: true, notes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST add a note.
router.post("/:customerId", auth, async (req, res) => {
  try {
    const { note } = req.body;
    if (!note || !note.trim()) {
      return res.status(400).json({ success: false, error: "Note text is required" });
    }

    const customer = await Customer.findById(req.params.customerId);
    if (!customer) return res.status(404).json({ success: false, error: "Customer not found" });

    const user = await User.findById(req.user.id).select("name");
    const ownerId = req.user.role === "owner" ? req.user.id : req.user.ownerId;

    const created = await CustomerNote.create({
      customerId: customer._id,
      ownerId,
      note: note.trim(),
      authorId: req.user.id,
      authorName: user?.name || "",
    });

    logActivity({
      type: "note_added",
      reqUser: req.user,
      req,
      customer,
      message: `Added a note on ${customer.customerName}`,
      details: { note: note.trim() },
    });

    res.status(201).json({ success: true, note: created });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
