// scripts/migrateReminderTemplates.js
//
// One-time, NON-DESTRUCTIVE backfill for the Reminder Messages & Receipt
// Management module.
//
// 1) Seeds 15 ReminderTemplate rows per owner (tenant) -- 6 of them are
//    "wired" (an existing send function in services/expiryChecker.js will
//    actually use them once seeded) and are seeded with the EXACT text that
//    function currently hardcodes, so behavior is byte-for-byte unchanged
//    until an admin edits something. The other 9 spec categories (New
//    Customer Welcome, Bill Generated, Service Suspension Warning, Service
//    Activated, Service Restored, Receipt Sent, Package Changed,
//    Installation Completed, Custom Reminder) have no existing trigger in
//    the codebase, so they're seeded as fully manageable/previewable
//    templates with sourceWired: false and sensible starter text -- editing
//    them today has no live effect until a future change wires a trigger.
//
// 2) Seeds a per-owner ReceiptSettings row (this used to be one single
//    global row for the whole deployment -- not tenant-aware). The very
//    first owner in the system (oldest by createdAt) inherits the existing
//    legacy row's real branding; every other owner gets fresh defaults.
//    Also migrates the underlying Mongo index from a unique index on `key`
//    to a sparse-unique index on `ownerId`, so multiple owners can each
//    have their own row without colliding on the old singleton key.
//
// Safe to re-run: every step checks for existing rows first.
//
// Run on the server (needs a live MONGODB_URI):
//   cd ~/path-to-backend && node scripts/migrateReminderTemplates.js
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const ReminderTemplate = require("../models/ReminderTemplate");
const ReceiptSettings = require("../models/ReceiptSettings");

const ISP_TEAM_CLOSING = "Best regards,\nYour ISP Team 🌐";

// The 6 wired templates -- text copied verbatim (split into
// title/greeting/body/closing) from services/expiryChecker.js as of this
// migration, so seeding them changes nothing about what's actually sent.
const WIRED_TEMPLATES = [
  {
    triggerKey: "expiry_tomorrow",
    category: "payment_reminder",
    name: "Payment Reminder — Package Expiring Tomorrow",
    sourceModule: "WhatsApp Automation",
    sourcePage: "Nightly Expiry Check (cron)",
    sourceButton: "Automatic — fires when a package expires tomorrow",
    title: "🔔 *Package Expiry Reminder*",
    greeting: "Dear {{customerName}},",
    body:
      "Your *{{packageName}}* package ({{billAmount}}) will expire *tomorrow* ({{dueDate}}).\n\n" +
      "Please make the payment to avoid service interruption.\n\n" +
      "*Payment Details:*\n📦 Package: {{packageName}}\n💰 Amount: {{billAmount}}\n📅 Due Date: {{dueDate}}\n\n" +
      "Thank you for choosing our service!",
    closing: ISP_TEAM_CLOSING,
  },
  {
    triggerKey: "expiry_today",
    category: "due_reminder",
    name: "Due Reminder — Package Expires Today",
    sourceModule: "WhatsApp Automation",
    sourcePage: "Nightly Expiry Check (cron)",
    sourceButton: "Automatic — fires when a package expires today",
    title: "⚠️ *URGENT: Package Expires Today!*",
    greeting: "Dear {{customerName}},",
    body:
      "Your *{{packageName}}* package ({{billAmount}}) expires *TODAY*!\n\n" +
      "Please make immediate payment to avoid service disruption.\n\n" +
      "*Payment Details:*\n📦 Package: {{packageName}}\n💰 Amount: {{billAmount}}\n📅 Due Date: {{dueDate}}\n\n" +
      "Contact support if you have already paid.",
    closing: ISP_TEAM_CLOSING,
  },
  {
    triggerKey: "bill_upcoming",
    category: "payment_reminder",
    name: "Payment Reminder — Upcoming Bill",
    sourceModule: "Billing / Customer Management",
    sourcePage: "Customer Billing (unpaid list) / Customer Profile",
    sourceButton: "Send Reminder",
    title: "📋 *Upcoming Bill Reminder*",
    greeting: "Dear {{customerName}},",
    body:
      "This is a friendly reminder about your upcoming monthly bill.\n\n" +
      "*Bill Details:*\n📦 Package: {{packageName}}\n💰 Amount: {{billAmount}}\n📅 Due Date: {{dueDate}}\n\n" +
      "Please make the payment at your earliest convenience to avoid any service interruption.\n\n" +
      "Thank you for your prompt attention.",
    closing: ISP_TEAM_CLOSING,
  },
  {
    triggerKey: "bill_due_today",
    category: "due_reminder",
    name: "Due Reminder — Bill Due Today",
    sourceModule: "Billing / Customer Management",
    sourcePage: "Customer Billing (unpaid list) / Customer Profile",
    sourceButton: "Send Reminder",
    title: "📋 *Monthly Bill Reminder*",
    greeting: "Dear {{customerName}},",
    body:
      "This is a friendly reminder that your monthly bill is due today.\n\n" +
      "*Bill Details:*\n📦 Package: {{packageName}}\n💰 Amount: {{billAmount}}\n📅 Due Date: {{dueDate}}\n\n" +
      "Please make the payment at your earliest convenience to avoid any service interruption.\n\n" +
      "Thank you for your prompt attention.",
    closing: ISP_TEAM_CLOSING,
  },
  {
    triggerKey: "bill_overdue",
    category: "overdue_reminder",
    name: "Overdue Reminder — Bill Overdue",
    sourceModule: "Billing / Customer Management",
    sourcePage: "Customer Billing (unpaid list) / Customer Profile",
    sourceButton: "Send Reminder",
    title: "⚠️ *Overdue Bill Reminder*",
    greeting: "Dear {{customerName}},",
    body:
      "This is a friendly reminder that your monthly bill is now overdue.\n\n" +
      "*Bill Details:*\n📦 Package: {{packageName}}\n💰 Amount: {{billAmount}}\n📅 Due Date: {{dueDate}}\n\n" +
      "Please make the payment at your earliest convenience to avoid any service interruption.\n\n" +
      "Thank you for your prompt attention.",
    closing: ISP_TEAM_CLOSING,
  },
  {
    triggerKey: "payment_received",
    category: "payment_received",
    name: "Payment Received Confirmation",
    sourceModule: "Billing / WhatsApp Manager",
    sourcePage: "Customer Billing (paid list) / Customer Profile",
    sourceButton: "Send Receipt / Resend Receipt",
    title: "✅ *Payment Received - Thank You!*",
    greeting: "Dear {{customerName}},",
    body:
      "We have received your payment for *{{packageName}}* package.\n\n" +
      "📋 *Payment Details:*\n📦 Package: {{packageName}}\n💰 Amount: {{billAmount}}\n💳 Method: {{paymentMethod}}\n📅 Paid on: {{paymentDate}}\n🆔 Transaction: {{transactionId}}\n\n" +
      "Your service will continue uninterrupted. Next payment due on {{dueDate}}.\n\n" +
      "For any queries, please contact support.",
    closing: ISP_TEAM_CLOSING,
  },
];

