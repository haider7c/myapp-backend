// routes/invoiceRoutes.js -- Billing & Customer Management module.
// Mounted at /api/invoices in server.js. Reads/writes go through
// services/billingEngine.js so the running-balance math only lives in one
// place. Does not touch BillStatus or any existing route.
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Invoice = require("../models/Invoice");
const Customer = require("../models/Customer");
const auth = require("../middleware/auth");
const billingEngine = require("../services/billingEngine");

function ownerScope(req) {
  return req.user.role === "owner" ? req.user.id : req.user.ownerId;
}

// GET last N invoices for a customer (default 5) -- req 1's dropdown.
router.get("/customer/:customerId/recent", auth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 5, 24);
    const invoices = await Invoice.find({ customerId: req.params.customerId })
      .sort({ year: -1, month: -1 })
      .limit(limit);
    res.json({ success: true, invoices });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET complete billing history, paginated -- req 1's "Complete Billing History".
router.get("/customer/:customerId/full", auth, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const filter = { customerId: req.params.customerId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.year) filter.year = parseInt(req.query.year);
    if (req.query.month) filter.month = parseInt(req.query.month);

    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .sort({ year: -1, month: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Invoice.countDocuments(filter),
    ]);

    res.json({ success: true, invoices, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET every unpaid/partial/overdue invoice for a customer, oldest first --
// this is exactly the list the "flexible payment" screen (req 2-3) needs to
// let the operator pick which month(s) to pay.
router.get("/customer/:customerId/pending", auth, async (req, res) => {
  try {
    const invoices = await Invoice.find({
      customerId: req.params.customerId,
      status: { $in: ["pending", "partial", "overdue"] },
    }).sort({ year: 1, month: 1 });

    const totalDue = invoices.reduce((sum, inv) => sum + Math.max(inv.closingBalance, 0), 0);
    res.json({ success: true, invoices, totalDue });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET financial summary cards (req 9).
router.get("/customer/:customerId/summary", auth, async (req, res) => {
  try {
    const summary = await billingEngine.getFinancialSummary(req.params.customerId);
    res.json({ success: true, summary });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET billing timeline (req 8) -- default last 12 months.
router.get("/customer/:customerId/timeline", auth, async (req, res) => {
  try {
    const months = Math.min(parseInt(req.query.months) || 12, 36);
    const timeline = await billingEngine.getBillingTimeline(req.params.customerId, months);
    res.json({ success: true, timeline });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST generate (get-or-create) an invoice for a given customer/month/year.
router.post("/generate", auth, async (req, res) => {
  try {
    const { customerId, month, year } = req.body;
    if (!customerId || !month || !year) {
      return res.status(400).json({ success: false, error: "customerId, month and year are required" });
    }
    const invoice = await billingEngine.generateInvoice(customerId, parseInt(month), parseInt(year), {
      generatedBy: req.user.id,
    });
    res.status(201).json({ success: true, invoice });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Manual adjustments -- owner only (financial corrections).
function requireOwner(req, res, next) {
  if (req.user.role !== "owner") {
    return res.status(403).json({ success: false, error: "Only the owner can make billing adjustments" });
  }
  next();
}

router.post("/:id/discount", auth, requireOwner, async (req, res) => {
  try {
    const invoice = await billingEngine.applyDiscount(req.params.id, Number(req.body.amount), {
      reason: req.body.reason,
      reqUser: req.user,
      req,
    });
    res.json({ success: true, invoice });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/:id/late-fee", auth, requireOwner, async (req, res) => {
  try {
    const invoice = await billingEngine.addLateFee(req.params.id, Number(req.body.amount), {
      reason: req.body.reason,
      reqUser: req.user,
      req,
    });
    res.json({ success: true, invoice });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/:id/waive", auth, requireOwner, async (req, res) => {
  try {
    const invoice = await billingEngine.waiveCharges(req.params.id, Number(req.body.amount), {
      reason: req.body.reason,
      reqUser: req.user,
      req,
    });
    res.json({ success: true, invoice });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/customer/:customerId/manual-due", auth, requireOwner, async (req, res) => {
  try {
    const invoice = await billingEngine.addManualDue(req.params.customerId, Number(req.body.amount), {
      reason: req.body.reason,
      reqUser: req.user,
      req,
    });
    res.json({ success: true, invoice });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET a single invoice by ID (for printing / detail view).
router.get("/:id", auth, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id).populate("customerId");
    if (!invoice) return res.status(404).json({ success: false, error: "Invoice not found" });
    res.json({ success: true, invoice });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET / search+filter invoices across all of the tenant's customers (req 10-11).
router.get("/", auth, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const { status, month, year, invoiceNumber, search } = req.query;

    const filter = { ownerId: ownerScope(req) };
    if (status) filter.status = status;
    if (month) filter.month = parseInt(month);
    if (year) filter.year = parseInt(year);
    if (invoiceNumber) filter.invoiceNumber = { $regex: invoiceNumber, $options: "i" };

    if (search) {
      const customers = await Customer.find({
        ownerId: ownerScope(req),
        $or: [
          { customerName: { $regex: search, $options: "i" } },
          { customerId: { $regex: search, $options: "i" } },
          { cnic: { $regex: search, $options: "i" } },
          { phone: { $regex: search, $options: "i" } },
          { username: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      filter.customerId = { $in: customers.map((c) => c._id) };
    }

    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .populate("customerId", "customerName customerId phone cnic")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Invoice.countDocuments(filter),
    ]);

    res.json({ success: true, invoices, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
