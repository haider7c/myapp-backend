// models/ActivityLog.js
//
// A single audit trail covering the actions the owner wants visibility
// into: internet enable/disable, bill payments, customer create/update/
// discontinue, and WhatsApp reminders sent. Denormalizes customer/actor
// names onto each entry so the ledger page can render instantly without
// a populate/join per row.
const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        "internet_enabled",
        "internet_disabled",
        "bill_payment",
        "customer_created",
        "customer_updated",
        "customer_discontinued",
        "whatsapp_sent",
      ],
      index: true,
    },

    // Tenant scoping -- matches Customer.ownerId's convention so the ledger
    // only ever shows one owner's own activity.
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Denormalized customer info (customer may later be edited/deleted;
    // the log entry should keep showing what it looked like at the time).
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
    customerName: { type: String, default: "" },
    customerBusinessId: { type: String, default: "" }, // Customer.customerId (business ID / PPPoE username)

    // Who performed the action (denormalized display name -- User docs can
    // be renamed/deleted later without breaking old log entries).
    performedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    performedByName: { type: String, default: "" },
    performedByRole: { type: String, default: "" },

    // Short human-readable summary line for display (e.g. "Enabled internet
    // for John Doe (CUST-042)"), plus a details bag for anything extra
    // specific to that activity type (amount, method, message text, etc.)
    message: { type: String, default: "" },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

activityLogSchema.index({ ownerId: 1, createdAt: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);
