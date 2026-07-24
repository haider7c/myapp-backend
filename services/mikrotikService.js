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
    // node-routeros' own connection-timeout/refused errors sometimes carry
    // no .message at all (just an error `code`/`errno`, or nothing), which
    // is why this used to log "MikroTik connection error: " with nothing
    // after the colon -- impossible to tell ECONNREFUSED from ETIMEDOUT
    // from an auth failure. Log everything we can get out of it instead.
    const details =
      error?.message ||
      error?.code ||
      error?.errno ||
      (typeof error === "string" ? error : null) ||
      JSON.stringify(error, Object.getOwnPropertyNames(error || {})) ||
      "Unknown error (no message/code on the thrown error object)";
    console.error(`❌ MikroTik connection error [host=${host} port=${port}]:`, details);
    throw new Error(`Failed to connect to MikroTik at ${host}:${port}: ${details}`);
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

/**
 * UPDATE PPPoE USER FUNCTION - ADD THIS
 */
async function updatePPPoEUser(userId, updateData) {
  let conn = null;

  try {
    conn = await connect();

    console.log(`Updating PPPoE user with ID: ${userId}`, updateData);

    // Build command parameters
    const params = [`=.id=${userId}`];

    if (updateData.password) {
      params.push(`=password=${updateData.password}`);
    }

    if (updateData.profile) {
      params.push(`=profile=${updateData.profile}`);
    }

    if (updateData.comment !== undefined) {
      params.push(`=comment=${updateData.comment || ""}`);
    }

    if (updateData.service) {
      params.push(`=service=${updateData.service}`);
    }

    // Execute update command
    await conn.write("/ppp/secret/set", params);

    await conn.close();

    return {
      success: true,
      message: "User updated successfully",
      data: updateData,
    };
  } catch (error) {
    console.error("Error in updatePPPoEUser:", error.message);
    if (conn) {
      try {
        await conn.close();
      } catch (e) {}
    }
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

// Placeholder functions for missing exports
async function getPPPProfiles() {
  let conn = null;
  try {
    conn = await connect();
    const profiles = await conn.write("/ppp/profile/print");
    await conn.close();
    return profiles;
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}

async function getInterfaces() {
  let conn = null;
  try {
    conn = await connect();
    const interfaces = await conn.write("/interface/print");
    await conn.close();
    return interfaces;
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}

async function getQueues() {
  let conn = null;
  try {
    conn = await connect();
    const queues = await conn.write("/queue/simple/print");
    await conn.close();
    return queues;
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}

async function addPPPoEUser(userData) {
  let conn = null;
  try {
    conn = await connect();

    const params = [
      `=name=${userData.name}`,
      `=password=${userData.password}`,
      `=profile=${userData.profile}`,
      `=service=${userData.service || "pppoe"}`,
      `=comment=${userData.comment || ""}`,
      `=disabled=${userData.disabled ? "yes" : "no"}`,
    ];

    await conn.write("/ppp/secret/add", params);

    await conn.close();

    return {
      success: true,
      message: "User added successfully",
    };
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}

async function deletePPPoEUser(userId) {
  let conn = null;
  try {
    conn = await connect();

    await conn.write("/ppp/secret/remove", [`=.id=${userId}`]);

    await conn.close();

    return {
      success: true,
      message: "User deleted successfully",
    };
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}

async function addSimpleQueue(queueData) {
  // Placeholder
  return { success: true, message: "Queue added (placeholder)" };
}

async function deleteQueue(queueId) {
  // Placeholder
  return { success: true, message: "Queue deleted (placeholder)" };
}

async function addPPPProfile(profileData) {
  // Placeholder
  return { success: true, message: "Profile added (placeholder)" };
}

async function rebootRouter() {
  let conn = null;
  try {
    conn = await connect();
    await conn.write("/system/reboot");
    await conn.close();
    return { success: true, message: "Router rebooting" };
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}


async function getUsersStatusByNames(usernames = []) {
  const requestedNames = Array.from(
    new Set(
      (usernames || [])
        .map((username) => (username || "").toString().trim())
        .filter(Boolean),
    ),
  );

  if (requestedNames.length === 0) {
    return [];
  }

  let conn = null;

  try {
    conn = await connect();

    const [pppoeUsers, activeUsers] = await Promise.all([
      conn.write("/ppp/secret/print"),
      conn.write("/ppp/active/print"),
    ]);

    const activeMap = new Map(
      activeUsers.map((user) => [user.name?.toLowerCase(), user]),
    );

    const secretMap = new Map(
      pppoeUsers.map((user) => [user.name?.toLowerCase(), user]),
    );

    await conn.close();

    return requestedNames.map((username) => {
      const normalized = username.toLowerCase();
      const secret = secretMap.get(normalized);
      const active = activeMap.get(normalized);

      return {
        username,
        exists: !!secret,
        id: secret?.[".id"] || null,
        disabled: secret?.disabled === "true",
        profile: secret?.profile || null,
        comment: secret?.comment || "",
        online: !!active,
        address: active?.address || null,
        uptime: active?.uptime || null,
      };
    });
  } catch (error) {
    if (conn) await conn.close();
    throw error;
  }
}

async function getUserStatusByUsername(username) {
  const [status] = await getUsersStatusByNames([username]);
  return status || {
    username,
    exists: false,
    id: null,
    disabled: false,
    online: false,
  };
}

async function setPPPoEUserDisabledByUsername(username, disabled) {
  const normalizedUsername = (username || "").toString().trim();

  if (!normalizedUsername) {
    throw new Error("Username is required");
  }

  const status = await getUserStatusByUsername(normalizedUsername);

  if (!status.exists || !status.id) {
    return {
      success: false,
      message: `User ${normalizedUsername} not found`,
    };
  }

  if (disabled) {
    if (status.disabled) {
      return {
        success: true,
        alreadyApplied: true,
        message: "User already disabled",
        user: status,
      };
    }

    const result = await disablePPPoEUser(status.id);
    return { ...result, user: status };
  }

  if (!status.disabled) {
    return {
      success: true,
      alreadyApplied: true,
      message: "User already enabled",
      user: status,
    };
  }

  const result = await enablePPPoEUser(status.id);
  return { ...result, user: status };
}

async function disablePPPoEUserByUsername(username) {
  return setPPPoEUserDisabledByUsername(username, true);
}

async function enablePPPoEUserByUsername(username) {
  return setPPPoEUserDisabledByUsername(username, false);
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
  // NEW: Add update function
  updatePPPoEUser,
  // Add missing functions
  getPPPProfiles,
  getInterfaces,
  getQueues,
  addPPPoEUser,
  deletePPPoEUser,
  addSimpleQueue,
  deleteQueue,
  addPPPProfile,
  rebootRouter,
  getUsersStatusByNames,
  getUserStatusByUsername,
  enablePPPoEUserByUsername,
  disablePPPoEUserByUsername,
};
