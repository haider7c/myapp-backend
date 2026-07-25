const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    serialNumber: String,
    customerName: { type: String, required: true },
    phone: { type: String, required: true },
    address: String,
    cnic: String,
    regDate: Date,
    billReceiveDate: { type: Number, required: true },
    customerId: String,
    email: String,
    synced: Boolean,

    packageName: { type: String, required: true },
    amount: { type: Number, required: true },

    // ---------------------------------------------------------------
    // Customer Management module additions (all optional/additive --
    // existing code that doesn't reference these fields is unaffected).
    // ---------------------------------------------------------------

    // Profile
    photoUrl: { type: String, default: "" },
    username: { type: String, default: "" }, // login/PPPoE-style display username, distinct from customerId
    mobile: { type: String, default: "" }, // secondary contact number, distinct from primary `phone`
    installationAddress: { type: String, default: "" },
    city: { type: String, default: "" },
    gpsLat: { type: Number, default: null },
    gpsLng: { type: Number, default: null },

    // Connection information
    downloadSpeed: { type: String, default: "" },
    uploadSpeed: { type: String, default: "" },
    staticIp: { type: String, default: "" },
    pppoeUsername: { type: String, default: "" },
    onuMac: { type: String, default: "" },
    routerMac: { type: String, default: "" },
    installationDate: { type: Date, default: null },
    activationDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },

    // Financial (running balances -- kept in sync by services/billingEngine.js
    // as invoices/payments are generated and applied; never edited directly).
    securityDeposit: { type: Number, default: 0 },
    advanceBalance: { type: Number, default: 0 }, // credit from advance payments not yet applied to a generated invoice
    outstandingBalance: { type: Number, default: 0 }, // denormalized running total across all unpaid/partial invoices
    lastPaymentDate: { type: Date, default: null },
    lastPaymentAmount: { type: Number, default: null },
    paymentStatus: { type: String, default: "" },

    // 🔐 MULTI-TENANCY (VERY IMPORTANT)
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // 📍 AREA
    areaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Area",
      required: true,
      index: true,
    },

    // 🏢 SERVICE (Cybernet, Nayatel etc.)
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: true,
    },

    // 👷 Assigned employee (optional)
    assignedEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    status: {
      type: String,
      enum: ["active", "discontinued"],
      default: "active",
    },

    discontinuedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Customer", customerSchema);
