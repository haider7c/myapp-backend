// routes/mikrotikRoutes.js
const express = require("express");
const router = express.Router();

const {
  getPPPoEUsers,
  getActiveUsers,
  getUserTraffic,
  getPPPProfiles,
  getInterfaces,
  getQueues,
  getSystemResources,
  getTrafficMonitor,
  addPPPoEUser,
  updatePPPoEUser,
  deletePPPoEUser,
  enablePPPoEUser,
  disablePPPoEUser,
  disconnectUser,
  disconnectAllUsers,
  addSimpleQueue,
  deleteQueue,
  addPPPProfile,
  getLiveTraffic,
  getTopBandwidthUsers,
  testConnection,
  rebootRouter,
} = require("../services/mikrotikService");

// ==================== DEBUG & TEST ====================

router.get("/debug", (req, res) => {
  res.json({
    status: "MikroTik RouterOS API",
    environment: {
      host: process.env.MT_HOST ? "✓ Set" : "✗ Not set",
      port: process.env.MT_PORT ? "✓ Set" : "✗ Not set (using default 2222)",
      user: process.env.MT_USER ? "✓ Set" : "✗ Not set",
      pass: process.env.MT_PASS ? "✓ Set" : "✗ Not set",
    },
    endpoints: {
      system: "/test, /resources, /interfaces, /reboot",
      users: "/pppoe-users, /online-users, /user/:username, /search/:username",
      management:
        "/user/add, /user/disable/:id, /user/enable/:id, /user/delete/:id, /disconnect/:username",
      monitoring: "/traffic, /top-bandwidth, /live-traffic",
      profiles: "/profiles, /profiles/list, /profile/add",
    },
  });
});

