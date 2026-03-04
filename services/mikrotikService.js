// services/mikrotikService.js
const MikroNode = require("mikronode");

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

    const connection = MikroNode.getConnection(host, port, user, pass, {
      timeout: 10000,
    });

    // Wait for connection to be established
    return new Promise((resolve, reject) => {
      connection.on("error", (err) => {
        console.error("Connection error:", err);
        reject(err);
      });

      connection.on("connected", () => {
        console.log("✅ Connected to MikroTik");
        resolve(connection);
      });

      // Set timeout
      setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 10000);
    });
  } catch (error) {
    console.error("❌ MikroTik connection error:", error.message);
    throw new Error(`Failed to connect to MikroTik: ${error.message}`);
  }
}

async function getPPPoEUsers() {
  let connection = null;
  try {
    connection = await connect();

    return new Promise((resolve, reject) => {
      connection.get("/ppp/secret/print", (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data || []);
        }
        connection.close();
      });

      // Set timeout
      setTimeout(() => {
        connection.close();
        reject(new Error("MikroTik command timeout"));
      }, 15000);
    });
  } catch (error) {
    console.error("Error in getPPPoEUsers:", error);
    if (connection) connection.close();
    throw error;
  }
}

async function getActiveUsers() {
  let connection = null;
  try {
    connection = await connect();

    return new Promise((resolve, reject) => {
      connection.get("/ppp/active/print", (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data || []);
        }
        connection.close();
      });

      setTimeout(() => {
        connection.close();
        reject(new Error("MikroTik command timeout"));
      }, 15000);
    });
  } catch (error) {
    console.error("Error in getActiveUsers:", error);
    if (connection) connection.close();
    throw error;
  }
}

async function testConnection() {
  let connection = null;
  try {
    connection = await connect();

    return new Promise((resolve, reject) => {
      connection.get("/system/identity/print", (err, data) => {
        if (err) {
          reject(err);
        } else {
          console.log("MikroTik identity:", data);
          resolve(data);
        }
        connection.close();
      });

      setTimeout(() => {
        connection.close();
        reject(new Error("Connection test timeout"));
      }, 10000);
    });
  } catch (error) {
    if (connection) connection.close();
    throw error;
  }
}

module.exports = {
  testConnection,
  getPPPoEUsers,
  getActiveUsers,
};
