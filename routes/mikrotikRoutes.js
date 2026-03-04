const express = require("express");
const router = express.Router();

const {
  getPPPoEUsers,
  getActiveUsers,
} = require("../services/mikrotikService");

router.get("/pppoe-users", async (req, res) => {
  try {
    const users = await getPPPoEUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/online-users", async (req, res) => {
  try {
    const users = await getActiveUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
