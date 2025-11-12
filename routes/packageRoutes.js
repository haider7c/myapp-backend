const express = require('express');
const router = express.Router();
const Package = require('../models/Package');

router.get('/', async (req, res) => {
  try {
    const packages = await Package.find();
    res.json(packages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
