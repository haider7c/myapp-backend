const express = require('express');
const router = express.Router();
const BillStatus = require('../models/BillStatus');

router.get('/', async (req, res) => {
  try {
    const statuses = await BillStatus.find();
    res.json(statuses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
