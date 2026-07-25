// routes/reminderTemplateRoutes.js -- Reminder Messages & Receipt Management
// module. Mounted at /api/reminder-templates in server.js. Every route is
// tenant-scoped (an owner and their employees only ever see their own set).
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ReminderTemplate = require("../models/ReminderTemplate");
const Customer = require("../models/Customer");
const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const ReceiptSettings = require("../models/ReceiptSettings");
const auth = require("../middleware/auth");
const { logActivity } = require("../services/activityLogger");
const { renderTemplate, VARIABLE_CATALOG, SAMPLE_CONTEXT } = require("../services/templateEngine");
const { CATEGORIES } = require("../models/ReminderTemplate");

const CATEGORY_LABELS = {
  new_customer_welcome: "New Customer Welcome",
  bill_generated: "Bill Generated",
  payment_reminder: "Payment Reminder",
  due_reminder: "Due Reminder",
  overdue_reminder: "Overdue Reminder",
  service_suspension_warning: "Service Suspension Warning",
  service_activated: "Service Activated",
  service_restored: "Service Restored",
  payment_received: "Payment Received",
  receipt_sent: "Receipt Sent",
  package_changed: "Package Changed",
  installation_completed: "Installation Completed",
  custom_reminder: "Custom Reminder",
};

function ownerScope(req) {
  return req.user.role === "owner" ? req.user.id : req.user.ownerId;
}

async function getOwnerReceiptSettings(ownerId) {
  let settings = await ReceiptSettings.findOne({ ownerId });
  if (!settings) settings = await ReceiptSettings.findOne({ ownerId: null, key: "default" });
  return settings || {};
}

// GET /meta/variables and /meta/categories -- static reference data for the
// admin UI (variable picker, category filter). Defined before "/:id" so
// they aren't swallowed by the ObjectId route.
router.get("/meta/variables", auth, (req, res) => {
  res.json({ success: true, variables: VARIABLE_CATALOG });
});

router.get("/meta/categories", auth, (req, res) => {
  res.json({ success: true, categories: CATEGORIES.map((key) => ({ key, label: CATEGORY_LABELS[key] || key })) });
});

