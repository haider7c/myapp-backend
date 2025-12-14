const cron = require("node-cron");
const axios = require("axios");
const Customer = require("../models/Customer");
const BillStatus = require("../models/BillStatus");

const WHATSAPP_STATUS_URL =
  "https://myapp-backend-nrka.onrender.com/api/whatsapp/status";
const WHATSAPP_SEND_URL =
  "https://myapp-backend-nrka.onrender.com/api/whatsapp/send";

let sentToday = new Set();

// Utility sleep function (1 minute delay)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resetDaily() {
  sentToday = new Set();
}

// Check WhatsApp connection
async function isWhatsAppConnected() {
  try {
    const res = await axios.get(WHATSAPP_STATUS_URL, { timeout: 8000 });
    return res.data?.isConnected === true;
  } catch (err) {
    console.log("❌ WhatsApp status check failed:", err.message);
    return false;
  }
}

// Check payment status
async function isCustomerPaid(customerId) {
  const month = new Date().getMonth() + 1;
  const year = new Date().getFullYear();

  const bill = await BillStatus.findOne({
    customerId,
    month,
    year,
  });

  return bill?.billStatus === true;
}

// Get bill day
function getBillDay(customer) {
  let billDay = customer.billReceiveDate;

  if (typeof billDay === "string" && billDay.includes("T"))
    billDay = new Date(billDay).getDate();

  if (typeof billDay === "number" && billDay > 31)
    billDay = new Date(billDay).getDate();

  return parseInt(billDay.toString(), 10);
}

// ====================================================
// DAILY REMINDER JOB — runs at 12:01 AM every day
// ====================================================
cron.schedule("1 0 * * *", async () => {
  console.log("⏳ Running daily reminder job (12:01 AM)");
  resetDaily();

  const today = new Date().getDate();
  const targetDay = today + 3;

  // Stop if WhatsApp not connected
  if (!(await isWhatsAppConnected())) {
    console.log("⛔ WhatsApp not connected. Job stopped.");
    return;
  }

  try {
    const customers = await Customer.find();

    for (const customer of customers) {
      const custId = customer._id.toString();

      // Skip invalid cases
      if (customer.status === "discontinued") continue;
      if (sentToday.has(custId)) continue;
      if (await isCustomerPaid(custId)) continue;

      const billDay = getBillDay(customer);
      if (billDay !== targetDay) continue;

      // Check connection before EACH send
      if (!(await isWhatsAppConnected())) {
        console.log("⛔ WhatsApp disconnected mid-job. Stopping.");
        return;
      }

      const message = `Dear ${customer.customerName}, your ${
        customer.packageName || "package"
      } will expire in 3 days (day ${billDay}). Please renew to avoid interruption.`;

      // ✅ SEND ONLY ONCE
      await axios.post(WHATSAPP_SEND_URL, {
        phone: customer.phone,
        message,
      });

      console.log(`📩 Sent reminder to ${customer.customerName}`);

      sentToday.add(custId);

      // ✅ WAIT 1 MINUTE BEFORE NEXT CUSTOMER
      console.log("⏱ Waiting 1 minute before next customer...");
      await sleep(60 * 1000);
    }

    console.log("✅ Daily reminder job completed.");
  } catch (err) {
    console.error("❌ Reminder job error:", err);
  }
});
