const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  name: String,
  speed: String,
  defaultAmount: Number
}, { timestamps: true });

module.exports = mongoose.model('Package', packageSchema);
