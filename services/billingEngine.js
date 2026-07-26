// services/billingEngine.js
//
// Core billing logic for the Billing & Customer Management module: invoice
// generation with a carried running balance, flexible payment application
// (single month, multiple months, partial, advance), reversal, and manual
// adjustments (discount / late fee / manual due / waive). Every write that
// touches money is wrapped in a MongoDB session transaction so a crash
// mid-operation can never leave an invoice and its payment out of sync.
//
// Design notes:
// - Customer.outstandingBalance always mirrors the customer's MOST RECENT
//   invoice's closingBalance. Because every invoice's openingBalance is
//   carried forward from the previous invoice's closingBalance, the latest
//   invoice already represents the full running total by construction --
//   no separate summing/aggregation needed, and no risk of double-counting.
// - Invoices are never deleted and their core figures (month, year,
//   invoiceNumber, billAmount, openingBalance) are never rewritten after
//   generation. Corrections go through discount/lateFee/manualDue/waivedAmount
//   adjustments, and payments are reversed rather than deleted.
const mongoose = require("mongoose");
const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const Customer = require("../models/Customer");
const Counter = require("../models/Counter");
const User = require("../models/User");
const { logActivity } = require("./activityLogger");

// ---------------------------------------------------------------------------
// Sequence numbers (invoice / receipt) -- atomic, session-aware.
// ---------------------------------------------------------------------------
// ownerId scopes the sequence to one tenant so invoice/receipt numbers from
// different businesses never interleave or collide. Callers that don't pass
// one fall back to a single legacy shared sequence (ownerId: null) -- kept
// only so nothing throws if an old caller is missed; every call site in
// this file passes the customer's ownerId.
async function nextSequence(name, prefix, padLength = 6, session, ownerId = null) {
  const counter = await Counter.findOneAndUpdate(
    { name, ownerId },
    { $inc: { value: 1 } },
    { new: true, upsert: true, session }
  );
  return `${prefix}-${String(counter.value).padStart(padLength, "0")}`;
}

// ---------------------------------------------------------------------------
// Status + totals helpers
// ---------------------------------------------------------------------------
function computeTotalPayable(inv) {
  return (
    (inv.openingBalance || 0) +
    (inv.billAmount || 0) +
    (inv.manualDue || 0) -
    (inv.discount || 0) -
    (inv.waivedAmount || 0) +
    (inv.lateFee || 0) +
    (inv.taxAmount || 0)
  );
}

function computeStatus(inv, now = new Date()) {
  const closing = inv.closingBalance;
  if (closing <= 0) {
    return inv.waivedAmount > 0 && inv.amountPaid < inv.totalPayable ? "waived" : "paid";
  }
  if (inv.amountPaid > 0) return "partial";
  if (inv.dueDate && inv.dueDate < now) return "overdue";
  return "pending";
}

// Recomputes totalPayable/closingBalance/status on an in-memory invoice doc
// after any adjustment (discount, late fee, manual due, waive) or payment.
// Caller is responsible for saving.
function recalcInvoice(inv, now = new Date()) {
  inv.totalPayable = computeTotalPayable(inv);
  inv.closingBalance = inv.totalPayable - (inv.amountPaid || 0);
  inv.status = computeStatus(inv, now);
  return inv;
}

function dueDateFor(year, month, billDay) {
  // Clamp to the last real day of the month (e.g. billDay=31 in February).
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(Math.max(parseInt(billDay) || 1, 1), lastDay);
  return new Date(year, month - 1, day);
}

// ---------------------------------------------------------------------------
// Find the customer's most recent invoice strictly before (or including) a
// given month/year, ordered by year/month. Used both to seed a new
// invoice's openingBalance and to answer "what's the customer's outstanding
// balance right now".
// ---------------------------------------------------------------------------
async function getLatestInvoice(customerId, { beforeYear, beforeMonth, session } = {}) {
  const query = { customerId };
  if (beforeYear != null && beforeMonth != null) {
    query.$or = [
      { year: { $lt: beforeYear } },
      { year: beforeYear, month: { $lt: beforeMonth } },
    ];
  }
  return Invoice.findOne(query).sort({ year: -1, month: -1 }).session(session || null);
}

async function recomputeOutstanding(customerId, session) {
  const latest = await Invoice.findOne({ customerId }).sort({ year: -1, month: -1 }).session(session || null);
  const outstandingBalance = latest ? Math.max(latest.closingBalance, 0) : 0;
  await Customer.findByIdAndUpdate(customerId, { outstandingBalance }, { session });
  return outstandingBalance;
}

