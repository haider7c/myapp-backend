const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const auth = require("../middleware/auth");
const { isOwner } = require("../middleware/roles");

/**
 * =========================
 * CREATE EMPLOYEE (OWNER)
 * POST /api/employees
 * =========================
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

/**
 * =========================
 * GET EMPLOYEES (OWNER)
 * GET /api/employees
 * =========================
 */
router.get("/", auth, isOwner, async (req, res) => {
  try {
    const employees = await User.find({
      role: "employee",
      ownerId: req.user.id,
      isActive: true,
    }).select("-password");

    res.json(employees);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * =========================
 * UPDATE EMPLOYEE AREAS
 * PUT /api/employees/:id
 * =========================
 */
router.put("/:id", auth, isOwner, async (req, res) => {
  try {
    const { areas } = req.body;

    const employee = await User.findOneAndUpdate(
      {
        _id: req.params.id,
        ownerId: req.user.id,
        role: "employee",
      },
      { assignedAreas: areas },
      { new: true }
    ).select("-password");

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    res.json(employee);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * =========================
 * DELETE EMPLOYEE
 * DELETE /api/employees/:id
 * =========================
 */
router.delete("/:id", auth, isOwner, async (req, res) => {
  try {
    const employee = await User.findOneAndDelete({
      _id: req.params.id,
      ownerId: req.user.id,
      role: "employee",
    });

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    res.json({ message: "Employee deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
