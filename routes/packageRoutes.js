const express = require("express");
const router = express.Router();
const Package = require("../models/Package");
const auth = require("../middleware/auth");

function ownerScope(req) {
  return req.user.role === "owner" ? req.user.id : req.user.ownerId;
}

// ➤ FETCH ALL PACKAGES (scoped to the logged-in owner's tenant)
router.get("/", auth, async (req, res) => {
  try {
    const packages = await Package.find({ ownerId: ownerScope(req) });
    res.json(packages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ➤ ADD NEW PACKAGE
router.post("/", auth, async (req, res) => {
  try {
    const newPackage = new Package({ ...req.body, ownerId: ownerScope(req) });
    const saved = await newPackage.save();
    res.json(saved);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ➤ UPDATE EXISTING PACKAGE
router.put("/:id", auth, async (req, res) => {
  try {
    const { ownerId, ...updateData } = req.body; // never let the client move a package to another tenant
    const updated = await Package.findOneAndUpdate(
      { _id: req.params.id, ownerId: ownerScope(req) },
      updateData,
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: "Package not found" });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ➤ DELETE PACKAGE (optional)
router.delete("/:id", auth, async (req, res) => {
  try {
    const deleted = await Package.findOneAndDelete({
      _id: req.params.id,
      ownerId: ownerScope(req),
    });

    if (!deleted) return res.status(404).json({ message: "Package not found" });

    res.json({ message: "Package deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
