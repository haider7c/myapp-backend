const mongoose = require("mongoose");

// Singleton document (there is only ever one row, keyed by `key: "default"`)
// holding every piece of branding/text shown on a Manual Bill invoice/receipt.
// Edited from the Settings page (desktop) with a live preview, so no one has
// to touch code to re-brand or re-word their receipts. Ported from the
// desktop app so both apps render identically-branded receipts.
const receiptSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },

    // Branding
    companyName: { type: String, default: "NetConnect" },
    tagline: { type: String, default: "INTERNET SERVICES" },
    logo: { type: String, default: "" }, // data: URL (base64) or empty for no logo
    primaryColor: { type: String, default: "#052F74" }, // header bars / panel headers
    accentColor: { type: String, default: "#1F915C" }, // paid/success highlights
    headingColor: { type: String, default: "#042968" }, // heading & emphasis text (company name, invoice title, totals)

    // Company contact info
    address: { type: String, default: "123, Tech Street, Network City, Lahore, Pakistan" },
    phone: { type: String, default: "+92 300 1234567" },
    email: { type: String, default: "support@netconnect.pk" },
    website: { type: String, default: "www.netconnect.pk" },

    // Invoice behaviour
    invoicePrefix: { type: String, default: "INV-" },
    currency: { type: String, default: "PKR" },
    taxLabel: { type: String, default: "Taxes (Federal Excise Duty)" },
    defaultTaxRate: { type: Number, default: 0 }, // percentage, e.g. 12 for 12%

    // Messaging
    thankYouHeading: { type: String, default: "THANK YOU" },
    thankYouMessage: { type: String, default: "for being our valued customer" },
    reminderNote: {
      type: String,
      default: "Pay your bill on time and enjoy uninterrupted internet service. Thank you!",
    },
    termsAndConditions: {
      type: [String],
      default: [
        "Please pay your bill before the due date to avoid service interruption.",
        "This is a computer generated invoice and does not require any signature.",
        "For any queries, please contact our support.",
      ],
    },

    // Support info
    supportUAN: { type: String, default: "" },
    supportEmail: { type: String, default: "support@netconnect.pk" },
    supportHours: { type: String, default: "9:00 AM - 9:00 PM (Mon - Sat)" },

    // Receipt stub / QR
    showQRCode: { type: Boolean, default: true },
    qrCodeNote: { type: String, default: "Scan this QR Code to pay your next bill" },
    receivedByDefault: { type: String, default: "Support Team" },
    footerThankYouNote: { type: String, default: "We appreciate your business." },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ReceiptSettings", receiptSettingsSchema);
