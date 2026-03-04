// services/mikrotikService.js
let MikroNode;

// Try different import methods
try {
  // Try the default require
  MikroNode = require("mikronode-ng");
  console.log("✅ mikronode-ng loaded successfully");
} catch (err) {
  console.error("❌ Failed to load mikronode-ng:", err.message);

  // Try alternative import
  try {
    MikroNode = require("mikronode-ng").default;
    console.log("✅ mikronode-ng loaded with .default");
  } catch (err2) {
    console.error("❌ Alternative import also failed:", err2.message);
    throw new Error(
      "MikroNode package not found. Run: npm install mikronode-ng",
    );
  }
}

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

    // Check if MikroNode is properly initialized
    if (typeof MikroNode !== "function") {
      throw new Error(
        "MikroNode is not a constructor. Package may be corrupted.",
      );
    }

    const device = new MikroNode(host, port);

    // Add connection timeout
    const connection = await device.connect(user, pass, {
      timeout: 10000, // 10 seconds timeout
    });

    console.log("✅ Connected to MikroTik");
    return connection;
  } catch (error) {
    console.error("❌ MikroTik connection error:", error.message);
    console.error("Full error:", error);
    throw new Error(`Failed to connect to MikroTik: ${error.message}`);
  }
}

async function getPPPoEUsers() {
  let conn = null;
  try {
    conn = await connect();
    const chan = await conn.openChannel();

    const users = [];

    return new Promise((resolve, reject) => {
      // Write command
      chan.write("/ppp/secret/print");

      chan.on("data", (data) => {
        console.log("Received data:", data ? "yes" : "no");
        users.push(data);
      });

      chan.on("done", () => {
        console.log("Command done, closing connection");
        conn.close();
        resolve(users);
      });

      chan.on("error", (err) => {
        console.error("Channel error:", err);
        conn.close();
        reject(err);
      });

      chan.on("close", () => {
        console.log("Channel closed");
      });

      // Set timeout
      setTimeout(() => {
        console.log("Command timeout");
        conn.close();
        reject(new Error("MikroTik command timeout"));
      }, 15000);
    });
  } catch (error) {
    console.error("Error in getPPPoEUsers:", error);
    if (conn) {
      try {
        conn.close();
      } catch (e) {}
    }
    throw error;
  }
}

async function getActiveUsers() {
  let conn = null;
  try {
    conn = await connect();
    const chan = await conn.openChannel();

    const users = [];

    return new Promise((resolve, reject) => {
      chan.write("/ppp/active/print");

      chan.on("data", (data) => {
        users.push(data);
      });

      chan.on("done", () => {
        conn.close();
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
    if (conn) {
      try {
        conn.close();
      } catch (e) {}
    }
    throw error;
  }
}

async function testConnection() {
  let conn = null;
  try {
    conn = await connect();
    const chan = await conn.openChannel();

    return new Promise((resolve, reject) => {
      chan.write("/system/identity/print");

      let identity = null;
      chan.on("data", (data) => {
        identity = data;
        console.log("MikroTik identity:", data);
      });

      chan.on("done", () => {
        conn.close();
        resolve(identity);
      });

      chan.on("error", (err) => {
        conn.close();
        reject(err);
      });

      setTimeout(() => {
        conn.close();
        reject(new Error("Connection test timeout"));
      }, 10000);
    });
  } catch (error) {
    if (conn) {
      try {
        conn.close();
      } catch (e) {}
    }
    throw error;
  }
}

module.exports = {
  testConnection,
  getPPPoEUsers,
  getActiveUsers,
};
