const MikroNode = require("mikronode-ng");

const host = process.env.MT_HOST;
const port = process.env.MT_PORT || 2222;
const user = process.env.MT_USER;
const pass = process.env.MT_PASS;

async function connect() {
  const device = new MikroNode(host, port);
  const connection = await device.connect(user, pass);
  return connection;
}

async function getPPPoEUsers() {
  const conn = await connect();
  const chan = await conn.openChannel();

  const users = [];

  chan.write("/ppp/secret/print");

  chan.on("data", (data) => {
    users.push(data);
  });

  return new Promise((resolve) => {
    chan.on("done", () => {
      conn.close();
      resolve(users);
    });
  });
}

async function getActiveUsers() {
  const conn = await connect();
  const chan = await conn.openChannel();

  const users = [];

  chan.write("/ppp/active/print");

  chan.on("data", (data) => {
    users.push(data);
  });

  return new Promise((resolve) => {
    chan.on("done", () => {
      conn.close();
      resolve(users);
    });
  });
}

module.exports = {
  getPPPoEUsers,
  getActiveUsers,
};
