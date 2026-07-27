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

// Verifies a customerId belongs to the requester's tenant before touching
// anything for it. Every route below that takes a customerId param uses
// this first -- previously several of them queried/acted on Invoice or
// Customer records with no ownerId check at all, so any logged-in user
// could view or financially adjust another tenant's invoices just by
// knowing (or guessing) a customerId.
async function assertOwnsCustomer(req, res, customerId) {
  const owns = await Customer.exists({ _id: customerId, ownerId: ownerScope(req) });
  if (!owns) {
    res.status(404).json({ success: false, error: "Customer not found" });
    return false;
  }
  return true;
}

// GET last N invoices for a customer (default 5) -- req 1's dropdown.
router.get("/customer/:customerId/recent", auth, async (req, res) => {
  try {
    if (!(await assertOwnsCustomer(req, res, req.params.customerId))) return;
    const limit = Math.min(parseInt(req.query.limit) || 5, 24);
    const invoices = await Invoice.find({ customerId: req.params.customerId, ownerId: ownerScope(req) })
      .sort({ year: -1, month: -1 })
      .limit(limit);
    res.json({ success: true, invoices });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET the exact previous N calendar months (excluding the current month)
// for a customer, oldest first, each with that month's real paid/unpaid
// status -- used by the customer-card "Last N Months" dropdown. Unlike
// /recent (which returns whichever invoice documents happen to exist,
// most recent first, possibly including the current month), this always
// returns exactly `count` real calendar months in calendar order, even if
// no invoice was ever generated for one of them.
router.get("/customer/:customerId/last-months", auth, async (req, res) => {
  try {
    if (!(await assertOwnsCustomer(req, res, req.params.customerId))) return;
    const count = Math.min(parseInt(req.query.count) || 3, 12);
    const ownerId = ownerScope(req);

    const now = new Date();
    let month = now.getMonth() + 1; // 1-12, current month
    let year = now.getFullYear();

    const targets = [];
    for (let i = 0; i < count; i++) {
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      targets.unshift({ month, year }); // unshift so the oldest month ends up first
    }

    const months = await Promise.all(
      targets.map(async ({ month, year }) => {
        const invoice = await Invoice.findOne({
          customerId: req.params.customerId,
          ownerId,
          month,
          year,
        }).select("status");
        return { month, year, status: invoice ? invoice.status : "no_bill" };
      })
    );

    res.json({ success: true, months });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET complete billing history, paginated -- req 1's "Complete Billing History".
router.get("/customer/:customerId/full", auth, async (req, res) => {
  try {
    if (!(await assertOwnsCustomer(req, res, req.params.customerId))) return;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const filter = { customerId: req.params.customerId, ownerId: ownerScope(req) };
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
    if (!(await assertOwnsCustomer(req, res, req.params.customerId))) return;
    const invoices = await Invoice.find({
      customerId: req.params.customerId,
      ownerId: ownerScope(req),
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
    if (!(await assertOwnsCustomer(req, res, req.params.customerId))) return;
    const summary = await billingEngine.getFinancialSummary(req.params.customerId);
    res.json({ success: true, summary });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET billing timeline (req 8) -- default last 12 months.
router.get("/customer/:customerId/timeline", auth, async (req, res) => {
  try {
    if (!(await assertOwnsCustomer(req, res, req.params.customerId))) return;
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
    if (!(await assertOwnsCustomer(req, res, customerId))) return;
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

// Verifies an invoice _id belongs to the requester's tenant before any
// adjustment route acts on it -- previously these took an invoice _id
// straight from the URL with no check that it belonged to the caller.
async function assertOwnsInvoice(req, res, invoiceId) {
  const owns = await Invoice.exists({ _id: invoiceId, ownerId: ownerScope(req) });
  if (!owns) {
    res.status(404).json({ success: false, error: "Invoice not found" });
    return false;
  }
  return true;
}

router.post("/:id/discount", auth, requireOwner, async (req, res) => {
  try {
    if (!(await assertOwnsInvoice(req, res, req.params.id))) return;
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
    if (!(await assertOwnsInvoice(req, res, req.params.id))) return;
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
    if (!(await assertOwnsInvoice(req, res, req.params.id))) return;
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
    if (!(await assertOwnsCustomer(req, res, req.params.customerId))) return;
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
    const invoice = await Invoice.findOne({ _id: req.params.id, ownerId: ownerScope(req) }).populate("customerId");
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
