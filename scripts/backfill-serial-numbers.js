/**
 * One-off fix for customers that exist without a serialNumber -- mainly the
 * customers bulk-imported via scripts/import-jb-areas.js (277JB/275JB/276JB/
 * 336JB), which predates the serial-number auto-assignment that every
 * creation path (Add Customer, POST /api/customers, and the new
 * POST /api/customers/import-excel) now has via reserveSerialNumbers() in
 * routes/customerRoutes.js.
 *
 * For each owner, finds every customer with a missing/blank serialNumber,
 * reserves that many serial numbers from the SAME "invoice" counter every
 * other creation path uses (so no collisions with numbers already handed
 * out), and assigns them in a stable order (oldest _id first).
 *
 * Usage (run from the backend/ folder):
 *   node scripts/backfill-serial-numbers.js --dry-run   # preview only
 *   node scripts/backfill-serial-numbers.js             # actually assign
 *
 * Safe to re-run: once a customer has a serialNumber, it's excluded from
 * the next run.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Customer = require("../models/Customer");
const User = require("../models/User");
const Counter = require("../models/Counter");

const DRY_RUN = process.argv.includes("--dry-run");

// Mirrors routes/customerRoutes.js's reserveSerialNumbers() exactly -- same
// counter ("invoice", scoped per owner), same atomic upsert+increment, so
// numbers handed out here can never collide with ones already given to a
// customer created through the app.
async function reserveSerialNumbers(ownerId, count = 1) {
  if (count < 1) return [];
  await Counter.findOneAndUpdate(
    { name: "invoice", ownerId },
    { $setOnInsert: { value: 1 } },
    { upsert: true }
  );
  const before = await Counter.findOneAndUpdate(
    { name: "invoice", ownerId },
    { $inc: { value: count } },
    { new: false, upsert: true }
  );
  const start = before ? before.value : 1;
  return Array.from({ length: count }, (_, i) => String(start + i));
}

async function main() {
  console.log(DRY_RUN ? "*** DRY RUN -- no writes will happen ***\n" : "*** LIVE RUN -- assigning serial numbers ***\n");

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.\n");

  const owners = await User.find({ role: "owner" });
  console.log(`Found ${owners.length} owner account(s).\n`);

  let totalFixed = 0;

  for (const owner of owners) {
    const missing = await Customer.find({
      ownerId: owner._id,
      $or: [{ serialNumber: { $exists: false } }, { serialNumber: null }, { serialNumber: "" }],
    }).sort({ _id: 1 });

    const label = `${owner.name || owner.email || owner._id}`;

    if (missing.length === 0) {
      console.log(`${label}: no customers missing a serial number.`);
      continue;
    }

    console.log(`${label}: ${missing.length} customer(s) missing a serial number.`);

    if (DRY_RUN) {
      missing.slice(0, 10).forEach((c) => {
        console.log(`  would assign -> ${c.customerId || "(no id)"}  ${c.customerName || ""}`);
      });
      if (missing.length > 10) console.log(`  ...and ${missing.length - 10} more`);
      continue;
    }

    const serials = await reserveSerialNumbers(owner._id, missing.length);
    for (let i = 0; i < missing.length; i++) {
      missing[i].serialNumber = serials[i];
      // validateModifiedOnly -- these are legacy docs, some may be missing
      // other newer required fields (serviceId, etc.); a full .save()
      // would fail validating THOSE unrelated fields. Only serialNumber
      // changed here, so only it needs to validate.
      await missing[i].save({ validateModifiedOnly: true });
    }
    console.log(`  assigned serial numbers ${serials[0]}..${serials[serials.length - 1]}`);
    totalFixed += missing.length;
  }

  console.log(`\n${DRY_RUN ? "Would fix" : "Fixed"}: ${totalFixed} customer(s) total.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("\nBackfill aborted:", err.message);
  process.exit(1);
});
