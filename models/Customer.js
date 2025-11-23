const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  serialNumber: String,
  customerName: String,
  phone: String,
  address: String,
  cnic: String,
  regDate: Date,
  billReceiveDate: Number,
  customerId: String,
  email: String,
  synced: Boolean,
  packageName: String,
  amount: Number,
  status: {
  type: String,
  enum: ["active", "discontinued"],
  default: "active",
},
discontinuedAt: {
  type: Date,
  default: null,
},


}, { timestamps: true });

module.exports = mongoose.model('Customer', customerSchema);
