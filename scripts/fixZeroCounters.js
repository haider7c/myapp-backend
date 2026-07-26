// scripts/fixZeroCounters.js
//
// One-off cleanup for the counter race-condition bug: any per-owner
// "invoice" (customer serial number) counter that got created with
// value: 0 -- the old default before this fix -- gets bumped to 1, but
// ONLY if that owner has zero customers so far (so this can never
// renumber a tenant that's already actively using their sequence).
//
// Safe to re-run.
//
// Run on the server:
//   cd ~/path-to-backend && node scripts/fixZeroCounters.js
require("dotenv").config();
const mongoose = require("mongoose");
const Counter = require("../models/Counter");
const Customer = require("../models/Customer");
const User = require("../models/User");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.\n");

  const zeroCounters = await Counter.find({ name: "invoice", value: 0 });
  if (zeroCounters.length === 0) {
    console.log("No zero-value counters found. Nothing to do.");
    await mongoose.disconnect();
    return;
  }

  for (const c of zeroCounters) {
    const customerCount = c.ownerId ? await Customer.countDocuments({ ownerId: c.ownerId }) : 0;
    const user = c.ownerId ? await User.findById(c.ownerId).select("name email") : null;
    const label = user ? `"${user.name}" <${user.email}>` : `ownerId ${c.ownerId}`;

    if (customerCount === 0) {
      c.value = 1;
      await c.save();
      console.log(`Fixed: ${label} had a stuck 0-value counter -> now 1 (had 0 customers).`);
    } else {
      console.log(`Skipped: ${label} has a 0-value counter but already has ${customerCount} customer(s) -- leaving it alone, please check manually.`);
    }
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Fix failed:", err);
  process.exit(1);
});
