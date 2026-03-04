// routes/mikrotikRoutes.js
const express = require("express");
const router = express.Router();

const {
  testConnection,
  getPPPoEUsers,
  getActiveUsers,
  getFormattedPPPoEUsers,
  getFormattedActiveUsers,
} = require("../services/mikrotikService");

// Debug endpoint to check configuration
router.get("/debug", (req, res) => {
  res.json({
    status: "MikroTik RouterOS API",
    environment: {
      host: process.env.MT_HOST ? "✓ Set" : "✗ Not set",
      port: process.env.MT_PORT ? "✓ Set" : "✗ Not set (using default 2222)",
      user: process.env.MT_USER ? "✓ Set" : "✗ Not set",
      pass: process.env.MT_PASS ? "✓ Set" : "✗ Not set",
    },
    instructions: {
      test: "First test connection at /api/mikrotik/test",
      pppoe: "Get PPPoE users at /api/mikrotik/pppoe-users",
      online: "Get online users at /api/mikrotik/online-users",
    },
  });
});

// Test connection endpoint
router.get("/test", async (req, res) => {
  try {
    console.log("Testing MikroTik connection...");
    const result = await testConnection();
    res.json({
      success: true,
      message: "✅ Connected to MikroTik successfully",
      data: result,
    });
  } catch (err) {
    console.error("Test connection error:", err);
    res.status(500).json({
      success: false,
      error: err.message,
      details:
        "Check your MikroTik credentials and make sure API is enabled on port 2222",
      solution:
        "On MikroTik: /ip service enable api and /ip service set api port=2222",
    });
  }
});

// Get all PPPoE users (raw)
router.get("/pppoe-users", async (req, res) => {
  try {
    console.log("Fetching PPPoE users...");
    const users = await getPPPoEUsers();
    res.json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (err) {
    console.error("Error in /pppoe-users:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Get formatted PPPoE users
router.get("/pppoe-users/formatted", async (req, res) => {
  try {
    const users = await getFormattedPPPoEUsers();
    res.json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Get active users (raw)
router.get("/online-users", async (req, res) => {
  try {
    console.log("Fetching active users...");
    const users = await getActiveUsers();
    res.json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (err) {
    console.error("Error in /online-users:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Get formatted active users
router.get("/online-users/formatted", async (req, res) => {
  try {
    const users = await getFormattedActiveUsers();
    res.json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;
