const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    serialNumber: String,
    customerName: String,
    phone: String,
    address: String,
    cnic: String,
    regDate: Date,
    billReceiveDate: Number,
    customerId: String,
    email: String,
    synced: Boolean,
    packageName: String,
    amount: Number,

    // 🔑 NEW FIELDS (IMPORTANT)
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    areaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Area",
      required: true,
    },

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
