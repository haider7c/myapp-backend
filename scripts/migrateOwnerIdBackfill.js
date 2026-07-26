// scripts/migrateOwnerIdBackfill.js
//
// One-time, NON-DESTRUCTIVE backfill for the cross-tenant data-isolation
// fix. Several models (Package, InventoryItem, Bill, ManualBill,
// BillStatus, AdditionalCharge) predate multi-tenancy and had no ownerId
// field at all -- every business owner's data of these types was visible
// to every other owner. The route/model code has already been updated to
// require and filter by ownerId; this script backfills the field onto
// existing documents so they don't just disappear once the filtering goes
// live.
//
// Where a document has a real link to a Customer (Bill.customerId,
// BillStatus.customerId, AdditionalCharge.customerId,
// ManualBill.customerRef), its ownerId is taken from that customer's own
// ownerId -- this is always correct, not a guess.
//
// Where a document has NO customer link (Package, InventoryItem, and any
// Bill/ManualBill/BillStatus/AdditionalCharge rows whose linked customer
// couldn't be found), it's assigned to the oldest owner in the system
// (first account ever created) -- this is exactly who was using the app
// when all of this data was created, back when there was only one tenant.
// Every other/newer owner starts with a clean slate for these types and
// can add their own.
//
// Also splits the shared Counter documents ("invoice", "invoiceNumber",
// "receiptNumber", "manualBillInvoice") so the oldest owner keeps
// continuing their existing sequence (ownerId backfilled onto the existing
// row) while every other owner gets their own independent sequence
// starting fresh the first time they use it (no action needed here --
// counterRoutes.js/manualBillRoutes.js/billingEngine.js already
// upsert-create a new per-owner row on first use).
//
// Safe to re-run: every step only touches documents where ownerId is still
// unset.
//
// Run on the server (needs a live MONGODB_URI):
//   cd ~/path-to-backend && node scripts/migrateOwnerIdBackfill.js
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const Customer = require("../models/Customer");
const Package = require("../models/Package");
const InventoryItem = require("../models/InventoryItem");
const Bill = require("../models/Bill");
const ManualBill = require("../models/ManualBill");
const BillStatus = require("../models/BillStatus");
const AdditionalCharge = require("../models/AdditionalCharge");
const Counter = require("../models/Counter");

async function getDefaultOwnerId() {
  const oldest = await User.findOne({ role: "owner" }).sort({ createdAt: 1 }).select("_id name email");
  if (!oldest) throw new Error("No owner account exists in the database -- nothing to backfill onto.");
  console.log(`Default (oldest) owner: ${oldest.name || oldest.email} (${oldest._id})`);
  return oldest._id;
}

// Backfills ownerId on documents that reference a customer via `field`,
// looking up each distinct customer once. Any document whose customer
// can't be found (deleted customer, bad ref, or no ref at all) falls back
// to defaultOwnerId.
async function backfillViaCustomerRef(Model, field, defaultOwnerId, label) {
  const docs = await Model.find({ ownerId: { $exists: false } }).select(`_id ${field}`);
  if (docs.length === 0) {
    console.log(`${label}: nothing to backfill (0 rows missing ownerId).`);
    return;
  }

  const customerIds = [...new Set(docs.filter((d) => d[field]).map((d) => String(d[field])))];
  const customers = await Customer.find({ _id: { $in: customerIds } }).select("_id ownerId");
  const ownerByCustomer = new Map(customers.map((c) => [String(c._id), c.ownerId]));

  let viaCustomer = 0;
  let viaDefault = 0;
  const bulkOps = docs.map((doc) => {
    const resolvedOwnerId = (doc[field] && ownerByCustomer.get(String(doc[field]))) || null;
    if (resolvedOwnerId) viaCustomer += 1;
    else viaDefault += 1;
    return {
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { ownerId: resolvedOwnerId || defaultOwnerId } },
      },
    };
  });

  await Model.bulkWrite(bulkOps);
  console.log(`${label}: backfilled ${docs.length} rows (${viaCustomer} via linked customer, ${viaDefault} via default owner).`);
}

// Backfills ownerId with a flat default -- for models with no customer
// link at all (shared reference data that predates multi-tenancy).
async function backfillFlat(Model, defaultOwnerId, label) {
  const result = await Model.updateMany(
    { ownerId: { $exists: false } },
    { $set: { ownerId: defaultOwnerId } }
  );
  console.log(`${label}: backfilled ${result.modifiedCount} rows to the default owner.`);
}

async function backfillCounters(defaultOwnerId) {
  const names = ["invoice", "invoiceNumber", "receiptNumber", "manualBillInvoice"];
  let total = 0;
  for (const name of names) {
    const result = await Counter.updateMany(
      { name, ownerId: { $exists: false } },
      { $set: { ownerId: defaultOwnerId } }
    );
    total += result.modifiedCount;
  }
  console.log(`Counter: backfilled ${total} legacy sequence row(s) onto the default owner (other owners will get their own fresh sequences automatically on first use).`);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.\n");

  const defaultOwnerId = await getDefaultOwnerId();
  console.log("");

  await backfillFlat(Package, defaultOwnerId, "Package");
  await backfillFlat(InventoryItem, defaultOwnerId, "InventoryItem");

  await backfillViaCustomerRef(Bill, "customerId", defaultOwnerId, "Bill");
  await backfillViaCustomerRef(BillStatus, "customerId", defaultOwnerId, "BillStatus");
  await backfillViaCustomerRef(AdditionalCharge, "customerId", defaultOwnerId, "AdditionalCharge");
  await backfillViaCustomerRef(ManualBill, "customerRef", defaultOwnerId, "ManualBill");

  await backfillCounters(defaultOwnerId);

  console.log("\nDone.");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