// GET / -- list all templates for the tenant, optional ?category filter.
router.get("/", auth, async (req, res) => {
  try {
    const filter = { ownerId: ownerScope(req) };
    if (req.query.category) filter.category = req.query.category;
    const templates = await ReminderTemplate.find(filter).sort({ category: 1, name: 1 });
    res.json({ success: true, templates });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /:id
router.get("/:id", auth, async (req, res) => {
  try {
    const template = await ReminderTemplate.findOne({ _id: req.params.id, ownerId: ownerScope(req) });
    if (!template) return res.status(404).json({ success: false, error: "Template not found" });
    res.json({ success: true, template });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /:id -- edit the message content (req 2).
router.put("/:id", auth, async (req, res) => {
  try {
    const template = await ReminderTemplate.findOne({ _id: req.params.id, ownerId: ownerScope(req) });
    if (!template) return res.status(404).json({ success: false, error: "Template not found" });

    const previousValue = {
      name: template.name,
      title: template.title,
      greeting: template.greeting,
      body: template.body,
      closing: template.closing,
      language: template.language,
      deliveryMethod: template.deliveryMethod,
    };

    const editable = ["name", "title", "greeting", "body", "closing", "language", "deliveryMethod"];
    editable.forEach((field) => {
      if (req.body[field] !== undefined) template[field] = req.body[field];
    });
    template.lastModifiedAt = new Date();
    template.lastModifiedBy = req.user.id;
    await template.save();

    logActivity({
      type: "reminder_template_updated",
      reqUser: req.user,
      req,
      message: `Updated reminder template "${template.name}"`,
      previousValue,
      newValue: req.body,
    });

    res.json({ success: true, template });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// PUT /:id/toggle -- Enable/Disable (req 1).
router.put("/:id/toggle", auth, async (req, res) => {
  try {
    const template = await ReminderTemplate.findOne({ _id: req.params.id, ownerId: ownerScope(req) });
    if (!template) return res.status(404).json({ success: false, error: "Template not found" });

    const previousValue = template.enabled;
    template.enabled = req.body.enabled !== undefined ? !!req.body.enabled : !template.enabled;
    await template.save();

    logActivity({
      type: "reminder_template_toggled",
      reqUser: req.user,
      req,
      message: `${template.enabled ? "Enabled" : "Disabled"} reminder template "${template.name}"`,
      previousValue: { enabled: previousValue },
      newValue: { enabled: template.enabled },
    });

    res.json({ success: true, template });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /:id/duplicate (req 1).
router.post("/:id/duplicate", auth, async (req, res) => {
  try {
    const source = await ReminderTemplate.findOne({ _id: req.params.id, ownerId: ownerScope(req) });
    if (!source) return res.status(404).json({ success: false, error: "Template not found" });

    const copyCount = await ReminderTemplate.countDocuments({
      ownerId: ownerScope(req),
      triggerKey: { $regex: `^${source.triggerKey}_copy` },
    });

    const duplicate = await ReminderTemplate.create({
      ownerId: ownerScope(req),
      triggerKey: `${source.triggerKey}_copy${copyCount + 1}`,
      category: source.category,
      name: `${source.name} (Copy ${copyCount + 1})`,
      deliveryMethod: source.deliveryMethod,
      enabled: false, // duplicates start disabled -- won't silently start sending
      isActive: false,
      title: source.title,
      greeting: source.greeting,
      body: source.body,
      closing: source.closing,
      language: source.language,
      defaultSnapshot: source.defaultSnapshot,
      sourceModule: source.sourceModule,
      sourcePage: source.sourcePage,
      sourceButton: source.sourceButton,
      sourceWired: false, // a duplicate never auto-fires; promote via /activate if desired
      lastModifiedBy: req.user.id,
    });

    logActivity({
      type: "reminder_template_duplicated",
      reqUser: req.user,
      req,
      message: `Duplicated reminder template "${source.name}" as "${duplicate.name}"`,
    });

    res.status(201).json({ success: true, template: duplicate });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /:id/restore-default (req 1).
router.post("/:id/restore-default", auth, async (req, res) => {
  try {
    const template = await ReminderTemplate.findOne({ _id: req.params.id, ownerId: ownerScope(req) });
    if (!template) return res.status(404).json({ success: false, error: "Template not found" });

    const previousValue = { title: template.title, greeting: template.greeting, body: template.body, closing: template.closing };
    template.title = template.defaultSnapshot?.title || "";
    template.greeting = template.defaultSnapshot?.greeting || "";
    template.body = template.defaultSnapshot?.body || "";
    template.closing = template.defaultSnapshot?.closing || "";
    template.lastModifiedAt = new Date();
    template.lastModifiedBy = req.user.id;
    await template.save();

    logActivity({
      type: "reminder_template_restored",
      reqUser: req.user,
      req,
      message: `Restored reminder template "${template.name}" to its default content`,
      previousValue,
      newValue: template.defaultSnapshot,
    });

    res.json({ success: true, template });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /:id/preview (req 5) -- renders with sample data by default, or a
// real customer's data if customerId is supplied (uses their latest
// invoice/payment if any, so admins can sanity-check against real accounts).
router.post("/:id/preview", auth, async (req, res) => {
  try {
    const template = await ReminderTemplate.findOne({ _id: req.params.id, ownerId: ownerScope(req) });
    if (!template) return res.status(404).json({ success: false, error: "Template not found" });

    let ctx = SAMPLE_CONTEXT;
    const { customerId } = req.body || {};
    if (customerId && mongoose.isValidObjectId(customerId)) {
      const customer = await Customer.findOne({ _id: customerId, ownerId: ownerScope(req) });
      if (customer) {
        const [invoice, payment] = await Promise.all([
          Invoice.findOne({ customerId }).sort({ year: -1, month: -1 }),
          Payment.findOne({ customerId }).sort({ paymentDate: -1 }),
        ]);
        ctx = { customer, invoice, payment };
      }
    }

    const receiptSettings = await getOwnerReceiptSettings(ownerScope(req));
    const rendered = renderTemplate(template, { ...ctx, receiptSettings });

    res.json({ success: true, rendered, usedSampleData: ctx === SAMPLE_CONTEXT });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
