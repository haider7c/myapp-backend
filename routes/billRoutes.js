const express = require('express');
const router = express.Router();
const Bill = require('../models/Bill.js');

// Get all bills
router.get('/', async (req, res) => {
  try {
    const bills = await Bill.find();
    res.json(bills);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get bill by ID
router.get('/:id', async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id);
    res.json(bill);
  } catch (err) {
    res.status(404).json({ message: 'Bill not found' });
  }
});

module.exports = router;
