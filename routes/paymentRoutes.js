// routes/paymentRoutes.js -- Billing & Customer Management module.
// Mounted at /api/payments in server.js.
const express = require("express");
const router = express.Router();
const Payment = require("../models/Payment");
const Customer = require("../models/Customer");
const auth = require("../middleware/auth");
const billingEngine = require("../services/billingEngine");

function ownerScope(req) {
  return req.user.role === "owner" ? req.user.id : req.user.ownerId;
}

function requireOwner(req, res, next) {
  if (req.user.role !== "owner") {
    return res.status(403).json({ success: false, error: "Only the owner can reverse a payment" });
  }
  next();
}

// POST receive a payment -- single month, multiple months, partial, and/or
// advance, all through the same call (req 2-5). `items` is an ordered list
// of { invoiceId } or { month, year } (for a not-yet-generated future
// month). Any leftover amount after covering every item becomes advance
// credit automatically.
router.post("/", auth, async (req, res) => {
  try {
    const { customerId, items, totalAmount, paymentMethod, transactionId, remarks, paymentDate } = req.body;
    if (!customerId || !totalAmount) {
      return res.status(400).json({ success: false, error: "customerId and totalAmount are required" });
    }

    const result = await billingEngine.applyPayment({
      customerId,
      items: Array.isArray(items) ? items : [],
      totalAmount: Number(totalAmount),
      paymentMethod,
      transactionId,
      remarks,
      paymentDate,
      reqUser: req.user,
      req,
    });

    res.status(201).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST reverse a payment (req 7, 12) -- owner only, requires a reason.
router.post("/:id/reverse", auth, requireOwner, async (req, res) => {
  try {
    const result = await billingEngine.reversePayment(req.params.id, {
      reason: req.body.reason || "",
      reqUser: req.user,
      req,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET a customer's full payment ledger, paginated.
router.get("/customer/:customerId", auth, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const [payments, total] = await Promise.all([
      Payment.find({ customerId: req.params.customerId })
        .sort({ paymentDate: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Payment.countDocuments({ customerId: req.params.customerId }),
    ]);

    res.json({ success: true, payments, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET / search+filter payments across the tenant (req 10-11): month, year,
// paymentMethod, operator, date range, and free-text search across
// customer name/CNIC/phone/invoice/receipt/transaction ID.
router.get("/", auth, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const { paymentMethod, operatorId, dateFrom, dateTo, search, receiptNumber, transactionId, isReversed } = req.query;

    const filter = { ownerId: ownerScope(req) };
    if (paymentMethod) filter.paymentMethod = paymentMethod;
    if (operatorId) filter.operatorId = operatorId;
    if (receiptNumber) filter.receiptNumber = { $regex: receiptNumber, $options: "i" };
    if (transactionId) filter.transactionId = { $regex: transactionId, $options: "i" };
    if (isReversed !== undefined) filter.isReversed = isReversed === "true";
    if (dateFrom || dateTo) {
      filter.paymentDate = {};
      if (dateFrom) filter.paymentDate.$gte = new Date(dateFrom);
      if (dateTo) filter.paymentDate.$lte = new Date(dateTo);
    }

    if (search) {
      const customers = await Customer.find({
        ownerId: ownerScope(req),
        $or: [
          { customerName: { $regex: search, $options: "i" } },
          { customerId: { $regex: search, $options: "i" } },
          { cnic: { $regex: search, $options: "i" } },
          { phone: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      filter.customerId = { $in: customers.map((c) => c._id) };
    }

    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .populate("customerId", "customerName customerId phone cnic")
        .sort({ paymentDate: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Payment.countDocuments(filter),
    ]);

    res.json({ success: true, payments, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
