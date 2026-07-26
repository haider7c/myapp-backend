const express = require("express");
const ManualBill = require("../models/ManualBill");
const Counter = require("../models/Counter");
const auth = require("../middleware/auth");

const router = express.Router();

function ownerScope(req) {
  return req.user.role === "owner" ? req.user.id : req.user.ownerId;
}

// GET /api/manualbills/next-invoice-number — atomically reserve the next
// invoice number so it's guaranteed unique even if two bills are being
// created at the same time (e.g. one from the desktop app, one from mobile).
// Uses its own counter (distinct from "invoice", which counterRoutes.js
// already uses for customer serial numbers), scoped per tenant so two
// businesses' invoice numbers never collide or reveal each other's volume.
router.get("/next-invoice-number", auth, async (req, res) => {
  try {
    const ownerId = ownerScope(req);
    const counter = await Counter.findOneAndUpdate(
      { name: "manualBillInvoice", ownerId },
      { $inc: { value: 1 } },
      { new: true, upsert: true }
    );
    const year = new Date().getFullYear();
    const padded = String(counter.value).padStart(6, "0");
    res.status(200).json({ invoiceNumber: `${year}-${padded}` });
  } catch (err) {
    res.status(500).json({ message: "Failed to generate invoice number", error: err.message });
  }
});

router.post("/", auth, async (req, res) => {
  try {
    const newBill = new ManualBill({ ...req.body, ownerId: ownerScope(req) });
    await newBill.save();
    res.status(201).json({ message: "Bill saved successfully", data: newBill });
  } catch (err) {
    res.status(500).json({ message: "Failed to save bill", error: err.message });
  }
});

router.get("/", auth, async (req, res) => {
  try {
    const bills = await ManualBill.find({ ownerId: ownerScope(req) }).sort({ createdAt: -1 });
    res.status(200).json(bills);
  } catch (err) {
    res.status(500).json({ message: "Failed to retrieve bills", error: err.message });
  }
});

router.get("/:id", auth, async (req, res) => {
  try {
    const bill = await ManualBill.findOne({ _id: req.params.id, ownerId: ownerScope(req) });
    if (!bill) return res.status(404).json({ message: "Bill not found" });
    res.status(200).json(bill);
  } catch (err) {
    res.status(500).json({ message: "Failed to retrieve bill", error: err.message });
  }
});

module.exports = router;
