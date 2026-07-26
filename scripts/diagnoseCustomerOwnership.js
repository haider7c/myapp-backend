// scripts/diagnoseCustomerOwnership.js
//
// READ-ONLY diagnostic. Groups every Customer document by its ownerId and
// reports which User account (name/email/role) each group belongs to, plus
// how many customers have no ownerId at all. Run this after noticing that
// an owner's customer count dropped once routes started filtering by
// ownerId -- it tells you exactly where the "missing" customers are
// currently pointing, so the follow-up fix (if any) reassigns the right
// documents instead of guessing.
//
// Makes no changes to the database.
//
// Run on the server:
//   cd ~/path-to-backend && node scripts/diagnoseCustomerOwnership.js
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const Customer = require("../models/Customer");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.\n");

  const totalCustomers = await Customer.countDocuments();
  console.log(`Total Customer documents in the database: ${totalCustomers}\n`);

  const groups = await Customer.aggregate([
    { $group: { _id: "$ownerId", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  console.log("Customers grouped by ownerId:\n");

  let accountedFor = 0;
  for (const g of groups) {
    if (!g._id) {
      console.log(`  (no ownerId set at all) -> ${g.count} customers`);
      continue;
    }
    accountedFor += g.count;
    const user = await User.findById(g._id).select("name email role createdAt");
    if (user) {
      console.log(
        `  ${g._id}  ->  ${g.count} customers  |  ${user.role} "${user.name}" <${user.email}>  (account created ${user.createdAt?.toISOString().slice(0, 10)})`
      );
    } else {
      console.log(`  ${g._id}  ->  ${g.count} customers  |  ⚠ NO MATCHING USER ACCOUNT (orphaned/deleted owner)`);
    }
  }

  console.log(`\nSanity check: ${accountedFor} customers have a real ownerId, ${totalCustomers - accountedFor} have none.`);

  console.log("\nAll owner accounts currently in the system (for reference):");
  const owners = await User.find({ role: "owner" }).select("name email createdAt").sort({ createdAt: 1 });
  owners.forEach((o) => {
    console.log(`  ${o._id}  |  "${o.name}" <${o.email}>  (created ${o.createdAt?.toISOString().slice(0, 10)})`);
  });

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
