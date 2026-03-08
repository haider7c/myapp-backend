// services/mikrotikService.js
const { RouterOSAPI } = require("node-routeros");

const host = process.env.MT_HOST;
const port = parseInt(process.env.MT_PORT) || 2222;
const user = process.env.MT_USER;
const pass = process.env.MT_PASS;

// Validate environment variables
if (!host || !user || !pass) {
  console.error(
    "❌ MikroTik configuration missing. Check MT_HOST, MT_USER, MT_PASS in .env",
  );
}

let connection = null;

async function connect() {
  try {
    console.log(`Connecting to MikroTik at ${host}:${port}...`);

    // Create new connection
    const conn = new RouterOSAPI({
      host,
      port,
      user,
      password: pass,
      timeout: 10000,
      keepalive: true,
    });

    // Connect to device
    await conn.connect();

    console.log("✅ Connected to MikroTik successfully");
    return conn;
  } catch (error) {
    console.error("❌ MikroTik connection error:", error.message);
    throw new Error(`Failed to connect to MikroTik: ${error.message}`);
  }
}

async function getPPPoEUsers() {
  let conn = null;
  try {
    conn = await connect();

    console.log("Fetching PPPoE users...");
    const users = await conn.write("/ppp/secret/print");

    await conn.close();
    console.log(`✅ Retrieved ${users.length} PPPoE users`);

    return users;
  } catch (error) {
    console.error("Error in getPPPoEUsers:", error.message);
    if (conn) {
      try {
        await conn.close();
      } catch (e) {}
    }
    throw error;
  }
}

async function getActiveUsers() {
  let conn = null;
  try {
    conn = await connect();

    console.log("Fetching active users with traffic stats...");

    const users = await conn.write("/ppp/active/print", [
      "=.proplist=.id,name,service,address,uptime,bytes-in,bytes-out,packets-in,packets-out",
    ]);

    await conn.close();

    console.log(`✅ Retrieved ${users.length} active users`);

    return users;
  } catch (error) {
    console.error("Error in getActiveUsers:", error.message);
    if (conn) {
      try {
        await conn.close();
      } catch (e) {}
    }
    throw error;
  }
}

async function testConnection() {
  let conn = null;
  try {
    conn = await connect();

    // Test with a simple command
    const identity = await conn.write("/system/identity/print");
    const resources = await conn.write("/system/resource/print");

    await conn.close();

    return {
      identity: identity[0] || { name: "Unknown" },
      resources: resources[0] || {},
    };
  } catch (error) {
    console.error("Test connection error:", error.message);
    if (conn) {
      try {
        await conn.close();
      } catch (e) {}
    }
    throw error;
  }
}

// Format PPPoE users for better readability
async function getFormattedPPPoEUsers() {
  const users = await getPPPoEUsers();
  return users.map((user) => ({
    id: user[".id"],
    name: user.name,
    service: user.service || "pppoe",
    profile: user.profile,
    localAddress: user["local-address"],
    remoteAddress: user["remote-address"],
    disabled: user.disabled === "true",
    comment: user.comment || "",
    lastLoggedOut: user["last-logged-out"] || "",
    uptime: user.uptime || "",
  }));
}