// The 9 remaining spec categories -- no existing code fires these, so
// they're seeded as fully editable/previewable starter templates only.
const UNWIRED_TEMPLATES = [
  {
    triggerKey: "new_customer_welcome",
    category: "new_customer_welcome",
    name: "New Customer Welcome",
    title: "🎉 *Welcome to {{companyName}}!*",
    greeting: "Dear {{customerName}},",
    body:
      "Thank you for choosing us! Your *{{packageName}}* connection is being set up.\n\n" +
      "🆔 Customer ID: {{customerId}}\n📞 Support: {{supportNumber}}\n\n" +
      "We're glad to have you with us.",
    closing: ISP_TEAM_CLOSING,
  },
  {
    triggerKey: "bill_generated",
    category: "bill_generated",
    name: "Bill Generated",
    title: "🧾 *New Bill Generated*",
    greeting: "Dear {{customerName}},",
    body:
      "Your bill for {{billMonth}} has been generated.\n\n" +
      "💰 Amount: {{billAmount}}\n📅 Due Date: {{dueDate}}\n🧾 Invoice: {{invoiceNumber}}\n\n" +
      "Please pay before the due date to avoid any interruption.",
    closing: ISP_TEAM_CLOSING,
  },
  {
    triggerKey: "service_suspension_warning",
    category: "service_suspension_warning",
    name: "Service Suspension Warning",
    title: "⚠️ *Service Suspension Notice*",
    greeting: "Dear {{customerName}},",
    body:
      "Your outstanding balance of {{totalDue}} remains unpaid. Your connection may be suspended if payment isn't received soon.\n\n" +
      "Please pay at your earliest convenience to avoid disruption.",
    closing: ISP_TEAM_CLOSING,
  },
  {
    triggerKey: "service_activated",
    category: "service_activated",
    name: "Service Activated",
    title: "✅ *Service Activated*",
    greeting: "Dear {{customerName}},",
    body: "Your *{{packageName}}* connection is now active. Enjoy uninterrupted internet!",
    closing: ISP_TEAM_CLOSING,
  },
  {
    triggerKey: "service_restored",
    category: "service_restored",
    name: "Service Restored",
    title: "🔌 *Service Restored*",
    greeting: "Dear {{customerName}},",
    body: "Your internet connection has been restored. Thank you for your payment.",
    closing: ISP_TEAM_CLOSING,
  },
  {
    triggerKey: "receipt_sent",
    category: "receipt_sent",
    name: "Receipt Sent",
    title: "🧾 *Payment Receipt*",
    greeting: "Dear {{customerName}},",
    body:
      "Please find your payment receipt below.\n\n" +
      "🧾 Receipt No: {{receiptNumber}}\n💰 Amount: {{billAmount}}\n📅 Date: {{paymentDate}}",
    closing: ISP_TEAM_CLOSING,
  },
  {
    triggerKey: "package_changed",
    category: "package_changed",
    name: "Package Changed",
    title: "📦 *Package Updated*",
    greeting: "Dear {{customerName}},",
    body: "Your package has been changed to *{{packageName}}* ({{billAmount}}/month), effective from your next billing cycle.",
    closing: ISP_TEAM_CLOSING,
  },
  {
    triggerKey: "installation_completed",
    category: "installation_completed",
    name: "Installation Completed",
    title: "🛠️ *Installation Completed*",
    greeting: "Dear {{customerName}},",
    body: "Your installation has been completed successfully. Welcome aboard!\n\n{{customNotes}}",
    closing: ISP_TEAM_CLOSING,
  },
  {
    triggerKey: "custom_reminder",
    category: "custom_reminder",
    name: "Custom Reminder",
    title: "📢 *Notice*",
    greeting: "Dear {{customerName}},",
    body: "{{customNotes}}",
    closing: ISP_TEAM_CLOSING,
  },
];

