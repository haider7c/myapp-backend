const cron = require("node-cron");
const axios = require("axios");
const Customer = require("../models/Customer");
const BillStatus = require("../models/BillStatus");

// WhatsApp sender endpoint
const API_URL = "https://myapp-backend-nrka.onrender.com/api/whatsapp/send";

// ✔ Store sent logs to avoid duplicates
let sentToday = new Set();

function resetDaily() {
  sentToday = new Set();
}

// Helper to check paid status
async function isCustomerPaid(customerId) {
  const month = new Date().getMonth() + 1;
  const year = new Date().getFullYear();

  const bill = await BillStatus.findOne({
    customerId: customerId,
    month,
    year
  });

  return bill?.billStatus === true;
}

// Calculate bill day
function getBillDay(customer) {
  let billDay = customer.billReceiveDate;

  if (typeof billDay === "string" && billDay.includes("T"))
    billDay = new Date(customer.billReceiveDate).getDate();

  if (typeof billDay === "number" && billDay > 31)
    billDay = new Date(customer.billReceiveDate).getDate();

  return parseInt(billDay.toString(), 10);
}

// ==============================================
// ✓ MAIN AUTOMATIC JOB (EVERY DAY AT 12:01 AM)
// ==============================================
cron.schedule("1 0 * * *", async () => {
  console.log("⏳ Running daily reminder job at 12:01 AM...");

  resetDaily();

  const today = new Date().getDate();
  const targetDay = today + 3;

  try {
    const customers = await Customer.find();

    for (const customer of customers) {
      const custId = customer._id.toString();

      // skip discontinued customers
      if (customer.status === "discontinued") continue;

      // skip paid customers
      if (await isCustomerPaid(custId)) continue;

      const billDay = getBillDay(customer);

      // only customers expiring in 3 days
      if (billDay !== targetDay) continue;

      // avoid duplicates
      if (sentToday.has(custId)) continue;

      // =====================
      // SEND FIRST MESSAGE
      // =====================
      const message = `Dear ${customer.customerName}, your ${
        customer.packageName || "package"
      } will expire in 3 days (day ${billDay}). Please renew to avoid interruption.`;

      await axios.post(API_URL, {
        phone: customer.phone,
        message,
      });

      console.log(`📩 Sent reminder to ${customer.customerName}`);

      sentToday.add(custId);

      // =====================================
      // SEND AGAIN AFTER 1 MINUTE
      // =====================================
      setTimeout(async () => {
        await axios.post(API_URL, {
          phone: customer.phone,
          message,
        });

        console.log(`⏱ Sent second reminder to ${customer.customerName}`);
      }, 60 * 1000);
    }
  } catch (err) {
    console.error("❌ Error in daily reminder job:", err);
  }
});
