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

// PATCH: mark a bill as unpaid (set billStatus false + clear billReceivedAt)
router.patch("/mark-unpaid/:id", async (req, res) => {
  try {
    const billStatus = await BillStatus.findByIdAndUpdate(
      req.params.id,
      {
        billStatus: false,
        billReceivedAt: null,
        paymentMethod: "",
        paymentNote: "",
      },
      { new: true }
    );

    if (!billStatus) {
      return res.status(404).json({ message: "Bill not found" });
    }

    res.json({ success: true, billStatus });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Mark as paid (safe - no duplicates)
router.patch("/mark-paid", async (req, res) => {
  try {
    const { customerId, month, year, paymentMethod, paymentNote } = req.body;

    // check if exists
    let existing = await BillStatus.findOne({ customerId, month, year });

    if (existing) {
      existing.billStatus = true;
      existing.paymentMethod = paymentMethod || existing.paymentMethod;
      existing.paymentNote = paymentNote || existing.paymentNote;
      existing.billReceivedAt = new Date();       // stamp date
      existing.updatedAt = new Date();            // update date

      await existing.save();

      return res.json({
        success: true,
        message: "Bill marked as PAID (updated existing document)",
        billStatus: existing,
      });
    }

    // else create new
    const newRecord = await BillStatus.create({
      customerId,
      month,
      year,
      billStatus: true,
      paymentMethod,
      paymentNote,
      billReceivedAt: new Date(),
    });

    return res.json({
      success: true,
      message: "Bill marked as PAID (new document created)",
      billStatus: newRecord,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});


module.exports = router;