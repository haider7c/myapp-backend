// models/Invoice.js
//
// One document per customer per billing month -- the new source of truth
// for billing, replacing BillStatus for anything generated going forward.
// BillStatus is left completely untouched (existing routes/UI that read it
// keep working during the transition); historical BillStatus rows are
// migrated into Invoice documents by scripts/migrateBillStatusToInvoices.js
// so no history is lost.
//
// Once generated, the core figures (openingBalance, billAmount, month,
// year, invoiceNumber) are treated as immutable -- corrections happen via
// discount/lateFee/waivedAmount adjustments or a reversed Payment, never by
// silently rewriting these fields. amountPaid/closingBalance/status are the
// only fields the billing engine updates in place, and only as a direct
// consequence of a Payment being applied or reversed.
const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    invoiceNumber: { type: String, required: true, unique: true, index: true },

    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },

    // Running balance
    openingBalance: { type: Number, default: 0 }, // = previous invoice's closingBalance at generation time
    previousDue: { type: Number, default: 0 }, // same value as openingBalance, kept as its own field to match the spec's line-item naming
    billAmount: { type: Number, required: true }, // this month's package charge
    manualDue: { type: Number, default: 0 }, // ad-hoc dues added via the "Add Manual Due" quick action, tracked separately from lateFee for clarity
    discount: { type: Number, default: 0 },
    lateFee: { type: Number, default: 0 },
    waivedAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 }, // reserved for future use -- no tax UI/logic wired up yet

    totalPayable: { type: Number, required: true }, // openingBalance + billAmount + manualDue - discount - waivedAmount + lateFee + taxAmount
    amountPaid: { type: Number, default: 0 }, // cumulative, kept in sync as Payments are applied/reversed
    closingBalance: { type: Number, required: true }, // totalPayable - amountPaid; carried into the next invoice's openingBalance

    status: {
      type: String,
      enum: ["paid", "pending", "overdue", "partial", "waived"],
      default: "pending",
      index: true,
    },

    dueDate: { type: Date, default: null },
    paymentDate: { type: Date, default: null }, // most recent payment date applied to this invoice
    paymentMethod: { type: String, default: "" }, // most recent method (full detail lives on Payment records)

    isAdvance: { type: Boolean, default: false }, // true if this invoice was paid before its own due date arrived
    notes: { type: String, default: "" },

    // Traceability back to the pre-migration record, for support/debugging.
    legacyBillStatusId: { type: mongoose.Schema.Types.ObjectId, ref: "BillStatus", default: null },
    isLegacyMigrated: { type: Boolean, default: false },

    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// One invoice per customer per month/year.
invoiceSchema.index({ customerId: 1, month: 1, year: 1 }, { unique: true });
invoiceSchema.index({ ownerId: 1, status: 1, year: 1, month: 1 });
invoiceSchema.index({ ownerId: 1, createdAt: -1 });

module.exports = mongoose.model("Invoice", invoiceSchema);
