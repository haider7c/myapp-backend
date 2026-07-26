// scripts/backfillCustomerOwnerId.js
//
// Fixes the 454 Customer documents that have NO ownerId at all -- they
// predate the ownerId field being added to the Customer schema, long
// before this session's multi-tenancy work. Confirmed via
// scripts/diagnoseCustomerOwnership.js that every OTHER owner account in
// the system (test@admin.com, ali@pos.com, hammad@gmail.com) has zero
// customers, so these 454 unambiguously belong to the original account
// (admin@example.com, the oldest owner, created 2025-12-16) -- there's no
// other candidate they could belong to.
//
// Only touches documents where ownerId is missing/null. Never overwrites
// an ownerId that's already set. Safe to re-run.
//
// Run on the server:
//   cd ~/path-to-backend && node scripts/backfillCustomerOwnerId.js
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const Customer = require("../models/Customer");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.\n");

  const oldest = await User.findOne({ role: "owner" }).sort({ createdAt: 1 }).select("_id name email");
  if (!oldest) throw new Error("No owner account exists -- nothing to backfill onto.");
  console.log(`Assigning orphaned customers to: "${oldest.name}" <${oldest.email}> (${oldest._id})\n`);

  const before = await Customer.countDocuments({
    $or: [{ ownerId: { $exists: false } }, { ownerId: null }],
  });
  console.log(`Customers with no ownerId: ${before}`);

  if (before === 0) {
    console.log("Nothing to do.");
    await mongoose.disconnect();
    return;
  }

  const result = await Customer.updateMany(
    { $or: [{ ownerId: { $exists: false } }, { ownerId: null }] },
    { $set: { ownerId: oldest._id } }
  );

  console.log(`Updated ${result.modifiedCount} customer documents.`);

  const remaining = await Customer.countDocuments({
    $or: [{ ownerId: { $exists: false } }, { ownerId: null }],
  });
  console.log(`Remaining with no ownerId: ${remaining}`);

  const newTotal = await Customer.countDocuments({ ownerId: oldest._id });
  console.log(`\n"${oldest.email}" now owns ${newTotal} customers total.`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
