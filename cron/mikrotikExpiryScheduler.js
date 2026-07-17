const cron = require("node-cron");
const Customer = require("../models/Customer");
const {
  disablePPPoEUserByUsername,
  disconnectUser,
  getUserStatusByUsername,
} = require("../services/mikrotikService");

const TIMEZONE = "Asia/Karachi";
const DISABLE_CRON = "0 12 * * *";
const DISCONNECT_CRON = "10 12 * * *";
const RECOVERY_CRON = "*/5 * * * *";

let lastDisableRunKey = null;
let lastDisconnectRunKey = null;

function getKarachiNow() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type)?.value || "00";

  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    second: Number(value("second")),
  };
}

function getDayKey(now = getKarachiNow()) {
  return `${now.year}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")}`;
}

function getBillDay(customer) {
  const rawValue = customer?.billReceiveDate;

  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return null;
  }

  if (typeof rawValue === "number") {
    return rawValue >= 1 && rawValue <= 31 ? rawValue : null;
  }

  const parsed = parseInt(String(rawValue), 10);
  return parsed >= 1 && parsed <= 31 ? parsed : null;
}

async function getDueCustomersForToday() {
  const now = getKarachiNow();
  const customers = await Customer.find({
    status: "active",
    customerId: { $exists: true, $ne: null },
  }).lean();

  return customers.filter((customer) => getBillDay(customer) === now.day);
}

async function disableDueUsers(source = "schedule") {
  const now = getKarachiNow();
  const dayKey = getDayKey(now);

  if (lastDisableRunKey === dayKey) {
    return { skipped: true, message: "Disable pass already completed today." };
  }

  const dueCustomers = await getDueCustomersForToday();
  const summary = {
    source,
    dayKey,
    totalDue: dueCustomers.length,
    disabled: 0,
    alreadyDisabled: 0,
    missingOnMikroTik: 0,
    failed: 0,
  };

  for (const customer of dueCustomers) {
    const username = customer.customerId?.trim();
    if (!username) {
      summary.missingOnMikroTik += 1;
      continue;
    }

    try {
      const result = await disablePPPoEUserByUsername(username);

      if (result.success && result.alreadyApplied) {
        summary.alreadyDisabled += 1;
      } else if (result.success) {
        summary.disabled += 1;
      } else {
        summary.missingOnMikroTik += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.error(`[ExpiryScheduler] Disable failed for ${username}:`, error.message);
    }
  }

  lastDisableRunKey = dayKey;
  console.log("[ExpiryScheduler] Disable summary:", summary);
  return summary;
}

async function disconnectDueUsers(source = "schedule") {
  const now = getKarachiNow();
  const dayKey = getDayKey(now);

  if (lastDisconnectRunKey === dayKey) {
    return { skipped: true, message: "Disconnect pass already completed today." };
  }

  const dueCustomers = await getDueCustomersForToday();
  const summary = {
    source,
    dayKey,
    totalDue: dueCustomers.length,
    disconnected: 0,
    alreadyOffline: 0,
    notDisabled: 0,
    missingOnMikroTik: 0,
    failed: 0,
  };

  for (const customer of dueCustomers) {
    const username = customer.customerId?.trim();
    if (!username) {
      summary.missingOnMikroTik += 1;
      continue;
    }

    try {
      const status = await getUserStatusByUsername(username);

      if (!status.exists) {
        summary.missingOnMikroTik += 1;
        continue;
      }

      if (!status.disabled) {
        summary.notDisabled += 1;
        continue;
      }

      if (!status.online) {
        summary.alreadyOffline += 1;
        continue;
      }

      const result = await disconnectUser(username);
      if (result.success) {
        summary.disconnected += 1;
      } else {
        summary.alreadyOffline += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.error(`[ExpiryScheduler] Disconnect failed for ${username}:`, error.message);
    }
  }

  lastDisconnectRunKey = dayKey;
  console.log("[ExpiryScheduler] Disconnect summary:", summary);
  return summary;
}

async function reconcileExpiryAutomation() {
  const now = getKarachiNow();

  if (now.hour < 12) {
    return;
  }

  const dayKey = getDayKey(now);

  if (lastDisableRunKey !== dayKey) {
    await disableDueUsers("recovery");
  }

  const shouldDisconnect = now.hour > 12 || (now.hour === 12 && now.minute >= 10);
  if (shouldDisconnect && lastDisconnectRunKey !== dayKey) {
    await disconnectDueUsers("recovery");
  }
}

cron.schedule(
  DISABLE_CRON,
  () => {
    void disableDueUsers("schedule");
  },
  { timezone: TIMEZONE },
);

cron.schedule(
  DISCONNECT_CRON,
  () => {
    void disconnectDueUsers("schedule");
  },
  { timezone: TIMEZONE },
);

cron.schedule(
  RECOVERY_CRON,
  () => {
    void reconcileExpiryAutomation();
  },
  { timezone: TIMEZONE },
);

setTimeout(() => {
  void reconcileExpiryAutomation();
}, 5000);

module.exports = {
  disableDueUsers,
  disconnectDueUsers,
  reconcileExpiryAutomation,
};
