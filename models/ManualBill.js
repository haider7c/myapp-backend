// Ported from the desktop app so both apps read/write the same invoice shape.
const mongoose = require("mongoose");

const lineItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true },
    period: { type: String, default: "" }, // e.g. "01 Jul 2025 - 31 Jul 2025" or "One Time"
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    amount: { type: Number, default: 0 }, // quantity * unitPrice, precomputed for the PDF
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", default: null },
  },
  { _id: false }
);

const manualBillSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String },
    invoiceDate: { type: String }, // stored as plain strings (already formatted) so the
    dueDate: { type: String }, // printed receipt always matches what was saved.
    billingMonth: { type: String }, // e.g. "July 2025"

    // Customer info snapshot — kept even if the underlying customer record
    // later changes, so old invoices stay accurate to what was printed.
    customerRef: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
    customerId: String,
    customerName: String,
    cnic: String,
    phone: String,
    email: String,
    address: String,

    // Connection info
    connectionId: String,
    packageName: String,
    downloadSpeed: String,
    uploadSpeed: String,
    ipAddress: String,
    macAddress: String,

    // Billing
    items: { type: [lineItemSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    taxLabel: String,
    taxAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },

    // Payment
    paymentStatus: { type: String, enum: ["Paid", "Unpaid", "Partial"], default: "Unpaid" },
    paymentMethod: String,
    transactionId: String,
    paymentDate: String,
    amountPaid: { type: Number, default: 0 },

    // Billing history snapshot shown on the receipt
    previousBalance: { type: Number, default: 0 },
    lastPaymentDate: String,
    lastPaidAmount: { type: Number, default: 0 },

    // --- Legacy fields (kept so older saved bills still load/print) ---
    date: String,
    billAmount: Number,
    months: Number,
    connectionFee: Number,
    additions: [
      {
        title: String,
        amount: Number,
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("ManualBill", manualBillSchema);
