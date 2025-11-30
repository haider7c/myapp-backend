// routes/billstatuses.js
const express = require('express');
const router = express.Router();
const BillStatus = require('../models/BillStatus');

// GET all bill statuses
router.get('/', async (req, res) => {
  try {
    const statuses = await BillStatus.find();
    res.json(statuses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST new bill status
router.post('/', async (req, res) => {
  try {
    const payload = { ...req.body };

    // ⭐ Automatically save billReceivedAt only when billStatus=true
    if (payload.billStatus === true) {
      payload.billReceivedAt = new Date();
    }

    const billStatus = new BillStatus(payload);
    const newBillStatus = await billStatus.save();
    res.status(201).json(newBillStatus);

  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});


// PUT update bill status
router.put('/:id', async (req, res) => {
  try {
    const billStatus = await BillStatus.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!billStatus) {
      return res.status(404).json({ message: 'Bill status not found' });
    }
    res.json(billStatus);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;