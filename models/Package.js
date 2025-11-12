const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema({
  name: String,
  speed: String,
  defaultAmount: Number
}, { timestamps: true });

module.exports = mongoose.model('Package', packageSchema);
