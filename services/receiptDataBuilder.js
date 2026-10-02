// backend/services/receiptDataBuilder.js
//
// Assembles the data object the WhatsApp bill/receipt image template
// (templates/whatsappReceiptTemplate.js) needs, from the real records:
// the Customer document, this month's BillStatus (for a receipt), the
// customer's current "previous dues" (AdditionalCharge -- only counted
// when flagged includeInNextBill, the same rule every other dues-reading
// code path in this app already follows: sendReminder's Urdu text,
// generate-pdf, etc.), and ReceiptSettings for the office contact info
// shown in the footer bar.
//
// Two documents, two data shapes:
//  - buildBillImageData: the UNPAID monthly bill. amountPaid is always 0;
//    remainingBalance is the full total (this month's bill + previous
//    dues).
//  - buildReceiptImageData: the PAID receipt for a given month's
//    BillStatus. If that BillStatus has a tracked paymentAmount (a
//    partial payment), amountPaid/remainingBalance reflect that; older
//    BillStatus rows saved before paymentAmount existed fall back to
//    "the bill was paid in full" (matching the app's behavior before this
//    feature). Previous dues are shown as still owing regardless of
//    whether this month's own bill was paid in full -- paying this
//    month's bill does not, by itself, clear a previously tracked due;
//    that's a separate, deliberate action the owner takes in the
//    Previous Dues screen.
const Package = require("../models/Package");
const AdditionalCharge = require("../models/AdditionalCharge");
const ReceiptSettings = require("../models/ReceiptSettings");

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Hand-rolled instead of toLocaleDateString("en-GB", {month:"short"}) --
// recent Node/ICU versions render September's short form as "Sept" (4
// letters), which looks inconsistent next to "Jan"/"Mar"/every other
// 3-letter abbreviation on the rendered bill/receipt. This guarantees the
// exact "DD Mon YYYY" format the reference design uses.
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(d) {
  const day = String(d.getDate()).padStart(2, "0");
  return `${day} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// Clamps a stored "day of month" (e.g. customer.billReceiveDate) into a
// real date for the given month/year -- e.g. day 30 clamped into February
// becomes the 28th/29th, rather than overflowing into March.
function clampDay(day, year, month /* 1-12 */) {
  const lastDay = new Date(year, month, 0).getDate();
  const d = Number(day) || lastDay;
  return Math.min(Math.max(d, 1), lastDay);
}

async function getPreviousDuesTotal(ownerId, customerId) {
  try {
    const record = await AdditionalCharge.findOne({ ownerId, customerId });
    if (!record || record.includeInNextBill !== true) return 0;
    const total = record.totalAmount ?? (record.charges || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
    return Math.max(Number(total) || 0, 0);
  } catch (err) {
    return 0;
  }
}

async function getPackageSpeed(ownerId, packageName) {
  if (!packageName) return "";
  try {
    const pkg = await Package.findOne({ ownerId, name: packageName }).select("speed");
    if (pkg?.speed) return pkg.speed;
  } catch (err) {
    // fall through to the regex guess below
  }
  const match = String(packageName).match(/\d+\s*mbps/i);
  return match ? match[0].replace(/\s+/g, " ") : "";
}

async function getReceiptSettingsContact(ownerId) {
  try {
    const settings = (await ReceiptSettings.findOne({ ownerId })) || (await ReceiptSettings.findOne({ ownerId: null, key: "default" }));
    return {
      phone1: settings?.phone || "",
      phone2: settings?.whatsappNumber || "",
      address: settings?.address || "",
      supportNumber: settings?.supportUAN || settings?.phone || "",
    };
  } catch (err) {
    return { phone1: "", phone2: "", address: "", supportNumber: "" };
  }
}

function makeDocNumber(prefix, year, month, customer) {
  const serial = (customer.serialNumber || "").toString().replace(/\D/g, "").slice(-3).padStart(3, "0");
  return `${prefix}-${String(year).slice(-2)}${String(month).padStart(2, "0")}${serial}`;
}

function billLabelFor(customer, packageSpeed) {
  const extra = Array.isArray(customer.additionalConnections) ? customer.additionalConnections : [];
  if (extra.length > 0) {
    return `Monthly Internet Bill (combined, ${extra.length + 1} connections)`;
  }
  return `Monthly Internet Bill${packageSpeed ? ` (${packageSpeed})` : ""}`;
}

async function buildBillImageData({ customer, ownerId, month, year }) {
  const previousDuesTotal = await getPreviousDuesTotal(ownerId, customer._id);
  const packageSpeed = await getPackageSpeed(ownerId, customer.packageName);
  const company = await getReceiptSettingsContact(ownerId);

  const thisMonthBill = Number(customer.amount) || 0;
  const totalAmount = thisMonthBill + previousDuesTotal;

  const billDateObj = new Date(year, month - 1, 1);
  const lastDayObj = new Date(year, month, 0);
  const dueDay = clampDay(customer.billReceiveDate, year, month);
  const dueDateObj = new Date(year, month - 1, dueDay);

  return {
    docNumber: makeDocNumber("BILL", year, month, customer),
    billDate: fmtDate(billDateObj),
    dueDateLabel: fmtDate(dueDateObj),
    billingPeriodLabel: `${fmtDate(billDateObj)} - ${fmtDate(lastDayObj)}`,
    billingPeriodShort: `${MONTH_NAMES[month - 1]} ${year}`,
    customerName: customer.customerName || "",
    customerId: customer.customerId || "",
    cnic: customer.cnic || "",
    phone: customer.phone || "",
    address: customer.address || "",
    packageSpeed: packageSpeed || "-",
    connectionType: "Fiber / PPPoE",
    accountStatus: customer.status === "active" ? "Active" : "Discontinued",
    billingRows: [
      { label: billLabelFor(customer, packageSpeed), amount: thisMonthBill },
      { label: "Previous Balance", amount: previousDuesTotal },
      { label: "Other Charges", amount: 0 },
    ],
    totalAmount,
    amountPaid: 0,
    remainingBalance: totalAmount,
    paymentStatus: "UNPAID",
    company,
  };
}

async function buildReceiptImageData({ customer, ownerId, billStatus, month, year }) {
  const previousDuesTotal = await getPreviousDuesTotal(ownerId, customer._id);
  const packageSpeed = await getPackageSpeed(ownerId, customer.packageName);
  const company = await getReceiptSettingsContact(ownerId);

  const thisMonthBill = Number(customer.amount) || 0;
  const totalAmount = thisMonthBill + previousDuesTotal;
  // Older BillStatus rows (saved before paymentAmount existed) have no
  // tracked figure -- treat those as "paid in full" so a historical PAID
  // bill doesn't suddenly look partially paid once this feature ships.
  const amountPaid = billStatus?.paymentAmount != null ? Number(billStatus.paymentAmount) : thisMonthBill;
  const remainingBalance = Math.max(totalAmount - amountPaid, 0);
  const paymentStatus = remainingBalance <= 0 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "UNPAID";

  const paidDate = billStatus?.paymentDate
    ? new Date(billStatus.paymentDate)
    : billStatus?.billReceivedAt
    ? new Date(billStatus.billReceivedAt)
    : new Date();

  const nextMonth = month + 1 > 12 ? 1 : month + 1;
  const nextYear = month + 1 > 12 ? year + 1 : year;
  const nextDueDay = clampDay(customer.billReceiveDate, nextYear, nextMonth);
  const nextDueDateObj = new Date(nextYear, nextMonth - 1, nextDueDay);

  return {
    docNumber: makeDocNumber("REC", year, month, customer),
    docDate: fmtDate(paidDate),
    docTime: paidDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    billingPeriodShort: `${MONTH_NAMES[month - 1]} ${year}`,
    nextDueDateLabel: fmtDate(nextDueDateObj),
    customerName: customer.customerName || "",
    customerId: customer.customerId || "",
    cnic: customer.cnic || "",
    phone: customer.phone || "",
    address: customer.address || "",
    packageSpeed: packageSpeed || "-",
    connectionType: "Fiber / PPPoE",
    accountStatus: customer.status === "active" ? "Active" : "Discontinued",
    billingRows: [
      { label: billLabelFor(customer, packageSpeed), amount: thisMonthBill },
      { label: "Previous Balance", amount: previousDuesTotal },
      { label: "Other Charges", amount: 0 },
    ],
    totalAmount,
    amountPaid,
    remainingBalance,
    paymentStatus,
    paymentMethod: billStatus?.paymentMethod || "Cash",
    company,
  };
}

module.exports = {
  buildBillImageData,
  buildReceiptImageData,
  // Exported purely so scripts/test-receipt-render.js (and any future unit
  // test) can exercise the date/number math directly without needing a
  // live MongoDB connection -- these five have no DB dependency at all.
  clampDay,
  fmtDate,
  makeDocNumber,
  billLabelFor,
  getPackageSpeed,
};
