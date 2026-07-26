const mongoose = require("mongoose");

// Items/products that can be sold or charged alongside a customer's monthly
// bill (routers, cables, installation kits, etc.) — managed on the Inventory
// page and picked from a dropdown when building a Manual Bill. Ported from
// the desktop app so both apps share the same catalog.
const inventoryItemSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    name: { type: String, required: true, trim: true },
    unit: { type: String, default: "pcs", trim: true }, // e.g. pcs, meter, box
    purchasePrice: { type: Number, default: 0 }, // cost price (internal, not printed on receipts)
    salePrice: { type: Number, required: true }, // price charged to the customer
    stock: { type: Number, default: 0 }, // quantity currently in hand
    sku: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InventoryItem", inventoryItemSchema);
