const express = require("express");
const InventoryItem = require("../models/InventoryItem");

const router = express.Router();

// Unauthenticated, un-scoped by ownerId — matches this backend's existing
// convention for shared reference data (see packageRoutes.js).

// GET /api/inventory — list all items, newest first
router.get("/", async (req, res) => {
  try {
    const items = await InventoryItem.find().sort({ createdAt: -1 });
    res.status(200).json(items);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch inventory items", error: err.message });
  }
});

// POST /api/inventory — create a new item
router.post("/", async (req, res) => {
  try {
    const item = new InventoryItem(req.body);
    await item.save();
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ message: "Failed to create inventory item", error: err.message });
  }
});

// PUT /api/inventory/:id — update an item
router.put("/:id", async (req, res) => {
  try {
    const item = await InventoryItem.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.status(200).json(item);
  } catch (err) {
    res.status(400).json({ message: "Failed to update inventory item", error: err.message });
  }
});

// DELETE /api/inventory/:id — remove an item
router.delete("/:id", async (req, res) => {
  try {
    const item = await InventoryItem.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.status(200).json({ message: "Item deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete inventory item", error: err.message });
  }
});

module.exports = router;
