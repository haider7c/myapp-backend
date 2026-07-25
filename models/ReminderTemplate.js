// models/ReminderTemplate.js
//
// Reminder Messages & Receipt Management module. One document per
// admin-manageable message. `category` is the spec's 13-value grouping used
// for display/filtering; `triggerKey` is the precise internal identifier
// that sending code looks up by (several triggerKeys can share one
// `category` -- e.g. "Package Expiring Tomorrow" and "Upcoming Bill" both
// display under the "Payment Reminder" category but are edited
// independently, so editing one never silently changes the other's text).
//
// Every owner (tenant) gets their own full set, seeded by
// scripts/migrateReminderTemplates.js -- see that file for exactly which
// triggerKeys are wired to a real send function today vs. purely
// manageable/unwired (no existing code path fires them yet).
const mongoose = require("mongoose");

const CATEGORIES = [
  "new_customer_welcome",
  "bill_generated",
  "payment_reminder",
  "due_reminder",
  "overdue_reminder",
  "service_suspension_warning",
  "service_activated",
  "service_restored",
  "payment_received",
  "receipt_sent",
  "package_changed",
  "installation_completed",
  "custom_reminder",
];

const reminderTemplateSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // Internal lookup key used by sending code (e.g. "bill_due_today").
    // Unique per owner so `Duplicate` can create "bill_due_today_copy_1"
    // style variants without colliding.
    triggerKey: { type: String, required: true },

    category: { type: String, enum: CATEGORIES, required: true, index: true },
    name: { type: String, required: true }, // display "Reminder Name"

    deliveryMethod: { type: String, default: "WhatsApp" },
    enabled: { type: Boolean, default: true },

    // Only one template per (ownerId, triggerKey) is ever looked up by the
    // actual send functions -- when a duplicate is later enabled and marked
    // active, the previous one is automatically deactivated so exactly one
    // is ever "live" per triggerKey.
    isActive: { type: Boolean, default: true },

    // Editable message parts (req 2). Final message = title + "\n\n" +
    // greeting + "\n\n" + body + "\n\n" + closing (blank parts skipped),
    // then every {{variable}} is substituted -- see services/templateEngine.js.
    title: { type: String, default: "" },
    greeting: { type: String, default: "" },
    body: { type: String, default: "" },
    closing: { type: String, default: "" },
    language: { type: String, default: "English" },

    // Snapshot of the originally-seeded content, so "Restore Default
    // Template" can always revert even after repeated edits.
    defaultSnapshot: {
      title: { type: String, default: "" },
      greeting: { type: String, default: "" },
      body: { type: String, default: "" },
      closing: { type: String, default: "" },
    },

    // "Show Reminder Source" (req 4) -- where in the app this fires from.
    sourceModule: { type: String, default: "" },
    sourcePage: { type: String, default: "" },
    sourceButton: { type: String, default: "" },
    sourceWired: { type: Boolean, default: false }, // false = manageable but no existing trigger fires it yet

    lastModifiedAt: { type: Date, default: Date.now },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    lastModifiedByName: { type: String, default: "" },
  },
  { timestamps: true }
);

reminderTemplateSchema.index({ ownerId: 1, triggerKey: 1 });
reminderTemplateSchema.index({ ownerId: 1, category: 1 });

module.exports = mongoose.model("ReminderTemplate", reminderTemplateSchema);
module.exports.CATEGORIES = CATEGORIES;
