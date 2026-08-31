const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
    },

    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["owner", "employee"],
      required: true,
    },

    // If role === employee → link to owner
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // 🔑 NEW: Areas assigned to employee
    assignedAreas: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Area",
      },
    ],

    // A restricted employee account (role stays "employee" so the existing
    // area-scoping/permission logic above keeps applying unchanged) that
    // can do exactly one thing: look up a customer and set their GPS
    // location. Meant for someone whose only job is walking around
    // recording where customers actually are. Enforced both in the app
    // (they're routed straight to the Set Customer Location screen and
    // nowhere else) and in the API itself (see middleware/auth.js).
    locationOnly: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
