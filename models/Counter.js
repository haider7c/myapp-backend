const mongoose = require('mongoose');

// Sequence counters (customer serial numbers, invoice numbers, receipt
// numbers, manual-bill invoice numbers) used to be a single shared document
// per `name`, keyed only by name -- meaning every tenant's numbering
// sequences were interleaved with every other tenant's. ownerId splits each
// named sequence into one independent counter per tenant. `ownerId: null`
// is kept as a valid value for any legacy/system-wide counter that isn't
// tenant-specific, but every route that touches these now always passes a
// real ownerId.
const counterSchema = new mongoose.Schema({
  name: String,
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  value: Number
});

counterSchema.index({ name: 1, ownerId: 1 }, { unique: true });

module.exports = mongoose.model('Counter', counterSchema);
