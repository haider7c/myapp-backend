// Run this ON THE SERVER (where MONGODB_URI is actually reachable):
//
//   cd ~/path-to-backend && node scripts/auditWhatsAppPhones.js
//
// Scans every customer's stored phone number through the same
// normalizePhone() logic whatsappService.js uses before sending a message,
// and reports:
//   1. Customers whose phone number CANNOT be normalized at all — these
//      will always fail to send, no matter what (typo, missing digits,
//      landline, garbage data, etc.) and need a manual fix in the app.
//   2. Phone numbers shared by more than one customer — usually a
//      copy/paste mistake where one of them has the WRONG number saved,
//      so reminders for one customer are silently going to another.
//
// This does NOT check live WhatsApp registration (that needs the WhatsApp
// session, which only runs inside the running server process) — for that,
// use GET /api/whatsapp/check-number/:customerId while the server is up.
require("dotenv").config();
const mongoose = require("mongoose");
const Customer = require("../models/Customer");
const { normalizePhone } = require("../services/whatsappService");

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("Missing MONGODB_URI in .env — run this from the backend folder on the server.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB. Auditing customer phone numbers...\n");

  const customers = await Customer.find({}, "customerName customerId phone").lean();
  console.log(`Total customers: ${customers.length}\n`);

  const failed = [];
  const ok = [];

  for (const c of customers) {
    const normalized = normalizePhone(c.phone);
    if (!normalized) {
      failed.push(c);
    } else {
      ok.push({ ...c, normalized });
    }
  }

  console.log(`Normalizes fine: ${ok.length}`);
  console.log(`FAILS to normalize (reminders will always fail for these): ${failed.length}\n`);

  if (failed.length) {
    console.log("---- Customers with an invalid/unfixable phone number on file ----");
    failed.forEach((c) => {
      console.log(`  [${c.customerId || c._id}] ${c.customerName}  phone="${c.phone}"`);
    });
    console.log("");
  }

  const byNormalized = {};
  ok.forEach((c) => {
    byNormalized[c.normalized] = byNormalized[c.normalized] || [];
    byNormalized[c.normalized].push(c);
  });
  const duplicates = Object.entries(byNormalized).filter(([, list]) => list.length > 1);

  if (duplicates.length) {
    console.log(`---- ${duplicates.length} phone number(s) shared by more than one customer ----`);
    duplicates.forEach(([num, list]) => {
      console.log(`  ${num}: ${list.map((c) => `${c.customerName} [${c.customerId || c._id}]`).join(", ")}`);
    });
    console.log("");
  }

  if (!failed.length && !duplicates.length) {
    console.log("No invalid or duplicate phone numbers found. If sends still fail for specific");
    console.log("customers, use GET /api/whatsapp/check-number/:customerId (while the server is");
    console.log("running) to test live WhatsApp registration for that exact number.");
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
