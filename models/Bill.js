const mongoose = require('mongoose');

const billSchema = new mongoose.Schema({
  customerId: mongoose.Schema.Types.ObjectId,
  billMonth: String,
  billReceiveDate: Date,
  billStatus: Boolean,
  amount: Number
}, { timestamps: true });

module.exports = mongoose.model('Bill', billSchema);
