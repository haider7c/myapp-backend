const mongoose = require('mongoose');

const manualBillSchema = new mongoose.Schema({
  customerName: String,
  date: String,
  billAmount: Number,
  months: Number,
  connectionFee: Number,
  additions: Array,
  packageName: String,
  totalAmount: Number
});

module.exports = mongoose.model('ManualBill', manualBillSchema);
