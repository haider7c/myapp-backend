const express = require('express');
const router = express.Router();
const Counter = require('../models/Counter');

router.get('/', async (req, res) => {
  try {
    const counters = await Counter.find();
    res.json(counters);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
