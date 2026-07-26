// Ported from the desktop billing app. Message-sending is done via this
// backend's existing whatsappService.sendMessage(phone, message) — the
// desktop app had its own sendExpiryReminder/sendBillReminder/
// sendPaymentReceipt methods baked into ITS whatsapp service, but here that
// templating logic lives in this file instead, so the shared
// services/whatsappService.js (used by the mobile app too) doesn't need to
// change at all.
//
// Reminder Messages module: each of the three message-producing methods
// below now first looks up the tenant's admin-editable ReminderTemplate for
// its exact triggerKey (see models/ReminderTemplate.js for what each key
// means) and sends that instead, if one exists and is enabled. If no
// template is found (e.g. migration hasn't run yet for this owner), it
// falls back to the original hardcoded text below so a message is never
// silently skipped -- this is the ONLY thing that changed in this file;
// the hardcoded strings are kept as-is, now serving purely as the fallback
// and as the literal seed text for scripts/migrateReminderTemplates.js.
const Customer = require("../models/Customer");
const ReminderTemplate = require("../models/ReminderTemplate");
const ReceiptSettings = require("../models/ReceiptSettings");
const { renderTemplate } = require("./templateEngine");

async function getActiveTemplate(ownerId, triggerKey) {
  if (!ownerId) return null;
  try {
    return await ReminderTemplate.findOne({ ownerId, triggerKey, enabled: true, isActive: true });
  } catch (err) {
    return null;
  }
}

async function getReceiptSettingsFor(ownerId) {
  try {
    return (await ReceiptSettings.findOne({ ownerId })) || (await ReceiptSettings.findOne({ ownerId: null, key: "default" })) || {};
  } catch (err) {
    return {};
  }
}

function isPackageExpiringTomorrow(customer) {
  if (!customer || !customer.billReceiveDate) return false;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.getDate() === parseInt(customer.billReceiveDate);
}

