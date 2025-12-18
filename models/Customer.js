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
