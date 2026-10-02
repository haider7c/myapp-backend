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

    // Multiple connections under one customer (e.g. a home + an office
    // connection for the same person). Each extra connection has its own
    // ID/package/amount; `amount` above always holds the COMBINED total
    // (this connection's own amount + the sum of every entry here) so every
    // existing payment/invoice/receipt code path that already reads
    // `customer.amount` keeps working unchanged -- one customer, one bill,
    // one payment, one receipt, covering every ID. The individual
    // breakdown here is purely for display (customer card, forms, receipt
    // line items) and for reconstructing the primary connection's own
    // amount when re-opening the Edit form (primary = amount - sum(these)).
    additionalConnections: [
      {
        customerId: { type: String, required: true, trim: true }, // that connection's own ID/PPPoE username
        label: { type: String, default: "" }, // e.g. "Office", "Home 2" -- optional
        packageName: { type: String, default: "" },
        amount: { type: Number, required: true, default: 0 },
        address: { type: String, default: "" }, // snapshotted from the linked customer at selection time
        // Set only when this connection was linked via the "search existing
        // customers" autocomplete rather than typed by hand -- the OTHER
        // Customer document this row's data was copied from. Used purely to
        // drive the merge/un-merge bookkeeping on that document's own
        // `mergedInto` field (see below); this array entry itself is just a
        // display snapshot either way.
        linkedCustomerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
      },
    ],

    // Set on a customer's OWN document when they've been linked as someone
    // else's additional connection (see additionalConnections above) --
    // points at that primary customer. A merged customer keeps existing as
    // its own document (nothing about their bills/payments/history is
    // touched) but is hidden from the main customer lists, Payment
    // Promises, etc. so they don't show twice; un-linking the connection
    // sets this back to null and they reappear on their own.
    mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null, index: true },

    // Extra contact numbers beyond the required primary `phone` above --
    // e.g. a second household member, a work line. Purely additive: no
    // existing code that reads `phone` (WhatsApp sends, receipts, billing)
    // changes behavior because of this. A caller that wants to notify a
    // specific one of these (rather than the primary) passes it explicitly;
    // it's still validated server-side against this list before use.
    additionalPhones: [
      {
        phone: { type: String, required: true, trim: true },
        label: { type: String, default: "" }, // e.g. "Home", "Work" -- optional
      },
    ],

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
    // When gpsLat/gpsLng were last set via the dedicated "Set Location"
    // flow (device GPS capture) or the profile edit form -- lets the
    // customer-detail view show "location set 3 days ago" instead of just
    // the raw coordinates, and flags a location as possibly stale.
    gpsUpdatedAt: { type: Date, default: null },

    // Field photo documentation -- ID card (front/back) and a picture of
    // the house, captured on-site by whoever's visiting the customer (same
    // owner-or-assigned-employee permission as GPS location above). Each
    // field holds just the relative path under backend/uploads/ that the
    // file was saved at (see routes/customerRoutes.js's photo routes) --
    // NOT a public URL. These are sensitive documents, so they're only
    // ever served back out through the authenticated
    // GET /api/customers/:id/photos/:slot route, never as a static path.
    idCardFrontPath: { type: String, default: null },
    idCardBackPath: { type: String, default: null },
    housePicturePath: { type: String, default: null },
    photosUpdatedAt: { type: Date, default: null },

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

    // ---------------------------------------------------------------
    // New Connections module addition -- a one-time connection/
    // installation fee, entirely separate from the recurring monthly
    // package billing above (Invoice/services/billingEngine.js never
    // read or write these). total/paid are the running numbers (due =
    // total - paid, computed on read rather than stored, so it can never
    // drift out of sync); connectionFeeHistory is the full audit trail of
    // every payment and due adjustment made against them, newest last.
    // ---------------------------------------------------------------
    connectionFee: {
      total: { type: Number, default: 0 },
      paid: { type: Number, default: 0 },
    },
    connectionFeeHistory: [
      {
        type: { type: String, enum: ["due_added", "due_removed", "payment"], required: true },
        amount: { type: Number, required: true },
        note: { type: String, default: "" },
        paymentMethod: { type: String, default: "" }, // only set on "payment" entries
        performedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        performedByRole: { type: String, default: "" },
        date: { type: Date, default: Date.now },
      },
    ],

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
