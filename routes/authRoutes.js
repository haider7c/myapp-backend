const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const auth = require("../middleware/auth");

const router = express.Router();

/**
 * REGISTER (Owner or Employee)
 */
// Public self-registration only ever creates a brand-new independent
// "owner" tenant. Employee accounts must NOT be creatable through this
// public route: it used to accept a client-supplied `ownerId` straight from
// the request body, which let anyone register themselves as an "employee"
// under any other tenant's ownerId (just by guessing/knowing the id) and
// then use employee-scoped routes to read that tenant's data. Employees are
// created the safe way instead, by an authenticated owner, via
// POST /api/employees (see routes/employeeRoutes.js), which stamps
// ownerId from the logged-in owner's own token -- never from the request.
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const exists = await User.findOne({ email });
    if (exists)
      return res.status(400).json({ message: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: "owner",
      ownerId: null,
    });

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

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