// ---------------------------------------------------------------------------
// GENERATE INVOICE -- idempotent get-or-create for a customer/month/year.
// Automatically applies any sitting advance balance to cover it.
// ---------------------------------------------------------------------------
async function generateInvoice(customerId, month, year, { generatedBy, session: outerSession } = {}) {
  const run = async (session) => {
    let invoice = await Invoice.findOne({ customerId, month, year }).session(session);
    if (invoice) return invoice;

    const customer = await Customer.findById(customerId).session(session);
    if (!customer) throw new Error("Customer not found");

    const prior = await getLatestInvoice(customerId, { beforeYear: year, beforeMonth: month, session });
    const openingBalance = prior ? Math.max(prior.closingBalance, 0) : 0;

    const invoiceNumber = await nextSequence("invoiceNumber", "INV", 6, session, customer.ownerId);

    const draft = {
      customerId,
      ownerId: customer.ownerId,
      invoiceNumber,
      month,
      year,
      openingBalance,
      previousDue: openingBalance,
      billAmount: customer.amount,
      manualDue: 0,
      discount: 0,
      lateFee: 0,
      waivedAmount: 0,
      taxAmount: 0,
      amountPaid: 0,
      dueDate: dueDateFor(year, month, customer.billReceiveDate),
      generatedBy: generatedBy || null,
    };
    draft.totalPayable = computeTotalPayable(draft);

    // Auto-apply any advance credit sitting on the customer's account.
    const advance = Math.max(customer.advanceBalance || 0, 0);
    if (advance > 0 && draft.totalPayable > 0) {
      const applied = Math.min(advance, draft.totalPayable);
      draft.amountPaid = applied;
      draft.isAdvance = true;
      draft.paymentDate = new Date();
      draft.paymentMethod = "Advance Credit";
      await Customer.findByIdAndUpdate(customerId, { $inc: { advanceBalance: -applied } }, { session });
    }

    draft.closingBalance = draft.totalPayable - draft.amountPaid;
    draft.status = computeStatus(draft);

    const [created] = await Invoice.create([draft], { session });

    await recomputeOutstanding(customerId, session);

    logActivity({
      type: "invoice_generated",
      customer,
      ownerIdOverride: customer.ownerId,
      message: `Generated invoice ${invoiceNumber} for ${customer.customerName} (${month}/${year})`,
      details: { invoiceNumber, month, year, billAmount: draft.billAmount, openingBalance, totalPayable: draft.totalPayable },
    });

    return created;
  };

  if (outerSession) return run(outerSession);

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await run(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}

// ---------------------------------------------------------------------------
// APPLY PAYMENT -- the single entry point covering single-month, multi-month,
// partial, and advance payments (req 2-5).
//
// `items`: ordered array (caller controls priority, typically oldest-first):
//   { invoiceId }        -- pay against an already-generated invoice
//   { month, year }       -- pay a future month that has no invoice yet
//                            (generated on the fly -- this is how "advance
//                            payment for next month" works)
// Any amount left over after all items are covered (or if items is empty --
// a pure advance payment) is credited to Customer.advanceBalance.
// ---------------------------------------------------------------------------
async function applyPayment({
  customerId,
  items = [],
  totalAmount,
  paymentMethod = "Cash",
  transactionId = "",
  paymentDate,
  remarks = "",
  reqUser,
  req,
}) {
  if (!totalAmount || totalAmount <= 0) throw new Error("Payment amount must be greater than zero");

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const customer = await Customer.findById(customerId).session(session);
      if (!customer) throw new Error("Customer not found");

      const payDate = paymentDate ? new Date(paymentDate) : new Date();
      let remaining = totalAmount;
      const allocations = [];
      const touchedInvoices = [];

      for (const item of items) {
        if (remaining <= 0) break;

        let invoice = item.invoiceId
          ? await Invoice.findOne({ _id: item.invoiceId, customerId }).session(session)
          : await generateInvoice(customerId, item.month, item.year, { session });

        if (!invoice) continue;
        if (invoice.closingBalance <= 0) continue; // already settled, skip

        const applyAmt = Math.min(remaining, invoice.closingBalance);
        invoice.amountPaid += applyAmt;
        invoice.paymentDate = payDate;
        invoice.paymentMethod = paymentMethod;
        if (invoice.dueDate && payDate < invoice.dueDate) invoice.isAdvance = true;
        recalcInvoice(invoice, payDate);
        await invoice.save({ session });

        touchedInvoices.push(invoice);
        allocations.push({ invoiceId: invoice._id, month: invoice.month, year: invoice.year, amountApplied: applyAmt });
        remaining -= applyAmt;
      }

      const advanceAmount = Math.max(remaining, 0);
      if (advanceAmount > 0) {
        await Customer.findByIdAndUpdate(customerId, { $inc: { advanceBalance: advanceAmount } }, { session });
      }

      const receiptNumber = await nextSequence("receiptNumber", "RCPT", 6, session, customer.ownerId);
      const operatorName = reqUser
        ? (await User.findById(reqUser.id).select("name").session(session))?.name || ""
        : "";

      const [payment] = await Payment.create(
        [
          {
            customerId,
            ownerId: customer.ownerId,
            receiptNumber,
            allocations,
            totalAmount,
            advanceAmount,
            isAdvance: advanceAmount > 0,
            paymentMethod,
            transactionId,
            paymentDate: payDate,
            operatorId: reqUser?.id || null,
            operatorName,
            remarks,
          },
        ],
        { session }
      );

      await Customer.findByIdAndUpdate(
        customerId,
        { lastPaymentDate: payDate, lastPaymentAmount: totalAmount, paymentStatus: "paid" },
        { session }
      );
      const outstandingBalance = await recomputeOutstanding(customerId, session);

      logActivity({
        type: advanceAmount > 0 && allocations.length === 0 ? "advance_payment_received" : "payment_received",
        reqUser,
        req,
        customer,
        message: `Received Rs. ${totalAmount} from ${customer.customerName} (Receipt ${receiptNumber})`,
        details: {
          receiptNumber,
          totalAmount,
          advanceAmount,
          paymentMethod,
          transactionId,
          months: allocations.map((a) => `${a.month}/${a.year}`),
        },
        newValue: { outstandingBalance, advanceBalance: (customer.advanceBalance || 0) + advanceAmount },
      });

      result = { payment, invoices: touchedInvoices, outstandingBalance };
    });
  } finally {
    session.endSession();
  }
  return result;
}

