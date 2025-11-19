// backend/services/reminderService.js
const Customer = require("../models/Customer");

async function sendReminders(service) {
  const customers = await Customer.find();

  for (const customer of customers) {
    if (!customer.phone) continue;

    const msg = `⚠️ Dear ${customer.customerName}, your package will expire soon. Please renew.`;

    await service.sendMessage(customer.phone, msg);

    await new Promise(r => setTimeout(r, 500));
  }

  return true;
}

module.exports = { sendReminders };
