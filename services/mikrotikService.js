// services/mikrotikService.js
const MikroNode = require("mikronode-ng");

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

async function connect() {
  try {
    console.log(`Connecting to MikroTik at ${host}:${port}...`);
    const device = new MikroNode(host, port);

    // Add connection timeout
    const connection = await device.connect(user, pass, {
      timeout: 10000, // 10 seconds timeout
    });

    console.log("✅ Connected to MikroTik");
    return connection;
  } catch (error) {
    console.error("❌ MikroTik connection error:", error.message);
    throw new Error(`Failed to connect to MikroTik: ${error.message}`);
  }
}

async function getPPPoEUsers() {
  let conn = null;
  try {
    conn = await connect();
    const chan = await conn.openChannel();

    const users = [];

    // Write command and wait for data
    chan.write("/ppp/secret/print");

    return new Promise((resolve, reject) => {
      chan.on("data", (data) => {
        users.push(data);
      });

      chan.on("done", () => {
        conn.close();
        console.log(`Retrieved ${users.length} PPPoE users`);
        resolve(users);
      });

      chan.on("error", (err) => {
        conn.close();
        reject(err);
      });

      // Set timeout
      setTimeout(() => {
        conn.close();
        reject(new Error("MikroTik command timeout"));
      }, 15000);
    });
  } catch (error) {
    if (conn) conn.close();
    throw error;
  }
}

async function getActiveUsers() {
  let conn = null;
  try {
    conn = await connect();
    const chan = await conn.openChannel();

    const users = [];

    chan.write("/ppp/active/print");

    return new Promise((resolve, reject) => {
      chan.on("data", (data) => {
        users.push(data);
      });

      chan.on("done", () => {
        conn.close();
        console.log(`Retrieved ${users.length} active users`);
        resolve(users);
      });

      chan.on("error", (err) => {
        conn.close();
        reject(err);
      });

      setTimeout(() => {
        conn.close();
        reject(new Error("MikroTik command timeout"));
      }, 15000);
    });
  } catch (error) {
    if (conn) conn.close();
    throw error;
  }
}

// Alternative function to get formatted users
async function getFormattedPPPoEUsers() {
  const users = await getPPPoEUsers();
  return users.map((user) => ({
    id: user[".id"],
    name: user.name,
    service: user.service,
    profile: user.profile,
    localAddress: user["local-address"],
    remoteAddress: user["remote-address"],
    disabled: user.disabled === "true",
    comment: user.comment || "",
  }));
}

async function getFormattedActiveUsers() {
  const users = await getActiveUsers();
  return users.map((user) => ({
    id: user[".id"],
    name: user.name,
    service: user.service,
    address: user.address,
    uptime: user.uptime,
    bytesIn: user["bytes-in"],
    bytesOut: user["bytes-out"],
    packetsIn: user["packets-in"],
    packetsOut: user["packets-out"],
  }));
}

module.exports = {
  getPPPoEUsers,
  getActiveUsers,
  getFormattedPPPoEUsers,
  getFormattedActiveUsers,
};