router.get("/test", async (req, res) => {
  try {
    const result = await testConnection();
    res.json({
      success: true,
      message: "✅ Connected to MikroTik successfully",
      data: result,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== GET ROUTES ====================

// Get all PPPoE users
router.get("/pppoe-users", async (req, res) => {
  try {
    const users = await getPPPoEUsers();
    res.json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get online users
router.get("/online-users", async (req, res) => {
  try {
    const users = await getActiveUsers();
    res.json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get PPP profiles
// MikroTik service mein yeh function check karein
router.get("/profiles/list", async (req, res) => {
  try {
    const profiles = await getPPPProfiles();
    res.json({
      success: true,
      count: profiles.length,
      data: profiles,
    });
  } catch (err) {
    console.error("Profiles error:", err);
    res.status(500).json({
      success: false,
      error: err.message,
      details: "Failed to fetch PPP profiles",
    });
  }
});
// Get interfaces
router.get("/interfaces", async (req, res) => {
  try {
    const interfaces = await getInterfaces();
    res.json({
      success: true,
      count: interfaces.length,
      data: interfaces,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get queues
router.get("/queues", async (req, res) => {
  try {
    const queues = await getQueues();
    res.json({
      success: true,
      count: queues.length,
      data: queues,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get system resources
router.get("/resources", async (req, res) => {
  try {
    const resources = await getSystemResources();
    res.json({
      success: true,
      data: resources,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get statistics
router.get("/stats", async (req, res) => {
  try {
    const [pppoeUsers, activeUsers, resources] = await Promise.all([
      getPPPoEUsers(),
      getActiveUsers(),
      getSystemResources(),
    ]);

    const totalUsers = pppoeUsers.length;
    const onlineUsers = activeUsers.length;
    const disabledUsers = pppoeUsers.filter(
      (u) => u.disabled === "true",
    ).length;
    const enabledUsers = totalUsers - disabledUsers;

    res.json({
      success: true,
      statistics: {
        total_users: totalUsers,
        online_users: onlineUsers,
        offline_users: totalUsers - onlineUsers,
        disabled_users: disabledUsers,
        enabled_users: enabledUsers,
        online_percentage: ((onlineUsers / totalUsers) * 100).toFixed(1) + "%",
        cpu_load: resources["cpu-load"] || "0",
        uptime: resources.uptime,
        free_memory: resources["free-memory"],
        total_memory: resources["total-memory"],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Search user by username
router.get("/search/:username", async (req, res) => {
  try {
    const users = await getPPPoEUsers();
    const searchTerm = req.params.username.toLowerCase();

    const results = users.filter((user) =>
      user.name.toLowerCase().includes(searchTerm),
    );

    const activeUsers = await getActiveUsers();
    const activeMap = new Set(activeUsers.map((u) => u.name));

    const formatted = results.map((user) => ({
      id: user[".id"],
      username: user.name,
      profile: user.profile,
      password: user.password,
      disabled: user.disabled === "true",
      last_login: user["last-logged-out"],
      last_mac: user["last-caller-id"],
      currently_online: activeMap.has(user.name),
      comment: user.comment || "",
    }));

    res.json({
      success: true,
      count: formatted.length,
      results: formatted,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get user by exact username
router.get("/user/:username", async (req, res) => {
  try {
    const username = req.params.username;

    const [pppoeUsers, activeUsers, traffic] = await Promise.all([
      getPPPoEUsers(),
      getActiveUsers(),
      getUserTraffic(username),
    ]);

    const user = pppoeUsers.find((u) => u.name === username);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: `User '${username}' not found`,
      });
    }

    const activeSession = activeUsers.find((u) => u.name === username);

    res.json({
      success: true,
      user: {
        id: user[".id"],
        username: user.name,
        password: user.password,
        profile: user.profile,
        service: user.service,
        disabled: user.disabled === "true",
        comment: user.comment || "",
        last_logout: user["last-logged-out"],
        last_mac: user["last-caller-id"],
        currently_online: !!activeSession,

        session: activeSession
          ? {
              address: activeSession.address,
              uptime: activeSession.uptime,
              caller_id: activeSession["caller-id"],
            }
          : null,

        traffic: traffic, // 👈 IMPORTANT
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// Get users by profile
router.get("/by-profile/:profile", async (req, res) => {
  try {
    const users = await getPPPoEUsers();
    const profile = req.params.profile;

    const filtered = users.filter((user) => user.profile === profile);
    const activeUsers = await getActiveUsers();
    const activeNames = new Set(activeUsers.map((u) => u.name));

    res.json({
      success: true,
      profile: profile,
      count: filtered.length,
      online: filtered.filter((u) => activeNames.has(u.name)).length,
      users: filtered.map((u) => ({
        name: u.name,
        online: activeNames.has(u.name),
        disabled: u.disabled === "true",
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all profiles with counts
router.get("/profiles", async (req, res) => {
  try {
    const users = await getPPPoEUsers();
    const activeUsers = await getActiveUsers();

    const profiles = {};
    users.forEach((user) => {
      const profile = user.profile || "default";
      if (!profiles[profile]) {
        profiles[profile] = { total: 0, online: 0, disabled: 0 };
      }
      profiles[profile].total++;
      if (user.disabled === "true") profiles[profile].disabled++;
    });

    activeUsers.forEach((user) => {
      const profile = user.profile || "default";
      if (profiles[profile]) {
        profiles[profile].online++;
      }
    });

    res.json({
      success: true,
      total_users: users.length,
      total_online: activeUsers.length,
      profiles: Object.keys(profiles).map((name) => ({
        name,
        total: profiles[name].total,
        online: profiles[name].online,
        disabled: profiles[name].disabled,
        utilization:
          ((profiles[name].online / profiles[name].total) * 100).toFixed(1) +
          "%",
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== USER MANAGEMENT ====================

// Add new user
router.post("/user/add", async (req, res) => {
  try {
    const { name, password, profile, comment, service, disabled } = req.body;

    if (!name || !profile) {
      return res.status(400).json({
        success: false,
        message: "Username and profile are required",
      });
    }

    const result = await addPPPoEUser({
      name,
      password: password || "1234",
      profile,
      comment: comment || "",
      service: service || "pppoe",
      disabled: disabled || false,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update user
router.put("/user/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    const updateData = req.body;

    const result = await updatePPPoEUser(userId, updateData);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Enable user
router.post("/user/enable/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    const result = await enablePPPoEUser(userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Disable user
router.post("/user/disable/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    const result = await disablePPPoEUser(userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete user
router.delete("/user/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    const result = await deletePPPoEUser(userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Disconnect specific user
router.post("/disconnect/:username", async (req, res) => {
  try {
    const username = req.params.username;
    const result = await disconnectUser(username);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Disconnect all users
router.post("/disconnect-all", async (req, res) => {
  try {
    const result = await disconnectAllUsers();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== PROFILE MANAGEMENT ====================

// Add new PPP profile
router.post("/profile/add", async (req, res) => {
  try {
    const profileData = req.body;

    if (!profileData.name) {
      return res.status(400).json({
        success: false,
        message: "Profile name is required",
      });
    }

    const result = await addPPPProfile(profileData);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== QUEUE MANAGEMENT ====================

// Add simple queue
router.post("/queue/add", async (req, res) => {
  try {
    const queueData = req.body;

    if (!queueData.name || !queueData.target) {
      return res.status(400).json({
        success: false,
        message: "Queue name and target are required",
      });
    }

    const result = await addSimpleQueue(queueData);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete queue
router.delete("/queue/:id", async (req, res) => {
  try {
    const queueId = req.params.id;
    const result = await deleteQueue(queueId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== LIVE TRAFFIC MONITORING ====================

// Get live traffic for all interfaces
router.get("/live-traffic", async (req, res) => {
  try {
    const interface = req.query.interface || "all";
    const traffic = await getLiveTraffic(interface);

    // Calculate total
    const totalRx = traffic.reduce(
      (sum, iface) => sum + iface.rxBytesPerSecond,
      0,
    );
    const totalTx = traffic.reduce(
      (sum, iface) => sum + iface.txBytesPerSecond,
      0,
    );

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      total: {
        rxBytesPerSecond: totalRx,
        txBytesPerSecond: totalTx,
        rxMbps: ((totalRx * 8) / 1000000).toFixed(2),
        txMbps: ((totalTx * 8) / 1000000).toFixed(2),
      },
      interfaces: traffic,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get top bandwidth users
router.get("/top-bandwidth", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const topUsers = await getTopBandwidthUsers(limit);

    const totalBandwidth = topUsers.reduce(
      (sum, user) => sum + user.avgBandwidthBps,
      0,
    );

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      total_active_users: topUsers.length,
      total_bandwidth_mbps: ((totalBandwidth * 8) / 1000000).toFixed(2),
      users: topUsers,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Monitor specific interface traffic
router.get("/monitor/:interface", async (req, res) => {
  try {
    const interface = req.params.interface;
    const seconds = parseInt(req.query.seconds) || 60;

    const traffic = await getTrafficMonitor(interface, seconds);

    res.json({
      success: true,
      interface,
      data: traffic,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== SYSTEM ACTIONS ====================

// Reboot router
router.post("/reboot", async (req, res) => {
  try {
    const result = await rebootRouter();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
