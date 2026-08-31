const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const auth = require("../middleware/auth");

const router = express.Router();

// REGISTER -- intentionally removed as a public route.
//
// This used to be an open, unauthenticated POST /register that anyone who
// found the URL could hit to create a brand-new "owner" tenant (full app
// access) for themselves. That was fine while this was a single-owner
// deployment, but this backend is now meant to host multiple independent
// shop-owner clients on the same server/database -- per the owner's
// explicit choice, new clients are onboarded manually by the operator, not
// via self-signup. Neither the desktop nor mobile app has ever had a
// "Register" button wired to this route (verified -- it was reachable by
// direct API call only), so removing it breaks nothing in either app.
//
// To create a new owner account, run on the server:
//   node scripts/createOwnerAccount.js "<name>" "<email>" "<password>"

/**
 * LOGIN
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // ✅ HARD VALIDATION
    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const user = await User.findOne({ email });

    if (!user || !user.password) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    // ✅ bcrypt safe check
    const isMatch = await bcrypt.compare(
      String(password),
      String(user.password)
    );

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        ownerId: user.ownerId,
        locationOnly: !!user.locationOnly,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    return res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        ownerId: user.ownerId,
        locationOnly: !!user.locationOnly,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({
      message: "Server error during login",
    });
  }
});


/**
 * CHANGE PASSWORD (for the currently logged-in user, identified by their
 * JWT — ported from the desktop app, adapted to this backend's auth
 * pattern since there's no separate username-only lookup here)
 */
router.post("/change-password", auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const isMatch = await bcrypt.compare(String(currentPassword), String(user.password));
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Current password is incorrect" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ success: false, message: "Failed to change password" });
  }
});

module.exports = router;
