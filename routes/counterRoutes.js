const express = require("express");
const router = express.Router();
const Counter = require("../models/Counter");
const auth = require("../middleware/auth");

function ownerScope(req) {
  return req.user.role === "owner" ? req.user.id : req.user.ownerId;
}

// GET current customer serial number (own tenant's sequence only)
router.get("/customer-id", auth, async (req, res) => {
  try {
    const ownerId = ownerScope(req);
    let counter = await Counter.findOne({ name: "invoice", ownerId });

    if (!counter) {
      // First time this tenant has asked -- start their own sequence at 0
      // rather than reusing/reading another tenant's counter.
      counter = await Counter.create({ name: "invoice", ownerId, value: 0 });
    }

    res.json(counter);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// INCREASE customer serial (own tenant's sequence only)
router.put("/increase-customer-id", auth, async (req, res) => {
  try {
    const ownerId = ownerScope(req);
    const counter = await Counter.findOneAndUpdate(
      { name: "invoice", ownerId },
      { $inc: { value: 1 } },
      { new: true, upsert: true }
    );

    res.json(counter);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
