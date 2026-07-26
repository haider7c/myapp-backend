// backend/services/reminderService.js
const Customer = require("../models/Customer");

// ownerId is required now -- this used to fetch every customer in the
// entire system regardless of which tenant triggered it, sending a WhatsApp
// blast to every business's customers from a single unauthenticated route.
async function sendReminders(service, ownerId) {
  const customers = await Customer.find({ ownerId });

  for (const customer of customers) {
    if (!customer.phone) continue;

    const msg = `⚠️ Dear ${customer.customerName}, your package will expire soon. Please renew.`;

    await service.sendMessage(customer.ownerId, customer.phone, msg);

    await new Promise(r => setTimeout(r, 500));
  }

  return true;
}

module.exports = { sendReminders };
