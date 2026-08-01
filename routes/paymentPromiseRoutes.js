// routes/paymentPromiseRoutes.js -- "Promise to Pay" tracking.
// Mounted at /api/promises in server.js.
//
// Covers the common real-world case where a customer doesn't pay when
// called/visited but says "give me 2 days" / "I'll pay on the 1st" / "give
// me a second extension". The operator logs that promise here with a
// concrete follow-up date, and it resurfaces as a reminder (GET /, GET
// /summary) until it's resolved -- either automatically (a payment comes in
// for that customer, see paymentRoutes.js) or manually (kept/broken).
const express = require("express");
const router = express.Router();
const PaymentPromise = require("../models/PaymentPromise");
const Customer = require("../models/Customer");
const User = require("../models/User");
const auth = require("../middleware/auth");
const { logActivity } = require("../services/activityLogger");

function ownerScope(req) {
  return req.user.role === "owner" ? req.user.id : req.user.ownerId;
}

async function assertOwnsCustomer(req, res, customerId) {
  const owns = await Customer.exists({ _id: customerId, ownerId: ownerScope(req) });
  if (!owns) {
    res.status(404).json({ success: false, error: "Customer not found" });
    return false;
  }
  return true;
}

async function assertOwnsPromise(req, res, promiseId) {
  const owns = await PaymentPromise.exists({ _id: promiseId, ownerId: ownerScope(req) });
  if (!owns) {
    res.status(404).json({ success: false, error: "Promise not found" });
    return false;
  }
  return true;
}

// Whole-day granularity for every comparison -- "due today" should match
// regardless of what time of day the promise was originally logged at.
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

// POST /:customerId -- log (or re-log) a promise. If the customer already
// has a pending promise, it's automatically superseded ("rescheduled")
// rather than left dangling -- this is the ONE action operators need for
// both "first promise" and "customer asked for more time" cases, so there's
// no separate reschedule button to hunt for.
router.post("/:customerId", auth, async (req, res) => {
  try {
    const { promisedDate, note } = req.body;
    if (!promisedDate) {
      return res.status(400).json({ success: false, error: "promisedDate is required" });
    }
    if (!(await assertOwnsCustomer(req, res, req.params.customerId))) return;

    const ownerId = ownerScope(req);
    const customer = await Customer.findById(req.params.customerId).select("customerName customerId phone");
    const user = await User.findById(req.user.id).select("name");

    const previous = await PaymentPromise.findOneAndUpdate(
      { customerId: req.params.customerId, ownerId, status: "pending" },
      { status: "rescheduled", resolvedAt: new Date(), resolvedById: req.user.id, resolvedByName: user?.name || "" },
      { new: true }
    );

    const created = await PaymentPromise.create({
      ownerId,
      customerId: req.params.customerId,
      promisedDate: startOfDay(promisedDate),
      note: (note || "").trim(),
      createdById: req.user.id,
      createdByName: user?.name || "",
    });

    if (previous) {
      previous.supersededBy = created._id;
      await previous.save();
    }

    logActivity({
      type: "promise_added",
      reqUser: req.user,
      req,
      customer,
      message: `Logged a payment promise for ${customer?.customerName || "customer"} — ${startOfDay(promisedDate).toLocaleDateString()}${previous ? " (rescheduled)" : ""}`,
      details: { promisedDate: created.promisedDate, note: created.note, rescheduledFrom: previous?._id || null },
    });

    res.status(201).json({ success: true, promise: created });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET / -- the reminder list: every pending promise for this tenant, plus
// each one bucketed into overdue / dueToday / upcoming so the UI doesn't
// have to redo date math. Sorted soonest-due first.
router.get("/", auth, async (req, res) => {
  try {
    const ownerId = ownerScope(req);
    const promises = await PaymentPromise.find({ ownerId, status: "pending" })
      .populate("customerId", "customerName customerId phone address amount")
      .sort({ promisedDate: 1 });

    const today0 = startOfDay(new Date());
    const today1 = endOfDay(new Date());

    const bucketed = promises.map((p) => {
      let bucket = "upcoming";
      if (p.promisedDate < today0) bucket = "overdue";
      else if (p.promisedDate >= today0 && p.promisedDate <= today1) bucket = "dueToday";
      return { ...p.toObject(), bucket };
    });

    res.json({ success: true, promises: bucketed });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /summary -- lightweight counts for a dashboard widget / nav badge.
router.get("/summary", auth, async (req, res) => {
  try {
    const ownerId = ownerScope(req);
    const today0 = startOfDay(new Date());
    const today1 = endOfDay(new Date());

    const [overdue, dueToday, upcoming] = await Promise.all([
      PaymentPromise.countDocuments({ ownerId, status: "pending", promisedDate: { $lt: today0 } }),
      PaymentPromise.countDocuments({ ownerId, status: "pending", promisedDate: { $gte: today0, $lte: today1 } }),
      PaymentPromise.countDocuments({ ownerId, status: "pending", promisedDate: { $gt: today1 } }),
    ]);

    res.json({ success: true, overdue, dueToday, upcoming, total: overdue + dueToday + upcoming });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /customer/:customerId -- full promise history for one customer
// (Notes/Activity-style tab on the profile screen), newest first.
router.get("/customer/:customerId", auth, async (req, res) => {
  try {
    if (!(await assertOwnsCustomer(req, res, req.params.customerId))) return;
    const promises = await PaymentPromise.find({
      customerId: req.params.customerId,
      ownerId: ownerScope(req),
    }).sort({ createdAt: -1 });
    res.json({ success: true, promises });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /:id/kept -- operator manually confirms the customer paid (outside
// the normal payment flow, e.g. cash handed over without going through
// Receive Payment yet, or a past promise being cleaned up).
router.put("/:id/kept", auth, async (req, res) => {
  try {
    if (!(await assertOwnsPromise(req, res, req.params.id))) return;
    const user = await User.findById(req.user.id).select("name");
    const promise = await PaymentPromise.findByIdAndUpdate(
      req.params.id,
      { status: "kept", resolvedAt: new Date(), resolvedById: req.user.id, resolvedByName: user?.name || "" },
      { new: true }
    );
    if (promise) {
      const customer = await Customer.findById(promise.customerId).select("customerName customerId");
      logActivity({
        type: "promise_kept",
        reqUser: req.user,
        req,
        customer,
        message: `Marked payment promise as kept for ${customer?.customerName || "customer"}`,
      });
    }
    res.json({ success: true, promise });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /:id/broken -- customer missed the promised date with no payment and
// no new promise logged. Kept as a record (shows up in a customer's
// history / can inform "chronic non-payer" judgement calls later).
router.put("/:id/broken", auth, async (req, res) => {
  try {
    if (!(await assertOwnsPromise(req, res, req.params.id))) return;
    const user = await User.findById(req.user.id).select("name");
    const promise = await PaymentPromise.findByIdAndUpdate(
      req.params.id,
      { status: "broken", resolvedAt: new Date(), resolvedById: req.user.id, resolvedByName: user?.name || "" },
      { new: true }
    );
    if (promise) {
      const customer = await Customer.findById(promise.customerId).select("customerName customerId");
      logActivity({
        type: "promise_broken",
        reqUser: req.user,
        req,
        customer,
        message: `Marked payment promise as broken for ${customer?.customerName || "customer"}`,
      });
    }
    res.json({ success: true, promise });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /:id -- remove a mistakenly-logged promise.
router.delete("/:id", auth, async (req, res) => {
  try {
    if (!(await assertOwnsPromise(req, res, req.params.id))) return;
    await PaymentPromise.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
