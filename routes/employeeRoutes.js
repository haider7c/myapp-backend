const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const auth = require("../middleware/auth");
const { isOwner } = require("../middleware/roles");

/**
 * CREATE EMPLOYEE
 */
router.post("/", auth, isOwner, async (req, res) => {
  try {
    const { name, email, password, areas } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const employee = await User.create({
      name,
      email,
      password: hashed,
      role: "employee",
      ownerId: req.user.id,
      assignedAreas: areas || [],
    });

    res.json(employee);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
