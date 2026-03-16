const cron = require("node-cron");
const axios = require("axios");
const Customer = require("../models/Customer");
const BillStatus = require("../models/BillStatus");

const WHATSAPP_STATUS_URL =
  "http://103.59.217.80:90/api/whatsapp/status";
const WHATSAPP_SEND_URL =
  "http://103.59.217.80:90/api/whatsapp/send";

let sentToday = new Set();

// Utility sleep function (1 minute delay)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resetDaily() {
  sentToday = new Set();
}

// Get month name in Urdu
const getMonthName = (month) => {
  const months = [
    "جنوری",
    "فروری",
    "مارچ",
    "اپریل",
    "مئی",
    "جون",
    "جولائی",
    "اگست",
    "ستمبر",
    "اکتوبر",
    "نومبر",
    "دسمبر",
  ];
  return months[month - 1] || "";
};

// Format due date in Urdu
const formatDueDate = (customer, billDay) => {
  const today = new Date().getDate();
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  if (billDay > today) {
    return `${billDay} ${getMonthName(currentMonth)} ${currentYear}`;
  } else {
    // If bill day has passed this month, it's for next month
    const nextMonth = currentMonth + 1;
    const year = nextMonth > 12 ? currentYear + 1 : currentYear;
    const month = nextMonth > 12 ? 1 : nextMonth;
    return `${billDay} ${getMonthName(month)} ${year}`;
  }
};

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
// URDU MESSAGE TEMPLATES
// ====================================================
const MESSAGE_TEMPLATES = {
  IN_3_DAYS: (customer, billDay) => {
    const monthlyBill = customer.amount || 0;
    const dueDate = formatDueDate(customer, billDay);

    let totalText = "";
    if (customer.amount) {
      totalText = `\n\n💰 *بل کی رقم*: *Rs ${monthlyBill}*`;
    }

    return (
      `🛜 *ASSALAM-O-ALAIKUM* 🛜\n\n` +
      `*${customer.customerName}* صاحب!\n\n` +
      `آپ کا *ماہانہ انٹرنیٹ بل* ۳ دن میں *مقررہ تاریخ* ہے:\n\n` +
      totalText +
      `\n\n📆 *بل ادا کرنے کی آخری تاریخ*:\n` +
      `*${dueDate}*` +
      `\n\n⚠️ *اہم تنبیہ*:\n` +
      `براہ کرم مقررہ تاریخ سے پہلے بل ادا کر دیں تاکہ آپ کا انٹرنیٹ کنکشن متاثر نہ ہو۔` +
      `\n\n💳 *بل ادائیگی کے طریقے*:\n` +
      `\n📱 *جیز کیس | ایزی پیسا*:\n` +
      `• علی حیدر - *03041275276*` +
      `\n\n🆕 *نیا پیے (Nayapay)*:\n` +
      `• علی حیدر - *03281615276*` +
      `\n\n🏦 *راست (Raast)*:\n` +
      `• علی حیدر - *03041275276*` +
      `\n\n📲 *رابطہ نمبرات*:\n` +
      `👤 علی حسین: *03041275276*\n` +
      `👤 علی حیدر: *03281615276*` +
      `\n\n✅ *بل ادا کرنے کے بعد*\n` +
      `براہ کرم رسید کی تصویر واٹس ایپ پر بھیج دیں تاکہ آپ کا ریکارڈ اپڈیٹ کیا جا سکے۔` +
      `\n\n📌 *نوٹ*:\n` +
      `اگر آپ اس ماہ کا بل ادا کر چکے ہیں تو اسے نظر انداز کر دیں۔ شکریہ` +
      `\n\n*INTERNETWORKS*` +
      `\n*آپ کا اعتماد ہماری پہچان* 🌟` +
      `\n\n*شکریہ*`
    );
  },

  GENERIC: (customer, daysUntil, billDay) => {
    const monthlyBill = customer.amount || 0;
    const dueDate = formatDueDate(customer, billDay);

    return (
      `🛜 *ASSALAM-O-ALAIKUM* 🛜\n\n` +
      `*${customer.customerName}* صاحب!\n\n` +
      `آپ کا ماہانہ انٹرنیٹ بل *${daysUntil} دن* میں مقررہ تاریخ ہے۔\n\n` +
      `💰 *بل کی رقم*: *Rs ${monthlyBill}*` +
      `\n\n📆 *بل ادا کرنے کی آخری تاریخ*:\n` +
      `*${dueDate}*` +
      `\n\n⚠️ *اہم تنبیہ*:\n` +
      `براہ کرم مقررہ تاریخ سے پہلے بل ادا کر دیں۔` +
      `\n\n💳 *بل ادائیگی کے طریقے*:\n` +
      `\n📱 *جیز کیس | ایزی پیسا*:\n` +
      `• علی حیدر - *03041275276*` +
      `\n\n📲 *رابطہ نمبرات*:\n` +
      `👤 علی حسین: *03041275276*\n` +
      `👤 علی حیدر: *03281615276*` +
      `\n\n📌 *نوٹ*:\n` +
      `اگر آپ اس ماہ کا بل ادا کر چکے ہیں تو اسے نظر انداز کر دیں۔ شکریہ` +
      `\n\n*INTERNETWORKS*` +
      `\n*آپ کا اعتماد ہماری پہچان* 🌟` +
      `\n\n*شکریہ*`
    );
  },
};

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

      // ✅ Urdu message for 3 days reminder
      const message = MESSAGE_TEMPLATES.IN_3_DAYS(customer, billDay);

      // ✅ SEND ONLY ONCE
      await axios.post(WHATSAPP_SEND_URL, {
        phone: customer.phone,
        message,
      });

      console.log(
        `📩 Urdu reminder sent to ${customer.customerName} (موبائل: ${customer.phone})`,
      );

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

