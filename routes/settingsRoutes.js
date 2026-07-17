const express = require("express");
const ReceiptSettings = require("../models/ReceiptSettings");

const router = express.Router();

// GET /api/settings/receipt — fetch the (singleton) receipt settings,
// creating them with sensible defaults the first time they're requested.
router.get("/receipt", async (req, res) => {
  try {
    let settings = await ReceiptSettings.findOne({ key: "default" });
    if (!settings) {
      settings = await ReceiptSettings.create({ key: "default" });
    }
    res.status(200).json(settings);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch receipt settings", error: err.message });
  }
});

// PUT /api/settings/receipt — update (or create) the receipt settings.
router.put("/receipt", async (req, res) => {
  try {
    const update = { ...req.body };
    delete update.key; // never allow overwriting the singleton key
    const settings = await ReceiptSettings.findOneAndUpdate(
      { key: "default" },
      update,
      { new: true, upsert: true, runValidators: true }
    );
    res.status(200).json(settings);
  } catch (err) {
    res.status(400).json({ message: "Failed to update receipt settings", error: err.message });
  }
});

module.exports = router;