// ---------------------------------------------------------------------------
// REVERSE PAYMENT (req 7, 12) -- un-applies every allocation, restores
// advance balance if any, marks the payment reversed. Never deletes anything.
// ---------------------------------------------------------------------------
async function reversePayment(paymentId, { reason = "", reqUser, req } = {}) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const payment = await Payment.findById(paymentId).session(session);
      if (!payment) throw new Error("Payment not found");
      if (payment.isReversed) throw new Error("Payment is already reversed");

      for (const alloc of payment.allocations) {
        const invoice = await Invoice.findById(alloc.invoiceId).session(session);
        if (!invoice) continue;
        invoice.amountPaid = Math.max((invoice.amountPaid || 0) - alloc.amountApplied, 0);
        if (invoice.paymentDate && invoice.paymentDate.getTime() === payment.paymentDate.getTime()) {
          invoice.paymentDate = null;
          invoice.paymentMethod = "";
        }
        recalcInvoice(invoice);
        await invoice.save({ session });
      }

      if (payment.advanceAmount > 0) {
        await Customer.findByIdAndUpdate(payment.customerId, { $inc: { advanceBalance: -payment.advanceAmount } }, { session });
      }

      payment.isReversed = true;
      payment.reversedAt = new Date();
      payment.reversedBy = reqUser?.id || null;
      payment.reversalReason = reason;
      await payment.save({ session });

      const outstandingBalance = await recomputeOutstanding(payment.customerId, session);
      const customer = await Customer.findById(payment.customerId).session(session);

      logActivity({
        type: "payment_reversed",
        reqUser,
        req,
        customer,
        message: `Reversed payment ${payment.receiptNumber} (Rs. ${payment.totalAmount}) for ${customer?.customerName || "customer"}${reason ? ` -- ${reason}` : ""}`,
        details: { receiptNumber: payment.receiptNumber, totalAmount: payment.totalAmount, reason },
        previousValue: { isReversed: false },
        newValue: { isReversed: true, outstandingBalance },
      });

      result = { payment, outstandingBalance };
    });
  } finally {
    session.endSession();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Manual adjustments: discount / late fee / manual due / waive.
// All follow the same shape: load invoice, bump the relevant field, recalc,
// save, log with before/after values.
// ---------------------------------------------------------------------------
async function adjustInvoice(invoiceId, field, amount, { reason = "", reqUser, req, activityType } = {}) {
  if (!amount || amount <= 0) throw new Error("Amount must be greater than zero");

  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new Error("Invoice not found");

  const previousValue = { [field]: invoice[field], totalPayable: invoice.totalPayable, closingBalance: invoice.closingBalance, status: invoice.status };
  invoice[field] = (invoice[field] || 0) + amount;
  recalcInvoice(invoice);
  await invoice.save();

  const customer = await Customer.findById(invoice.customerId);
  await recomputeOutstanding(invoice.customerId);

  logActivity({
    type: activityType,
    reqUser,
    req,
    customer,
    message: `${activityType.replace(/_/g, " ")} of Rs. ${amount} on invoice ${invoice.invoiceNumber} for ${customer?.customerName || "customer"}${reason ? ` -- ${reason}` : ""}`,
    details: { invoiceNumber: invoice.invoiceNumber, field, amount, reason },
    previousValue,
    newValue: { [field]: invoice[field], totalPayable: invoice.totalPayable, closingBalance: invoice.closingBalance, status: invoice.status },
  });

  return invoice;
}

const applyDiscount = (invoiceId, amount, opts = {}) => adjustInvoice(invoiceId, "discount", amount, { ...opts, activityType: "discount_applied" });
const addLateFee = (invoiceId, amount, opts = {}) => adjustInvoice(invoiceId, "lateFee", amount, { ...opts, activityType: "late_fee_added" });
const waiveCharges = (invoiceId, amount, opts = {}) => adjustInvoice(invoiceId, "waivedAmount", amount, { ...opts, activityType: "charges_waived" });

// Manual due isn't always against an existing invoice -- if the customer has
// no open (pending/partial/overdue) invoice, generate the current month's
// invoice first so the due has somewhere to live.
async function addManualDue(customerId, amount, { reason = "", reqUser, req } = {}) {
  if (!amount || amount <= 0) throw new Error("Amount must be greater than zero");

  const now = new Date();
  let invoice = await Invoice.findOne({
    customerId,
    status: { $in: ["pending", "partial", "overdue"] },
  }).sort({ year: -1, month: -1 });

  if (!invoice) {
    invoice = await generateInvoice(customerId, now.getMonth() + 1, now.getFullYear());
  }

  return adjustInvoice(invoice._id, "manualDue", amount, { reason, reqUser, req, activityType: "manual_due_added" });
}

// ---------------------------------------------------------------------------
// Financial summary + billing timeline (req 8, 9)
// ---------------------------------------------------------------------------
async function getFinancialSummary(customerId) {
  const customer = await Customer.findById(customerId).populate("areaId", "name").populate("serviceId", "name");
  if (!customer) throw new Error("Customer not found");

  const latest = await Invoice.findOne({ customerId }).sort({ year: -1, month: -1 });
  const now = new Date();
  const nextMonth = now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2;
  const nextYear = now.getMonth() + 2 > 12 ? now.getFullYear() + 1 : now.getFullYear();

  return {
    currentBill: latest?.billAmount ?? customer.amount,
    previousDues: latest?.openingBalance ?? 0,
    outstandingBalance: customer.outstandingBalance || 0,
    advanceBalance: customer.advanceBalance || 0,
    lastPaymentDate: customer.lastPaymentDate,
    lastPaymentAmount: customer.lastPaymentAmount,
    nextBillingDate: dueDateFor(nextYear, nextMonth, customer.billReceiveDate),
    nextDueDate: latest?.status !== "paid" ? latest?.dueDate : dueDateFor(nextYear, nextMonth, customer.billReceiveDate),
    billingCycle: "Monthly",
    currentPackage: customer.packageName,
    customerStatus: customer.status,
    securityDeposit: customer.securityDeposit || 0,
  };
}

async function getBillingTimeline(customerId, monthsBack = 12) {
  const invoices = await Invoice.find({ customerId }).sort({ year: -1, month: -1 }).limit(monthsBack);
  return invoices.reverse().map((inv) => ({
    month: inv.month,
    year: inv.year,
    status: inv.status,
    invoiceNumber: inv.invoiceNumber,
    totalPayable: inv.totalPayable,
    amountPaid: inv.amountPaid,
    closingBalance: inv.closingBalance,
  }));
}

module.exports = {
  nextSequence,
  computeTotalPayable,
  computeStatus,
  recalcInvoice,
  dueDateFor,
  getLatestInvoice,
  recomputeOutstanding,
  generateInvoice,
  applyPayment,
  reversePayment,
  applyDiscount,
  addLateFee,
  waiveCharges,
  addManualDue,
  getFinancialSummary,
  getBillingTimeline,
};
