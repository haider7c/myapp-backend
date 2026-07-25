const mongoose = require("mongoose");

// Originally a single global singleton (`key: "default"`) holding every
// piece of branding/text shown on a Manual Bill invoice/receipt. Now that
// the app supports multiple independent ISP-business tenants (owners), this
// is per-owner (`ownerId`) instead -- each business gets its own company
// name/logo/receipt config, auto-created with sensible defaults the first
// time it's requested (see routes/settingsRoutes.js). The original
// `key: "default"` row is kept around as a legacy fallback only (read if an
// owner-scoped row doesn't exist yet and hasn't been migrated) -- see
// scripts/migrateReminderTemplates.js, which also migrates this.
const receiptSettingsSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    key: { type: String, default: "default" },

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
    whatsappNumber: { type: String, default: "" }, // if blank, receipt/reminder previews fall back to `phone`
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

    // Receipt Template Editor additions (req 6-9) -----------------------
    // Which layout the Receipt Editor/preview/export/print renders with.
    // Admins can switch freely -- see req 8's six named layouts.
    layout: {
      type: String,
      enum: ["compact", "standard", "detailed", "a4", "thermal", "mobile_friendly"],
      default: "standard",
    },

    // Signature / authorized stamp areas (req 6) -- optional images shown
    // at the bottom of a receipt/invoice.
    signatureAreaEnabled: { type: Boolean, default: false },
    signatureImageUrl: { type: String, default: "" }, // data: URL or hosted URL
    signatureLabel: { type: String, default: "Authorized Signature" },
    stampAreaEnabled: { type: Boolean, default: false },
    stampImageUrl: { type: String, default: "" },
    stampLabel: { type: String, default: "Authorized Stamp" },

    // Per-field enable/disable toggles for what appears on a receipt (req
    // 7). Kept as one flat sub-document (rather than an array) so the UI
    // can render it as a simple list of switches and PUT the whole object
    // back in one call.
    fieldsConfig: {
      customerName: { type: Boolean, default: true },
      customerId: { type: Boolean, default: true },
      username: { type: Boolean, default: false },
      package: { type: Boolean, default: true },
      invoiceNumber: { type: Boolean, default: true },
      receiptNumber: { type: Boolean, default: true },
      paymentDate: { type: Boolean, default: true },
      billingMonth: { type: Boolean, default: true },
      paymentMethod: { type: Boolean, default: true },
      transactionId: { type: Boolean, default: true },
      previousDue: { type: Boolean, default: true },
      currentBill: { type: Boolean, default: true },
      discount: { type: Boolean, default: true },
      lateFee: { type: Boolean, default: true },
      advanceBalance: { type: Boolean, default: false },
      remainingDue: { type: Boolean, default: true },
      collectedBy: { type: Boolean, default: true },
      branch: { type: Boolean, default: false },
      operator: { type: Boolean, default: true },
      customerAddress: { type: Boolean, default: false },
      phoneNumber: { type: Boolean, default: false },
      notes: { type: Boolean, default: false },
      barcode: { type: Boolean, default: false },
      qrCode: { type: Boolean, default: true },
      statusBadge: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

// One settings row per tenant. `sparse: true` so the legacy pre-multi-tenant
// row (ownerId: null) doesn't collide with the uniqueness rule.
receiptSettingsSchema.index({ ownerId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("ReceiptSettings", receiptSettingsSchema);
