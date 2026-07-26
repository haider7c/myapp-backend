const mongoose = require('mongoose');

const billStatusSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  customerId: mongoose.Schema.Types.ObjectId,
  month: Number,
  year: Number,
  billStatus: Boolean,
  paymentMethod: String,
  paymentNote: String,
  billReceivedAt: {
  type: Date,
  default: null
},

  // --- Added for desktop-app compatibility (transaction-tracked payments,
  // receipt sending). Purely additive — existing documents/routes that
  // never set these fields are unaffected. No compound unique index is
  // added here on purpose, to avoid changing the existing POST / route's
  // create-always behavior that the mobile app already relies on.
  received: { type: Boolean, default: false },
  transactionId: { type: String, unique: true, sparse: true },
  paymentAmount: Number,
  paymentDate: Date,
  receiptSent: { type: Boolean, default: false },
  receiptSentAt: Date,

}, { timestamps: true });

billStatusSchema.index({ transactionId: 1 });

module.exports = mongoose.model('BillStatus', billStatusSchema);
