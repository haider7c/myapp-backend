const express = require("express");
const ReceiptSettings = require("../models/ReceiptSettings");
const auth = require("../middleware/auth");
const { logActivity } = require("../services/activityLogger");

const router = express.Router();

function ownerScope(req) {
  return req.user.role === "owner" ? req.user.id : req.user.ownerId;
}

// Canonical list of receipt-field toggle keys + display labels (req 7) --
// single source of truth for the admin UI's "enable/disable fields" list.
const RECEIPT_FIELD_CATALOG = [
  { key: "customerName", label: "Customer Name" },
  { key: "customerId", label: "Customer ID" },
  { key: "username", label: "Username" },
  { key: "package", label: "Package" },
  { key: "invoiceNumber", label: "Invoice Number" },
  { key: "receiptNumber", label: "Receipt Number" },
  { key: "paymentDate", label: "Payment Date" },
  { key: "billingMonth", label: "Billing Month" },
  { key: "paymentMethod", label: "Payment Method" },
  { key: "transactionId", label: "Transaction ID" },
  { key: "previousDue", label: "Previous Due" },
  { key: "currentBill", label: "Current Bill" },
  { key: "discount", label: "Discount" },
  { key: "lateFee", label: "Late Fee" },
  { key: "advanceBalance", label: "Advance Balance" },
  { key: "remainingDue", label: "Remaining Due" },
  { key: "collectedBy", label: "Collected By" },
  { key: "branch", label: "Branch" },
  { key: "operator", label: "Operator" },
  { key: "customerAddress", label: "Customer Address" },
  { key: "phoneNumber", label: "Phone Number" },
  { key: "notes", label: "Notes" },
  { key: "barcode", label: "Barcode" },
  { key: "qrCode", label: "QR Code" },
  { key: "statusBadge", label: "Status Badge" },
];

const LAYOUTS = [
  { key: "compact", label: "Compact Receipt" },
  { key: "standard", label: "Standard Receipt" },
  { key: "detailed", label: "Detailed Receipt" },
  { key: "a4", label: "A4 Printable Receipt" },
  { key: "thermal", label: "Thermal Receipt" },
  { key: "mobile_friendly", label: "Mobile Friendly Receipt" },
];

async function getOrCreateForOwner(ownerId) {
  let settings = await ReceiptSettings.findOne({ ownerId });
  if (settings) return settings;

  // First time this owner has opened the Receipt Editor: seed from the
  // legacy pre-multi-tenant singleton if one exists (so the very first
  // owner in the system keeps their already-configured branding), else
  // fall back to the schema's built-in defaults for every other owner.
  const legacy = await ReceiptSettings.findOne({ ownerId: null, key: "default" });
  const seed = legacy ? legacy.toObject() : {};
  delete seed._id;
  delete seed.ownerId;
  delete seed.createdAt;
  delete seed.updatedAt;
  delete seed.__v;

  settings = await ReceiptSettings.create({ ...seed, ownerId });
  return settings;
}

// GET /api/settings/receipt — fetch this tenant's receipt settings, creating
// them (seeded from legacy defaults, see above) the first time they're requested.
router.get("/receipt", auth, async (req, res) => {
  try {
    const settings = await getOrCreateForOwner(ownerScope(req));
    res.status(200).json(settings);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch receipt settings", error: err.message });
  }
});

// PUT /api/settings/receipt — update this tenant's settings.
router.put("/receipt", auth, async (req, res) => {
  try {
    const ownerId = ownerScope(req);
    const before = await getOrCreateForOwner(ownerId);
    const previousValue = before.toObject();

    const update = { ...req.body };
    delete update.key;
    delete update.ownerId;
    delete update._id;

    const settings = await ReceiptSettings.findOneAndUpdate(
      { ownerId },
      update,
      { new: true, upsert: true, runValidators: true }
    );

    logActivity({
      type: "receipt_settings_updated",
      reqUser: req.user,
      req,
      message: "Updated receipt/company settings",
      previousValue,
      newValue: update,
    });

    res.status(200).json(settings);
  } catch (err) {
    res.status(400).json({ message: "Failed to update receipt settings", error: err.message });
  }
});

// GET /api/settings/receipt/fields-schema — the canonical field/layout
// catalog for the Receipt Template Editor UI (req 7-8).
router.get("/receipt/fields-schema", auth, (req, res) => {
  res.json({ success: true, fields: RECEIPT_FIELD_CATALOG, layouts: LAYOUTS });
});

module.exports = router;
