const cron = require("node-cron");
const axios = require("axios");
const Customer = require("../models/Customer");
const BillStatus = require("../models/BillStatus");

const WHATSAPP_STATUS_URL = "https://myapp-backend-nrka.onrender.com/api/whatsapp/status";
const WHATSAPP_SEND_URL = "https://myapp-backend-nrka.onrender.com/api/whatsapp/send";

let sentToday = new Set();

function resetDaily() {
  sentToday = new Set();
}

// Check if WhatsApp is connected
async function isWhatsAppConnected() {
  try {
    const res = await axios.get(WHATSAPP_STATUS_URL, { timeout: 8000 });
    return res.data?.isConnected === true;
  } catch (err) {
    console.log("❌ Could not check WhatsApp status:", err.message);
    return false;
  }
}

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
  console.log("⏳ Running daily reminder job (12:01 AM)...");

  resetDaily();

  const today = new Date().getDate();
  const targetDay = today + 3;

  // -------------------------------
  // 🔴 STEP 1: Check WhatsApp Status
  // -------------------------------
  const connected = await isWhatsAppConnected();

  if (!connected) {
    console.log("⛔ WhatsApp is NOT connected. Stopping reminder sending...");
    return; // EXIT JOB SAFELY
  }

  try {
    const customers = await Customer.find();

    for (const customer of customers) {
      const custId = customer._id.toString();

      if (customer.status === "discontinued") continue;
      if (await isCustomerPaid(custId)) continue;

      const billDay = getBillDay(customer);

      if (billDay !== targetDay) continue;
      if (sentToday.has(custId)) continue;

      const message = `Dear ${customer.customerName}, your ${
        customer.packageName || "package"
      } will expire in 3 days (day ${billDay}). Please renew to avoid interruption.`;

      // -------------------------------
      // 🔴 STEP 2: Check connection AGAIN before sending
      // -------------------------------
      if (!(await isWhatsAppConnected())) {
        console.log("⛔ WhatsApp disconnected during job. Stopping...");
        return;
      }

      // 1st message
      await axios.post(WHATSAPP_SEND_URL, {
        phone: customer.phone,
        message,
      });

      console.log(`📩 Sent reminder to ${customer.customerName}`);

      sentToday.add(custId);

      // Send again in 1 minute
      setTimeout(async () => {
        if (await isWhatsAppConnected()) {
          await axios.post(WHATSAPP_SEND_URL, {
            phone: customer.phone,
            message,
          });

          console.log(`⏱ Sent second reminder to ${customer.customerName}`);
        } else {
          console.log("⛔ WhatsApp disconnected — second message skipped.");
        }
      }, 60 * 1000);
    }
  } catch (err) {
    console.error("❌ Error in reminder job:", err);
  }
});
