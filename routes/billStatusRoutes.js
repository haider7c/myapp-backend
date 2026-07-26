// routes/billstatuses.js
const express = require('express');
const router = express.Router();
const BillStatus = require('../models/BillStatus');
const Customer = require('../models/Customer');
const auth = require('../middleware/auth');
const { logActivity } = require('../services/activityLogger');

function ownerScope(req) {
  return req.user.role === "owner" ? req.user.id : req.user.ownerId;
}

// GET all bill statuses (scoped to the logged-in owner's tenant)
router.get('/', auth, async (req, res) => {
  try {
    const statuses = await BillStatus.find({ ownerId: ownerScope(req) });
    res.json(statuses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET bill statuses for a given month/year (populated) — ported from the
// desktop app's monthly billing view.
router.get('/monthly', auth, async (req, res) => {
  const { month, year } = req.query;
  try {
    if (!month || !year) {
      return res.status(400).json({ message: 'Month and year are required' });
    }
    const statuses = await BillStatus.find({
      ownerId: ownerScope(req),
      month: parseInt(month),
      year: parseInt(year),
    }).populate('customerId');
    res.json(statuses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET a bill status by its recorded transaction ID — ported from desktop.
router.get('/transaction/:transactionId', auth, async (req, res) => {
  try {
    const billStatus = await BillStatus.findOne({
      transactionId: req.params.transactionId,
      ownerId: ownerScope(req),
    }).populate('customerId');
    if (!billStatus) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }
    res.json({ success: true, billStatus });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET a customer's payment history — ported from desktop.
router.get('/customer/:customerId', auth, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const payments = await BillStatus.find({
      customerId: req.params.customerId,
      ownerId: ownerScope(req),
      billStatus: true,
    })
      .sort({ paymentDate: -1, billReceivedAt: -1 })
      .limit(parseInt(limit))
      .populate('customerId');
    res.json({ success: true, payments });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT upsert a bill status by customerId+month+year. Separate from the
// existing POST / (which always creates, and stays untouched so nothing
// that already depends on that behavior breaks) — this is what the
// desktop app's "save bill status" flow uses instead, to avoid creating
// duplicate rows for the same customer/month.
router.put('/upsert', auth, async (req, res) => {
  const { customerId, month, year, billStatus, paymentMethod, paymentNote } = req.body;
  try {
    const ownerId = ownerScope(req);
    let doc = await BillStatus.findOne({ customerId, month, year, ownerId });
    if (doc) {
      doc.billStatus = billStatus;
      doc.paymentMethod = paymentMethod;
      doc.paymentNote = paymentNote;
    } else {
      doc = new BillStatus({ customerId, month, year, billStatus, paymentMethod, paymentNote, ownerId });
    }
    const saved = await doc.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// POST new bill status
router.post('/', auth, async (req, res) => {
  try {
    const payload = { ...req.body, ownerId: ownerScope(req) };

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
router.put('/:id', auth, async (req, res) => {
  try {
    const { ownerId, ...updateData } = req.body; // never let the client move a record to another tenant
    const billStatus = await BillStatus.findOneAndUpdate(
      { _id: req.params.id, ownerId: ownerScope(req) },
      updateData,
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
router.patch("/mark-unpaid/:id", auth, async (req, res) => {
  try {
    const billStatus = await BillStatus.findOneAndUpdate(
      { _id: req.params.id, ownerId: ownerScope(req) },
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

// Mark as paid (safe - no duplicates). transactionId/paymentAmount/paymentDate
// are optional and only used by the desktop app's payment-recording flow —
// existing callers that don't send them behave exactly as before.
router.patch("/mark-paid", auth, async (req, res) => {
  try {
    const {
      customerId,
      month,
      year,
      paymentMethod,
      paymentNote,
      transactionId,
      paymentAmount,
      paymentDate,
    } = req.body;

    const ownerId = ownerScope(req);

    // Verify the customerId in the body actually belongs to this
    // requester's tenant before touching/creating anything for it.
    const customer = await Customer.findOne({ _id: customerId, ownerId }).catch(() => null);
    if (!customer) {
      return res.status(404).json({ success: false, error: "Customer not found" });
    }

    const extra = {};
    if (transactionId !== undefined) {
      extra.transactionId = transactionId;
      extra.received = true;
      extra.receiptSent = true;
      extra.receiptSentAt = new Date();
    }
    if (paymentAmount !== undefined) extra.paymentAmount = paymentAmount;
    if (paymentDate !== undefined) extra.paymentDate = new Date(paymentDate);

    // check if exists
    let existing = await BillStatus.findOne({ customerId, month, year, ownerId });
    const amountForLog = paymentAmount ?? customer?.amount ?? null;

    if (existing) {
      existing.billStatus = true;
      existing.paymentMethod = paymentMethod || existing.paymentMethod;
      existing.paymentNote = paymentNote || existing.paymentNote;
      existing.billReceivedAt = new Date();       // stamp date
      existing.updatedAt = new Date();            // update date
      Object.assign(existing, extra);

      await existing.save();

      logActivity({
        type: "bill_payment",
        reqUser: req.user,
        customer,
        message: `Payment received from ${customer?.customerName || "customer"}${amountForLog ? ` (Rs. ${amountForLog})` : ""}`,
        details: { amount: amountForLog, method: paymentMethod, month, year, transactionId, source: "billstatus.mark-paid" },
      });

      return res.json({
        success: true,
        message: "Bill marked as PAID (updated existing document)",
        billStatus: existing,
      });
    }

    // else create new
    const newRecord = await BillStatus.create({
      customerId,
      ownerId,
      month,
      year,
      billStatus: true,
      paymentMethod,
      paymentNote,
      billReceivedAt: new Date(),
      ...extra,
    });

    logActivity({
      type: "bill_payment",
      reqUser: req.user,
      customer,
      message: `Payment received from ${customer?.customerName || "customer"}${amountForLog ? ` (Rs. ${amountForLog})` : ""}`,
      details: { amount: amountForLog, method: paymentMethod, month, year, transactionId, source: "billstatus.mark-paid" },
    });

    return res.json({
      success: true,
      message: "Bill marked as PAID (new document created)",
      billStatus: newRecord,
    });

  } catch (err) {
    console.error(err);
    if (err.code === 11000 && err.keyPattern?.transactionId) {
      return res.status(400).json({
        success: false,
        error: "Transaction ID already exists. Please generate a new one.",
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});


module.exports = router;
