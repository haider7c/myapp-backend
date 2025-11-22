const express = require("express");
const router = express.Router();
const Counter = require("../models/Counter");

// Get Next Serial Number
router.get("/next-customer-id", async (req, res) => {
  try {
    let counter = await Counter.findOne({ name: "customer" });

    // If not exist create first time
    if (!counter) {
      counter = await Counter.create({ name: "customer", value: 1 });
    }

    res.json({ nextId: counter.value });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch counter" });
  }
});

// Increase serial number after successful creation
router.put("/increase-customer-id", async (req, res) => {
  try {
    const counter = await Counter.findOneAndUpdate(
      { name: "customer" },
      { $inc: { value: 1 } },
      { new: true }
    );

    res.json(counter);
  } catch (err) {
    res.status(500).json({ message: "Failed to update counter" });
  }
});

module.exports = router;
