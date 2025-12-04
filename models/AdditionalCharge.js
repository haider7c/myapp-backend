const mongoose = require("mongoose");

const additionalChargeSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },

    charges: [
      {
        title: String,
        amount: Number,
      },
    ],

    totalAmount: Number,

    includeInNextBill: {
      type: Boolean,
      default: false,
    },

    month: Number,
    year: Number,

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdditionalCharge", additionalChargeSchema);