// Format active users for better readability
async function getFormattedActiveUsers() {
  const users = await getActiveUsers();
  return users.map((user) => ({
    id: user[".id"],
    name: user.name,
    service: user.service,
    address: user.address,
    uptime: user.uptime,
    bytesIn: parseInt(user["bytes-in"] || "0"),
    bytesOut: parseInt(user["bytes-out"] || "0"),
    packetsIn: parseInt(user["packets-in"] || "0"),
    packetsOut: parseInt(user["packets-out"] || "0"),
    radius: user.radius || false,
  }));
}
async function getUserTraffic(username) {
  let conn = null;

  try {
    conn = await connect();

    const interfaceName = `<pppoe-${username}>`;

    const result = await conn.write("/interface/monitor-traffic", [
      `=interface=${interfaceName}`,
      "=once=",
    ]);

    const data = result[0];

    const download = parseInt(
      (data["rx-bits-per-second"] || "0").replace("bps", ""),
    );
    const upload = parseInt(
      (data["tx-bits-per-second"] || "0").replace("bps", ""),
    );

    await conn.close();

    return {
      download_bps: download,
      upload_bps: upload,
    };
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}
async function getLiveTraffic(interface = "all") {
  let conn = null;
  try {
    conn = await connect();

    const interfaces = await conn.write("/interface/print");

    const trafficData = [];

    for (const iface of interfaces) {
      if (interface !== "all" && iface.name !== interface) continue;

      const monitor = await conn.write("/interface/monitor-traffic", [
        `=interface=${iface.name}`,
        "=once=",
      ]);

      const data = monitor[0];

      trafficData.push({
        name: iface.name,
        rxBitsPerSecond: parseInt(data["rx-bits-per-second"] || "0"),
        txBitsPerSecond: parseInt(data["tx-bits-per-second"] || "0"),
        rxBytesPerSecond: parseInt(data["rx-bits-per-second"] || "0") / 8,
        txBytesPerSecond: parseInt(data["tx-bits-per-second"] || "0") / 8,
      });
    }

    await conn.close();
    return trafficData;
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}

async function getTopBandwidthUsers(limit = 10) {
  let conn = null;

  try {
    conn = await connect();

    const activeUsers = await conn.write("/ppp/active/print");

    const users = activeUsers.map((user) => {
      const bytesIn = parseInt(user["bytes-in"] || "0");
      const bytesOut = parseInt(user["bytes-out"] || "0");

      const bandwidth = bytesIn + bytesOut;

      return {
        username: user.name,
        address: user.address,
        uptime: user.uptime,
        bytesIn,
        bytesOut,
        avgBandwidthBps: bandwidth,
      };
    });

    users.sort((a, b) => b.avgBandwidthBps - a.avgBandwidthBps);

    await conn.close();

    return users.slice(0, limit);
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}

async function getTrafficMonitor(interface, seconds = 60) {
  let conn = null;

  try {
    conn = await connect();

    const result = await conn.write("/interface/monitor-traffic", [
      `=interface=${interface}`,
      `=duration=${seconds}`,
    ]);

    await conn.close();

    return result;
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}

async function getSystemResources() {
  let conn = null;

  try {
    conn = await connect();

    const res = await conn.write("/system/resource/print");

    await conn.close();

    return res[0];
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}
async function disablePPPoEUser(userId) {
  let conn = null;

  try {
    conn = await connect();

    await conn.write("/ppp/secret/disable", [`=.id=${userId}`]);

    await conn.close();

    return {
      success: true,
      message: "User disabled successfully",
    };
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}

async function enablePPPoEUser(userId) {
  let conn = null;

  try {
    conn = await connect();

    await conn.write("/ppp/secret/enable", [`=.id=${userId}`]);

    await conn.close();

    return {
      success: true,
      message: "User enabled successfully",
    };
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}

async function disconnectUser(username) {
  let conn = null;

  try {
    conn = await connect();

    const active = await conn.write("/ppp/active/print");

    const user = active.find((u) => u.name === username);

    if (!user) {
      await conn.close();
      return {
        success: false,
        message: "User not online",
      };
    }

    await conn.write("/ppp/active/remove", [`=.id=${user[".id"]}`]);

    await conn.close();

    return {
      success: true,
      message: "User disconnected",
    };
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}

async function disconnectAllUsers() {
  let conn = null;

  try {
    conn = await connect();

    const active = await conn.write("/ppp/active/print");

    for (const user of active) {
      await conn.write("/ppp/active/remove", [`=.id=${user[".id"]}`]);
    }

    await conn.close();

    return {
      success: true,
      message: "All users disconnected",
    };
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}

module.exports = {
  testConnection,
  getPPPoEUsers,
  getActiveUsers,
  getFormattedPPPoEUsers,
  getFormattedActiveUsers,
  getLiveTraffic,
  getTopBandwidthUsers,
  getTrafficMonitor,
  getSystemResources,
  getUserTraffic,

  enablePPPoEUser,
  disablePPPoEUser,
  disconnectUser,
  disconnectAllUsers,
};
