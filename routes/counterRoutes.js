const express = require("express");
const router = express.Router();
const Counter = require("../models/Counter");

// GET current customer serial number
router.get("/customer-id", async (req, res) => {
  try {
    let counter = await Counter.findOne({ name: "invoice" });

   if (!counter) {
  return res.status(400).json({ message: "Counter 'invoice' not found in database" });
}


    res.json(counter);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// INCREASE customer serial
router.put("/increase-customer-id", async (req, res) => {
  try {
    let counter = await Counter.findOneAndUpdate(
      { name: "invoice" },
      { $inc: { value: 1 } },
      { new: true }
    );

    if (!counter) {
      counter = await Counter.create({ name: "invoice", value: 1 });
    }

    res.json(counter);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
