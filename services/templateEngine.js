// services/templateEngine.js
//
// Reminder Messages & Receipt Management module. Pure variable-substitution
// engine shared by every reminder send path and by the admin Preview
// feature (req 5) -- so what an admin sees in Preview is byte-for-byte what
// actually gets sent. No side effects, no DB access -- callers pass in
// whatever documents they already have (Customer/Invoice/Payment/
// ReceiptSettings), this just formats strings.
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function money(n) {
  return `Rs. ${Number(n || 0).toLocaleString("en-PK")}`;
}

function formatDate(d) {
  if (!d) return "";
  const date = new Date(d);
  return isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Builds the flat { VARIABLE_NAME: "value" } map used for substitution.
// Every field is optional -- missing pieces just render as an empty string
// rather than throwing, so Preview/send never crash on incomplete data.
function buildVariableMap({ customer, invoice, payment, receiptSettings, customNotes, dueDateOverride } = {}) {
  const billMonthLabel =
    invoice && invoice.month ? `${MONTH_NAMES[invoice.month - 1]} ${invoice.year}` : "";

  return {
    customerName: customer?.customerName || "",
    customerId: customer?.customerId || "",
    username: customer?.username || customer?.customerId || "",
    packageName: customer?.packageName || "",
    billMonth: billMonthLabel,
    billAmount: money(invoice?.billAmount ?? customer?.amount),
    previousDue: money(invoice?.previousDue ?? invoice?.openingBalance ?? 0),
    totalDue: money(invoice?.closingBalance ?? invoice?.totalPayable ?? 0),
    dueDate: dueDateOverride || formatDate(invoice?.dueDate) || (customer?.billReceiveDate ? `Day ${customer.billReceiveDate} of the month` : ""),
    paymentDate: formatDate(payment?.paymentDate) || formatDate(new Date()),
    invoiceNumber: invoice?.invoiceNumber || "",
    receiptNumber: payment?.receiptNumber || "",
    transactionId: payment?.transactionId || "",
    paymentMethod: payment?.paymentMethod || "",
    companyName: receiptSettings?.companyName || "",
    companyPhone: receiptSettings?.phone || "",
    companyWhatsapp: receiptSettings?.whatsappNumber || receiptSettings?.phone || "",
    supportNumber: receiptSettings?.supportUAN || receiptSettings?.phone || "",
    customNotes: customNotes || "",
  };
}

// Replaces every {{variableName}} (case-insensitive, whitespace-tolerant)
// with its resolved value; unknown variables are left blank rather than
// showing a stray "{{typo}}" in a real customer message.
function substitute(text, varsMap) {
  if (!text) return "";
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name) => {
    const key = Object.keys(varsMap).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? String(varsMap[key] ?? "") : "";
  });
}

// Stitches title/greeting/body/closing together (blank sections skipped)
// exactly the way the original hand-written templates were spaced, then
// substitutes variables across the whole result.
function renderTemplate(template, ctx = {}) {
  const varsMap = buildVariableMap(ctx);
  const parts = [template?.title, template?.greeting, template?.body, template?.closing]
    .map((p) => (p || "").trim())
    .filter(Boolean);
  return substitute(parts.join("\n\n"), varsMap);
}

const VARIABLE_CATALOG = [
  { key: "customerName", label: "Customer Name" },
  { key: "customerId", label: "Customer ID" },
  { key: "username", label: "Username" },
  { key: "packageName", label: "Package Name" },
  { key: "billMonth", label: "Bill Month" },
  { key: "billAmount", label: "Bill Amount" },
  { key: "previousDue", label: "Previous Due" },
  { key: "totalDue", label: "Total Due" },
  { key: "dueDate", label: "Due Date" },
  { key: "paymentDate", label: "Payment Date" },
  { key: "invoiceNumber", label: "Invoice Number" },
  { key: "receiptNumber", label: "Receipt Number" },
  { key: "transactionId", label: "Transaction ID" },
  { key: "paymentMethod", label: "Payment Method" },
  { key: "companyName", label: "Company Name" },
  { key: "companyPhone", label: "Company Phone" },
  { key: "companyWhatsapp", label: "Company WhatsApp" },
  { key: "supportNumber", label: "Support Number" },
  { key: "customNotes", label: "Custom Notes" },
];

// Sample data for the admin Preview feature (req 5) -- realistic-looking
// but clearly fake, so nobody mistakes a preview for a real send.
const SAMPLE_CONTEXT = {
  customer: {
    customerName: "Ahmed Raza",
    customerId: "CUST-0042",
    username: "ahmed.raza",
    packageName: "20 Mbps Home",
    amount: 2000,
    billReceiveDate: 5,
  },
  invoice: {
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    billAmount: 2000,
    previousDue: 500,
    closingBalance: 2500,
    totalPayable: 2500,
    invoiceNumber: "INV-000123",
    dueDate: new Date(),
  },
  payment: {
    receiptNumber: "RCT-000456",
    transactionId: "TXN-789",
    paymentMethod: "Cash",
    paymentDate: new Date(),
  },
  customNotes: "Thank you for being a loyal customer!",
};

module.exports = { renderTemplate, buildVariableMap, substitute, VARIABLE_CATALOG, SAMPLE_CONTEXT, money, formatDate };
