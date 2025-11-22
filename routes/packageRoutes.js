const express = require("express");
const router = express.Router();
const Package = require("../models/Package");

// ➤ FETCH ALL PACKAGES
router.get("/", async (req, res) => {
  try {
    const packages = await Package.find();
    res.json(packages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ➤ ADD NEW PACKAGE
router.post("/", async (req, res) => {
  try {
    const newPackage = new Package(req.body);
    const saved = await newPackage.save();
    res.json(saved);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ➤ UPDATE EXISTING PACKAGE
router.put("/:id", async (req, res) => {
  try {
    const updated = await Package.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: "Package not found" });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ➤ DELETE PACKAGE (optional)
router.delete("/:id", async (req, res) => {
  try {
    const deleted = await Package.findByIdAndDelete(req.params.id);

    if (!deleted) return res.status(404).json({ message: "Package not found" });

    res.json({ message: "Package deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