async function seedTemplatesForOwner(ownerId) {
  let created = 0;
  const all = [
    ...WIRED_TEMPLATES.map((t) => ({ ...t, sourceWired: true })),
    ...UNWIRED_TEMPLATES.map((t) => ({
      ...t,
      sourceWired: false,
      sourceModule: "Not yet wired",
      sourcePage: "—",
      sourceButton: "No existing trigger in code — manageable now, ready for future wiring",
    })),
  ];

  for (const t of all) {
    const exists = await ReminderTemplate.findOne({ ownerId, triggerKey: t.triggerKey });
    if (exists) continue;

    await ReminderTemplate.create({
      ownerId,
      triggerKey: t.triggerKey,
      category: t.category,
      name: t.name,
      deliveryMethod: "WhatsApp",
      enabled: true,
      isActive: true,
      title: t.title,
      greeting: t.greeting,
      body: t.body,
      closing: t.closing,
      language: "English",
      defaultSnapshot: { title: t.title, greeting: t.greeting, body: t.body, closing: t.closing },
      sourceModule: t.sourceModule,
      sourcePage: t.sourcePage,
      sourceButton: t.sourceButton,
      sourceWired: t.sourceWired,
    });
    created += 1;
  }
  return created;
}

async function seedReceiptSettingsForOwner(ownerId, legacySeed) {
  const exists = await ReceiptSettings.findOne({ ownerId });
  if (exists) return false;

  const seed = legacySeed ? { ...legacySeed } : {};
  delete seed._id;
  delete seed.ownerId;
  delete seed.createdAt;
  delete seed.updatedAt;
  delete seed.__v;

  await ReceiptSettings.create({ ...seed, ownerId });
  return true;
}

async function migrateReceiptSettingsIndex() {
  const collection = ReceiptSettings.collection;
  try {
    await collection.dropIndex("key_1");
    console.log("Dropped legacy unique index on ReceiptSettings.key");
  } catch (err) {
    if (err.codeName !== "IndexNotFound") console.warn("Could not drop legacy key index:", err.message);
  }
  try {
    await ReceiptSettings.syncIndexes();
    console.log("Synced ReceiptSettings indexes (ownerId sparse-unique)");
  } catch (err) {
    console.warn("Could not sync ReceiptSettings indexes:", err.message);
  }
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("Missing MONGODB_URI in .env -- run this from the backend folder on the server.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB. Migrating Reminder Templates & Receipt Settings...\n");

  await migrateReceiptSettingsIndex();

  const owners = await User.find({ role: "owner" }).sort({ createdAt: 1 });
  console.log(`Found ${owners.length} owner(s).\n`);

  const legacyReceiptSettings = await ReceiptSettings.findOne({ ownerId: null, key: "default" });

  let totalTemplatesCreated = 0;
  let receiptSettingsCreated = 0;

  for (let i = 0; i < owners.length; i += 1) {
    const owner = owners[i];
    const createdCount = await seedTemplatesForOwner(owner._id);
    totalTemplatesCreated += createdCount;

    // Only the oldest owner (the original pre-multi-tenant account)
    // inherits the legacy singleton's real branding; everyone else starts fresh.
    const legacySeed = i === 0 ? legacyReceiptSettings?.toObject() : null;
    const didCreate = await seedReceiptSettingsForOwner(owner._id, legacySeed);
    if (didCreate) receiptSettingsCreated += 1;

    console.log(`  ${owner.name} (${owner.email}): +${createdCount} templates${didCreate ? ", +1 receipt settings row" : ""}`);
  }

  console.log(`\nDone. ${totalTemplatesCreated} reminder templates created, ${receiptSettingsCreated} receipt settings rows created.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