function isPackageExpiringToday(customer) {
  if (!customer || !customer.billReceiveDate) return false;
  return new Date().getDate() === parseInt(customer.billReceiveDate);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ExpiryChecker {
  constructor(whatsappServicePromise) {
    this.whatsappServicePromise = whatsappServicePromise;
  }

  async sendExpiryReminder(customerId) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) throw new Error("Customer not found");
      if (!customer.phone) throw new Error("Customer phone number not found");

      const service = await this.whatsappServicePromise;

      let message = null;
      const triggerKey = isPackageExpiringTomorrow(customer) ? "expiry_tomorrow" : isPackageExpiringToday(customer) ? "expiry_today" : null;
      if (triggerKey) {
        const template = await getActiveTemplate(customer.ownerId, triggerKey);
        if (template) {
          const receiptSettings = await getReceiptSettingsFor(customer.ownerId);
          const dueDateOverride =
            triggerKey === "expiry_tomorrow"
              ? `Day ${customer.billReceiveDate} of every month`
              : `TODAY (Day ${customer.billReceiveDate})`;
          message = renderTemplate(template, { customer, receiptSettings, dueDateOverride });
        }
      }

      if (message) {
        // Template-driven message resolved above; fall through to send.
      } else if (isPackageExpiringTomorrow(customer)) {
        message = `🔔 *Package Expiry Reminder*

Dear ${customer.customerName},

Your *${customer.packageName}* package (Rs. ${customer.amount}) will expire *tomorrow* (Day ${customer.billReceiveDate} of the month).

Please make the payment to avoid service interruption.

*Payment Details:*
📦 Package: ${customer.packageName}
💰 Amount: Rs. ${customer.amount}
📅 Due Date: Day ${customer.billReceiveDate} of every month

Thank you for choosing our service!

Best regards,
Your ISP Team 🌐`;
      } else if (isPackageExpiringToday(customer)) {
        message = `⚠️ *URGENT: Package Expires Today!*

Dear ${customer.customerName},

Your *${customer.packageName}* package (Rs. ${customer.amount}) expires *TODAY* (Day ${customer.billReceiveDate})!

Please make immediate payment to avoid service disruption.

*Payment Details:*
📦 Package: ${customer.packageName}
💰 Amount: Rs. ${customer.amount}
📅 Due Date: TODAY (Day ${customer.billReceiveDate})

Contact support if you have already paid.

Best regards,
Your ISP Team 🌐`;
      } else {
        return { success: false, error: "Package does not expire tomorrow or today" };
      }

      return await service.sendMessage(customer.ownerId, customer.phone, message);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // `force: true` skips the "must be exactly today's bill day" gate — used
  // by the manual "Send Reminder" button on the billing page, which can be
  // clicked for any unpaid customer (due today, overdue, or upcoming), not
  // just the ones the daily cron job (checkDueTodayPackages) already
  // pre-filtered to billReceiveDate === today. The message wording adapts
  // to whether the bill is due today, already overdue, or still upcoming.
  async sendBillReminder(customerId, options = {}) {
    const { force = false } = options;
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) throw new Error("Customer not found");
      if (!customer.phone) throw new Error("Customer phone number not found");

      if (!force && !isPackageExpiringToday(customer)) {
        return { success: false, error: "Today is not the bill due date" };
      }

      const service = await this.whatsappServicePromise;

      const todayDay = new Date().getDate();
      const billDay = parseInt(customer.billReceiveDate);
      const isToday = billDay === todayDay;
      const isOverdue = billDay < todayDay;

      const headline = isToday
        ? "📋 *Monthly Bill Reminder*"
        : isOverdue
        ? "⚠️ *Overdue Bill Reminder*"
        : "📋 *Upcoming Bill Reminder*";

      const dueDateLine = isToday
        ? `📅 Due Date: Today (Day ${customer.billReceiveDate})`
        : isOverdue
        ? `📅 Due Date: Day ${customer.billReceiveDate} (overdue)`
        : `📅 Due Date: Day ${customer.billReceiveDate} of this month`;

      const intro = isToday
        ? "This is a friendly reminder that your monthly bill is due today."
        : isOverdue
        ? "This is a friendly reminder that your monthly bill is now overdue."
        : "This is a friendly reminder about your upcoming monthly bill.";

      const billTriggerKey = isToday ? "bill_due_today" : isOverdue ? "bill_overdue" : "bill_upcoming";
      const billTemplate = await getActiveTemplate(customer.ownerId, billTriggerKey);

      let message;
      if (billTemplate) {
        const receiptSettings = await getReceiptSettingsFor(customer.ownerId);
        const dueDateOverride = isToday
          ? `Today (Day ${customer.billReceiveDate})`
          : isOverdue
          ? `Day ${customer.billReceiveDate} (overdue)`
          : `Day ${customer.billReceiveDate} of this month`;
        message = renderTemplate(billTemplate, { customer, receiptSettings, dueDateOverride });
      } else {
        message = `${headline}

Dear ${customer.customerName},

${intro}

*Bill Details:*
📦 Package: ${customer.packageName}
💰 Amount: Rs. ${customer.amount}
${dueDateLine}

Please make the payment at your earliest convenience to avoid any service interruption.

Thank you for your prompt attention.

Best regards,
Your ISP Team 🌐`;
      }

      return await service.sendMessage(customer.ownerId, customer.phone, message);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async sendPaymentReceipt(customerId, paymentDetails) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) throw new Error("Customer not found");
      if (!customer.phone) throw new Error("Customer phone number not found");

      const service = await this.whatsappServicePromise;

      const receiptTemplate = await getActiveTemplate(customer.ownerId, "payment_received");
      let message;
      if (receiptTemplate) {
        const receiptSettings = await getReceiptSettingsFor(customer.ownerId);
        const paymentShim = {
          paymentMethod: paymentDetails.method,
          transactionId: paymentDetails.transactionId,
          receiptNumber: paymentDetails.receiptNumber,
          paymentDate: new Date(),
        };
        message = renderTemplate(receiptTemplate, {
          customer,
          receiptSettings,
          payment: paymentShim,
          dueDateOverride: `Day ${customer.billReceiveDate} of next month`,
          invoice: { billAmount: paymentDetails.amount },
        });
      } else {
        message = `✅ *Payment Received - Thank You!*

Dear ${customer.customerName},

We have received your payment for *${customer.packageName}* package.

📋 *Payment Details:*
📦 Package: ${customer.packageName}
💰 Amount: Rs. ${paymentDetails.amount}
💳 Method: ${paymentDetails.method}
📅 Paid on: ${new Date().toLocaleDateString()}
🆔 Transaction: ${paymentDetails.transactionId || "N/A"}

Your service will continue uninterrupted. Next payment due on Day ${customer.billReceiveDate} of next month.

For any queries, please contact support.

Best regards,
Your ISP Team 🌐`;
      }

      return await service.sendMessage(customer.ownerId, customer.phone, message);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getExpiringPackages(days = 3) {
    const today = new Date();
    const expiringPackages = [];
    for (let i = 1; i <= days; i++) {
      const futureDate = new Date(today);
      futureDate.setDate(today.getDate() + i);
      const futureDay = futureDate.getDate();
      const customers = await Customer.find({ billReceiveDate: futureDay });
      customers.forEach((customer) => {
        expiringPackages.push({
          ...customer.toObject(),
          expiresInDays: i,
          expiryDate: `Day ${futureDay} (in ${i} day${i > 1 ? "s" : ""})`,
        });
      });
    }
    return expiringPackages;
  }

  async getDueTodayPackages() {
    return Customer.find({ billReceiveDate: new Date().getDate() });
  }

  // Multi-tenant note: this used to check ONE global "is WhatsApp
  // connected" gate before looping over every customer in the whole
  // system, regardless of which owner they belonged to (a pre-existing gap
  // -- it also never filtered by ownerId at all). Now that each owner has
  // their own independent session, a single global gate no longer makes
  // sense: one owner's number being connected shouldn't block (or enable)
  // sending for a different owner's customers. Each customer's send is now
  // checked against their OWN owner's session, and a customer whose owner
  // hasn't connected WhatsApp is reported as skipped rather than failing
  // the whole batch.
  async checkExpiringPackages() {
    const service = await this.whatsappServicePromise;
    const tomorrowDay = new Date(Date.now() + 86400000).getDate();
    const expiringCustomers = await Customer.find({ billReceiveDate: tomorrowDay });
    const results = [];
    for (const customer of expiringCustomers) {
      if (!service.getStatus(customer.ownerId).isConnected) {
        results.push({
          customer: customer.customerName,
          phone: customer.phone,
          success: false,
          skipped: true,
          error: "WhatsApp is not connected for this customer's account",
        });
        continue;
      }
      const result = await this.sendExpiryReminder(customer._id);
      results.push({
        customer: customer.customerName,
        phone: customer.phone,
        package: customer.packageName,
        expiryDay: customer.billReceiveDate,
        amount: customer.amount,
        success: result.success,
        error: result.error,
      });
      await delay(1000); // avoid rate limiting
    }
    return results;
  }

  async checkDueTodayPackages() {
    const service = await this.whatsappServicePromise;
    const todayDay = new Date().getDate();
    const dueCustomers = await Customer.find({ billReceiveDate: todayDay });
    const results = [];
    for (const customer of dueCustomers) {
      if (!service.getStatus(customer.ownerId).isConnected) {
        results.push({
          customer: customer.customerName,
          phone: customer.phone,
          success: false,
          skipped: true,
          error: "WhatsApp is not connected for this customer's account",
        });
        continue;
      }
      const result = await this.sendBillReminder(customer._id);
      results.push({
        customer: customer.customerName,
        phone: customer.phone,
        package: customer.packageName,
        dueDay: customer.billReceiveDate,
        amount: customer.amount,
        success: result.success,
        error: result.error,
      });
      await delay(1000);
    }
    return results;
  }
}

module.exports = ExpiryChecker;
