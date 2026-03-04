// routes/mikrotikRoutes.js
const express = require("express");
const router = express.Router();

const {
  getPPPoEUsers,
  getActiveUsers,
  getFormattedPPPoEUsers,
  getFormattedActiveUsers,
} = require("../services/mikrotikService");

// Test connection endpoint
router.get("/test", async (req, res) => {
  try {
    const result = await testConnection();
    res.json({ success: true, message: "Connected to MikroTik successfully" });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      details:
        "Check MT_HOST, MT_PORT, MT_USER, MT_PASS in environment variables",
    });
  }
});

// Get all PPPoE users (raw data)
router.get("/pppoe-users", async (req, res) => {
  try {
    console.log("Fetching PPPoE users...");
    const users = await getPPPoEUsers();
    console.log(`Successfully fetched ${users.length} users`);
    res.json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (err) {
    console.error("Error in /pppoe-users:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
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

// Get active users (raw data)
router.get("/online-users", async (req, res) => {
  try {
    console.log("Fetching active users...");
    const users = await getActiveUsers();
    console.log(`Successfully fetched ${users.length} active users`);
    res.json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (err) {
    console.error("Error in /online-users:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
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
