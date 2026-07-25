// scripts/migrateBillStatusToInvoices.js
//
// One-time, NON-DESTRUCTIVE backfill: converts every customer's existing
// BillStatus history into proper Invoice records so the new Billing &
// Customer Management module (invoices/payments/running balances) has full
// history from day one, per "no dues should ever disappear".
//
// - Never modifies or deletes a single BillStatus document.
// - Safe to re-run: skips any customer/month/year that already has an
//   Invoice (whether from a previous run of this script, or already
//   created live by the new system).
// - The old BillStatus model has no concept of a running balance -- it's
//   just a paid/unpaid checkbox per month, optionally with a recorded
//   payment amount. This script reconstructs a best-effort running balance:
//     * billAmount = the recorded paymentAmount if paid, else the
//       customer's CURRENT package amount (best available approximation --
//       the old system never tracked historical package prices).
//     * paid months: amountPaid = totalPayable, closingBalance = 0.
//     * unpaid months: amountPaid = 0, full amount carries forward as the
//       next month's openingBalance, exactly like a real unpaid invoice.
//   If a customer has more than one BillStatus row for the same month/year
//   (a handful of legacy duplicates), the paid one wins; if several paid
//   rows exist, the most recently updated one wins and the rest are noted
//   in the summary but left untouched in BillStatus.
//
// Run on the server (needs a live MONGODB_URI):
//   cd ~/path-to-backend && node scripts/migrateBillStatusToInvoices.js
require("dotenv").config();
const mongoose = require("mongoose");
const Customer = require("../models/Customer");
const BillStatus = require("../models/BillStatus");
const Invoice = require("../models/Invoice");
const billingEngine = require("../services/billingEngine");

async function migrateCustomer(customer) {
  const rows = await BillStatus.find({ customerId: customer._id }).sort({ year: 1, month: 1, updatedAt: 1 });
  if (!rows.length) return { created: 0, skipped: 0, duplicates: 0 };

  // Dedupe to one row per month/year (paid wins; most-recently-updated wins among ties).
  const byPeriod = new Map();
  let duplicates = 0;
  for (const row of rows) {
    const key = `${row.year}-${row.month}`;
    const existing = byPeriod.get(key);
    if (!existing) {
      byPeriod.set(key, row);
      continue;
    }
    duplicates += 1;
    const existingPaid = existing.billStatus === true;
    const rowPaid = row.billStatus === true;
    if (rowPaid && !existingPaid) byPeriod.set(key, row); // prefer paid
    else if (rowPaid === existingPaid) byPeriod.set(key, row); // prefer most recently updated (rows are sorted asc)
  }

  const periods = Array.from(byPeriod.values()).sort((a, b) => (a.year - b.year) || (a.month - b.month));

  let created = 0;
  let skipped = 0;
  let openingBalance = 0;

  for (const row of periods) {
    const alreadyExists = await Invoice.findOne({ customerId: customer._id, month: row.month, year: row.year });
    if (alreadyExists) {
      // Keep the running balance chain consistent even for periods we skip.
      openingBalance = Math.max(alreadyExists.closingBalance, 0);
      skipped += 1;
      continue;
    }

    const isPaid = row.billStatus === true;
    const billAmount = (isPaid && row.paymentAmount) ? row.paymentAmount : customer.amount;

    const draft = {
      customerId: customer._id,
      ownerId: customer.ownerId,
      invoiceNumber: await billingEngine.nextSequence("invoiceNumber", "INV", 6),
      month: row.month,
      year: row.year,
      openingBalance,
      previousDue: openingBalance,
      billAmount,
      manualDue: 0,
      discount: 0,
      lateFee: 0,
      waivedAmount: 0,
      taxAmount: 0,
      amountPaid: 0,
      dueDate: billingEngine.dueDateFor(row.year, row.month, customer.billReceiveDate),
      paymentMethod: row.paymentMethod || "",
      paymentDate: row.paymentDate || row.billReceivedAt || null,
      notes: row.paymentNote || "",
      legacyBillStatusId: row._id,
      isLegacyMigrated: true,
    };
    draft.totalPayable = billingEngine.computeTotalPayable(draft);
    draft.amountPaid = isPaid ? draft.totalPayable : 0;
    draft.closingBalance = draft.totalPayable - draft.amountPaid;
    draft.status = billingEngine.computeStatus(draft);

    await Invoice.create(draft);
    openingBalance = Math.max(draft.closingBalance, 0);
    created += 1;
  }

  await billingEngine.recomputeOutstanding(customer._id);

  return { created, skipped, duplicates };
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("Missing MONGODB_URI in .env -- run this from the backend folder on the server.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB. Migrating BillStatus history into Invoice records...\n");

  const customers = await Customer.find({}, "customerName customerId amount billReceiveDate ownerId");
  console.log(`Found ${customers.length} customers.\n`);

  let totalCreated = 0;
  let totalSkipped = 0;
  let totalDuplicates = 0;
  let errored = 0;

  for (let i = 0; i < customers.length; i += 1) {
    const customer = customers[i];
    try {
      const { created, skipped, duplicates } = await migrateCustomer(customer);
      totalCreated += created;
      totalSkipped += skipped;
      totalDuplicates += duplicates;
      if ((i + 1) % 50 === 0 || i === customers.length - 1) {
        console.log(`  Processed ${i + 1}/${customers.length} customers...`);
      }
    } catch (err) {
      errored += 1;
      console.error(`  Failed for ${customer.customerName} [${customer.customerId || customer._id}]: ${err.message}`);
    }
  }

  console.log("\n---- Migration summary ----");
  console.log(`Customers processed: ${customers.length}`);
  console.log(`Invoices created: ${totalCreated}`);
  console.log(`Already existed / skipped: ${totalSkipped}`);
  console.log(`Duplicate BillStatus rows collapsed: ${totalDuplicates}`);
  console.log(`Customers with errors: ${errored}`);
  console.log("\nBillStatus collection was not modified -- all original records are untouched.");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
