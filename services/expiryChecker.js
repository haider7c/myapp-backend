// Ported from the desktop billing app. Message-sending is done via this
// backend's existing whatsappService.sendMessage(phone, message) — the
// desktop app had its own sendExpiryReminder/sendBillReminder/
// sendPaymentReceipt methods baked into ITS whatsapp service, but here that
// templating logic lives in this file instead, so the shared
// services/whatsappService.js (used by the mobile app too) doesn't need to
// change at all.
const Customer = require("../models/Customer");

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
      if (isPackageExpiringTomorrow(customer)) {
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

      return await service.sendMessage(customer.phone, message);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async sendBillReminder(customerId) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) throw new Error("Customer not found");
      if (!customer.phone) throw new Error("Customer phone number not found");

      if (!isPackageExpiringToday(customer)) {
        return { success: false, error: "Today is not the bill due date" };
      }

      const service = await this.whatsappServicePromise;
      const message = `📋 *Monthly Bill Reminder*

Dear ${customer.customerName},

This is a friendly reminder that your monthly bill is due today.

*Bill Details:*
📦 Package: ${customer.packageName}
💰 Amount: Rs. ${customer.amount}
📅 Due Date: Today (Day ${customer.billReceiveDate})

Please make the payment at your earliest convenience to avoid any service interruption.

Thank you for your prompt attention.

Best regards,
Your ISP Team 🌐`;

      return await service.sendMessage(customer.phone, message);
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
      const message = `✅ *Payment Received - Thank You!*

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

      return await service.sendMessage(customer.phone, message);
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

  async checkExpiringPackages() {
    // sendMessage() queues silently and never resolves/rejects while
    // WhatsApp isn't connected — fail fast here instead of hanging on
    // every customer in the loop.
    const service = await this.whatsappServicePromise;
    if (!service.getStatus().isConnected) {
      throw new Error("WhatsApp is not connected");
    }
    const tomorrowDay = new Date(Date.now() + 86400000).getDate();
    const expiringCustomers = await Customer.find({ billReceiveDate: tomorrowDay });
    const results = [];
    for (const customer of expiringCustomers) {
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
    if (!service.getStatus().isConnected) {
      throw new Error("WhatsApp is not connected");
    }
    const todayDay = new Date().getDate();
    const dueCustomers = await Customer.find({ billReceiveDate: todayDay });
    const results = [];
    for (const customer of dueCustomers) {
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
