// scripts/dropLegacyCounterIndex.js
//
// The `counters` collection still has an old single-field unique index on
// `name` alone (index name "name_1"), left over from before per-owner
// counters existed. It coexists with the new compound `{name, ownerId}`
// unique index declared in models/Counter.js, and since it doesn't know
// about ownerId, it blocks ANY second owner from ever getting their own
// "invoice"/"invoiceNumber"/"receiptNumber"/"manualBillInvoice" counter
// row -- MongoDB rejects the insert with E11000 because a document with
// that `name` already exists (the first owner's row), regardless of
// ownerId being different. This is exactly the "Serial Number: undefined"
// bug for any owner besides the first.
//
// Counter.syncIndexes() reconciles the collection's actual indexes with
// what's declared in the schema: drops indexes no longer declared (the
// legacy name_1) and creates any that are missing (the compound one, if
// it isn't already there). No documents are touched.
//
// Run on the server:
//   cd ~/path-to-backend && node scripts/dropLegacyCounterIndex.js
require("dotenv").config();
const mongoose = require("mongoose");
const Counter = require("../models/Counter");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.\n");

  const before = await Counter.collection.indexes();
  console.log("Indexes before:", JSON.stringify(before, null, 2));

  const result = await Counter.syncIndexes();
  console.log("\nsyncIndexes() result:", result);

  const after = await Counter.collection.indexes();
  console.log("\nIndexes after:", JSON.stringify(after, null, 2));

  await mongoose.disconnect();
  console.log("\nDone.");
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
