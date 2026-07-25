// models/CustomerNote.js
//
// Internal operator notes on a customer's Customer Management page (req 12).
// Never edited/deleted through the API -- notes are an append-only log, same
// philosophy as the payment ledger and activity log.
const mongoose = require("mongoose");

const customerNoteSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    note: { type: String, required: true },

    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    authorName: { type: String, default: "" },
  },
  { timestamps: true } // createdAt doubles as the note's Date+Time
);

customerNoteSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.model("CustomerNote", customerNoteSchema);
