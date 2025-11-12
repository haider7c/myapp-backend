const express = require('express');
const router = express.Router();
const ManualBill = require('../models/ManualBill');

router.get('/', async (req, res) => {
  try {
    const manualBills = await ManualBill.find();
    res.json(manualBills);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
