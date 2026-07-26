const express = require("express");
const router = express.Router();
const Counter = require("../models/Counter");
const auth = require("../middleware/auth");

function ownerScope(req) {
  return req.user.role === "owner" ? req.user.id : req.user.ownerId;
}

// GET current customer serial number (own tenant's sequence only).
// findOneAndUpdate+upsert is atomic -- a plain findOne-then-create was
// racy: two near-simultaneous requests for a brand new tenant (e.g. a
// double-mount on the Add Customer screen) could both try to create the
// first row, the second one would hit the unique index and throw, and the
// screen would display the resulting error object's (missing) `value` as
// the literal text "undefined". A brand new tenant's sequence now starts
// at 1, not 0, so their very first customer is serial number 1.
router.get("/customer-id", auth, async (req, res) => {
  try {
    const ownerId = ownerScope(req);
    const counter = await Counter.findOneAndUpdate(
      { name: "invoice", ownerId },
      { $setOnInsert: { value: 1 } },
      { new: true, upsert: true }
    );

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
