// models/Payment.js
//
// The complete payment ledger (req 7). One document per payment TRANSACTION
// -- a single payment can be split across multiple invoices (paying several
// months at once), so the actual per-invoice breakdown lives in
// `allocations`. Records are never deleted: reversing a payment sets
// isReversed/reversedAt/reversedBy/reversalReason and un-applies its
// allocations from the affected invoices, but the row itself stays forever
// as part of the audit trail.
const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    receiptNumber: { type: String, required: true, unique: true, index: true },

    // How this payment was split across one or more invoices. For a pure
    // advance payment (no generated invoice yet to apply to), this can be
    // empty and the full amount is instead credited to Customer.advanceBalance.
    allocations: [
      {
        invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
        month: Number,
        year: Number,
        amountApplied: Number,
      },
    ],

    totalAmount: { type: Number, required: true },
    advanceAmount: { type: Number, default: 0 }, // portion of totalAmount that went to advance balance rather than a specific invoice
    isAdvance: { type: Boolean, default: false },

    paymentMethod: { type: String, default: "Cash" },
    transactionId: { type: String, default: "" },
    paymentDate: { type: Date, default: Date.now },

    operatorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    operatorName: { type: String, default: "" },
    remarks: { type: String, default: "" },

    isReversed: { type: Boolean, default: false },
    reversedAt: { type: Date, default: null },
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reversalReason: { type: String, default: "" },

    // Receipt History (req 12) -- every Payment doc already carries
    // receiptNumber/invoice-month-via-allocations/generatedDate(createdAt),
    // so these are the only additional fields needed rather than a
    // duplicate ReceiptHistory collection. Nothing here is ever deleted.
    sentAt: { type: Date, default: null },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    sentByName: { type: String, default: "" },
    sharedVia: { type: [String], default: [] }, // e.g. ["whatsapp", "share_sheet", "email"]
  },
  { timestamps: true }
);

paymentSchema.index({ ownerId: 1, paymentDate: -1 });
paymentSchema.index({ ownerId: 1, customerId: 1, paymentDate: -1 });

module.exports = mongoose.model("Payment", paymentSchema);
