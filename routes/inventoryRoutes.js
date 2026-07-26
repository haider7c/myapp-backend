const express = require("express");
const InventoryItem = require("../models/InventoryItem");
const auth = require("../middleware/auth");

const router = express.Router();

function ownerScope(req) {
  return req.user.role === "owner" ? req.user.id : req.user.ownerId;
}

// GET /api/inventory — list this tenant's items, newest first
router.get("/", auth, async (req, res) => {
  try {
    const items = await InventoryItem.find({ ownerId: ownerScope(req) }).sort({ createdAt: -1 });
    res.status(200).json(items);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch inventory items", error: err.message });
  }
});

// POST /api/inventory — create a new item
router.post("/", auth, async (req, res) => {
  try {
    const item = new InventoryItem({ ...req.body, ownerId: ownerScope(req) });
    await item.save();
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ message: "Failed to create inventory item", error: err.message });
  }
});

// PUT /api/inventory/:id — update an item
router.put("/:id", auth, async (req, res) => {
  try {
    const { ownerId, ...updateData } = req.body;
    const item = await InventoryItem.findOneAndUpdate(
      { _id: req.params.id, ownerId: ownerScope(req) },
      updateData,
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.status(200).json(item);
  } catch (err) {
    res.status(400).json({ message: "Failed to update inventory item", error: err.message });
  }
});

// DELETE /api/inventory/:id — remove an item
router.delete("/:id", auth, async (req, res) => {
  try {
    const item = await InventoryItem.findOneAndDelete({
      _id: req.params.id,
      ownerId: ownerScope(req),
    });
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.status(200).json({ message: "Item deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete inventory item", error: err.message });
  }
});

module.exports = router;
