const mongoose = require('mongoose');

const billStatusSchema = new mongoose.Schema({
  customerId: mongoose.Schema.Types.ObjectId,
  month: Number,
  year: Number,
  billStatus: Boolean,
  paymentMethod: String,
  paymentNote: String
}, { timestamps: true });

module.exports = mongoose.model('BillStatus', billStatusSchema);
