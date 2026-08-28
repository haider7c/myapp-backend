// routes/billstatuses.js
const express = require('express');
const router = express.Router();
const BillStatus = require('../models/BillStatus');
const Customer = require('../models/Customer');
const auth = require('../middleware/auth');
const { logActivity } = require('../services/activityLogger');

// Quick Bill Receive (chat-style "type the customer ID, we do the rest")
// needs the same WhatsApp payment-receipt sender the "Send Payment Receipt"
// button already uses, so the message text stays whatever the owner has
// configured under Reminder Templates > Payment Received, instead of a
// second hardcoded copy drifting out of sync with it.
const ExpiryChecker = require('../services/expiryChecker');
const createWhatsAppService = require('../services/whatsappService');
const whatsappServicePromise = createWhatsAppService();
const expiryChecker = new ExpiryChecker(whatsappServicePromise);

function ownerScope(req) {
  return req.user.role === "owner" ? req.user.id : req.user.ownerId;
}

// Escapes a user-typed string for safe use inside a RegExp (so a customer ID
// containing e.g. "+" or "(" can't break the query or turn into an
// unintended pattern).
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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


// Quick Bill Receive -- the "chat" flow: the operator types (or pastes) just
// the customer's ID, this looks them up, marks the current month's bill as
// received, and fires off the WhatsApp "payment received" confirmation --
// all in one call, so there's no need to open the customer, find the bill,
// tick paid, then separately hit "send receipt" for the common case of "this
// exact ID paid, go".
//
// Matching is EXACT (case-insensitive) on purpose -- this is meant to be
// fast and unambiguous, not a fuzzy search that could mark the wrong
// customer's bill paid from a partial ID. Checks the primary customerId,
// the login-style username/PPPoE username, and any additional connection
// IDs under the same customer record.
router.post("/quick-receive", auth, async (req, res) => {
  try {
    const raw = String(req.body.customerId || "").trim();
    if (!raw) {
      return res.status(400).json({ success: false, code: "EMPTY", error: "Customer ID is required" });
    }

    const ownerId = ownerScope(req);
    const exact = new RegExp(`^${escapeRegex(raw)}$`, "i");

    const customer = await Customer.findOne({
      ownerId,
      $or: [
        { customerId: exact },
        { username: exact },
        { pppoeUsername: exact },
        { "additionalConnections.customerId": exact },
      ],
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        error: `No customer found with ID "${raw}".`,
      });
    }

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    let billStatus = await BillStatus.findOne({ customerId: customer._id, month, year, ownerId });
    const alreadyPaid = !!(billStatus && billStatus.billStatus === true);

    if (!billStatus) {
      billStatus = new BillStatus({ customerId: customer._id, ownerId, month, year });
    }

    if (!alreadyPaid) {
      billStatus.billStatus = true;
      billStatus.received = true;
      billStatus.paymentMethod = billStatus.paymentMethod || "Cash";
      billStatus.paymentAmount = customer.amount;
      billStatus.paymentDate = now;
      billStatus.billReceivedAt = now;
      await billStatus.save();

      logActivity({
        type: "bill_payment",
        reqUser: req.user,
        customer,
        message: `Payment received from ${customer.customerName}${customer.amount ? ` (Rs. ${customer.amount})` : ""} via Quick Bill Receive`,
        details: { amount: customer.amount, month, year, source: "billstatus.quick-receive" },
      });
    }

    // Fire the WhatsApp confirmation. Never sent twice for the same
    // already-paid bill (re-sending the same ID a second time just confirms
    // it's already marked, without spamming the customer again).
    let whatsapp = { sent: false, skipped: true, error: "Already marked paid earlier -- message not re-sent" };
    if (!alreadyPaid) {
      if (!customer.phone) {
        whatsapp = { sent: false, error: "Customer has no phone number on file" };
      } else {
        try {
          const result = await expiryChecker.sendPaymentReceipt(customer._id, {
            amount: customer.amount,
            method: billStatus.paymentMethod || "Cash",
          });
          whatsapp = result.success ? { sent: true } : { sent: false, error: result.error };
        } catch (waErr) {
          whatsapp = { sent: false, error: waErr.message };
        }
      }

      if (whatsapp.sent) {
        logActivity({
          type: "whatsapp_sent",
          reqUser: req.user,
          customer,
          message: `Sent payment receipt to ${customer.customerName} via Quick Bill Receive`,
          details: { kind: "payment_receipt", source: "quick-receive" },
        });
      }
    }

    res.json({
      success: true,
      alreadyPaid,
      customer: {
        _id: customer._id,
        customerName: customer.customerName,
        customerId: customer.customerId,
        phone: customer.phone,
        amount: customer.amount,
        packageName: customer.packageName,
      },
      billStatus,
      whatsapp,
    });
  } catch (error) {
    console.error("quick-receive error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
