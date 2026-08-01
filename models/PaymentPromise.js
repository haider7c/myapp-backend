// models/PaymentPromise.js
//
// "Promise to Pay" tracking. Customers often don't pay on the spot when
// called/visited -- they say things like "give me 2 days", "I'll pay on
// the 1st", "pay after 3 days". Instead of that promise living only in the
// operator's memory, it's logged here with a concrete follow-up date so it
// can resurface as a reminder (overdue / due today / upcoming) on both the
// desktop and mobile apps until it's resolved.
//
// `promisedDate` is always an ABSOLUTE date -- relative phrasing ("in 2
// days", "next Monday") is resolved to a real calendar date at the moment
// the operator logs it (see routes/paymentPromiseRoutes.js), so reminder
// queries are just a single date comparison, no relative-date parsing at
// read time.
const mongoose = require("mongoose");

const paymentPromiseSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true, index: true },

    // The date the customer said they'd pay by (whole-day granularity --
    // time of day is normalized away so "due today" is a simple date match).
    promisedDate: { type: Date, required: true },

    // Free-text record of what was actually said/agreed, e.g. "Will pay
    // after 2 days", "Promised to pay on the 1st of next month", "Asked for
    // a second extension". Optional -- a quick-pick date alone is still useful.
    note: { type: String, default: "", trim: true },

    status: {
      type: String,
      enum: ["pending", "kept", "broken", "rescheduled"],
      default: "pending",
      index: true,
    },

    // When a promise is broken/missed and the customer asks for MORE time,
    // it's rescheduled: this (old, now status="rescheduled") document links
    // forward to the new one, so the full negotiation history stays visible
    // instead of silently overwriting the original promise.
    supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentPromise", default: null },

    createdById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdByName: { type: String, default: "" },

    // Set when status moves out of "pending" (kept/broken/rescheduled).
    resolvedAt: { type: Date, default: null },
    resolvedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedByName: { type: String, default: "" },
  },
  { timestamps: true }
);

// Primary access pattern: "give me this owner's pending promises, soonest
// first" -- used for both the reminder list and the due/overdue/upcoming
// summary counts.
paymentPromiseSchema.index({ ownerId: 1, status: 1, promisedDate: 1 });
paymentPromiseSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.model("PaymentPromise", paymentPromiseSchema);
