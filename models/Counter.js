const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  name: String,
  value: Number
});

module.exports = mongoose.model('Counter', counterSchema);
