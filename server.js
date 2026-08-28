// backend/server.js
const express = require("express");
const cors = require("cors");

require("dotenv").config();

const connectDB = require("./config/db");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================
// ROUTES
// =====================
app.use("/api/whatsapp", require("./routes/whatsappRoutes"));
app.use("/api/reminders", require("./routes/reminderRoutes"));
app.use("/api/customers", require("./routes/customerRoutes"));
app.use("/api/billstatuses", require("./routes/billStatusRoutes"));
app.use("/api/packages", require("./routes/packageRoutes"));
app.use("/api/bills", require("./routes/billRoutes"));
app.use("/api/counters", require("./routes/counterRoutes"));
app.use("/api/receipt", require("./routes/receiptRoutes"));
app.use("/api/charges", require("./routes/additionalChargeRoutes"));
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/services", require("./routes/serviceRoutes"));
app.use("/api/areas", require("./routes/areaRoutes"));
app.use("/api/employees", require("./routes/employeeRoutes"));
app.use("/api/mikrotik", require("./routes/mikrotikRoutes"));
app.use("/api/activitylog", require("./routes/activityLogRoutes"));

// Billing & Customer Management module (invoices/payments/notes) -- new
// system layered alongside the existing /api/billstatuses routes, which are
// left completely untouched so nothing currently deployed breaks. See
// backend/scripts/migrateBillStatusToInvoices.js for the one-time backfill.
app.use("/api/invoices", require("./routes/invoiceRoutes"));
app.use("/api/payments", require("./routes/paymentRoutes"));
app.use("/api/customer-notes", require("./routes/customerNoteRoutes"));

// Reminder Messages & Receipt Management module -- admin-editable WhatsApp
// message templates (see services/expiryChecker.js for how the "official"
// send functions now read from these) and the receipt/company settings
// already mounted below at /api/settings. Backfill:
// backend/scripts/migrateReminderTemplates.js
app.use("/api/reminder-templates", require("./routes/reminderTemplateRoutes"));

// Ported from the desktop billing app so both the mobile app and the
// desktop app read/write the same invoice/inventory/receipt-branding data.
app.use("/api/inventory", require("./routes/inventoryRoutes"));
app.use("/api/settings", require("./routes/settingsRoutes"));
app.use("/api/manualbills", require("./routes/manualBillRoutes"));

// Promise to Pay -- log "I'll pay in N days" / "on the 1st" type promises
// from unpaid customers and resurface them as reminders (overdue/due
// today/upcoming) on both apps until resolved.
app.use("/api/promises", require("./routes/paymentPromiseRoutes"));

// -----------------------------------------------------------------------
// Serve the PWA build (run `npm run build:web` in the project root, which
// runs `expo export -p web` into ../dist) so opening THIS server's own URL
// in any browser -- desktop or mobile -- shows the installable app. No
// separate hosting, no EAS build, no app store. Purely additive: if dist/
// hasn't been built yet, this block is skipped entirely and the API-only
// behavior below is exactly what it was before.
const path = require("path");
const fs = require("fs");
const webBuildPath = path.join(__dirname, "..", "dist");
if (fs.existsSync(webBuildPath)) {
  app.use(express.static(webBuildPath));
  // expo-router's static web export can lay routes out as either
  // "<route>.html" or "<route>/index.html" depending on version/settings --
  // try both, then fall back to the root index.html so client-side routing
  // can take over for any route express.static didn't already resolve.
  app.get(/^\/(?!api\/)(?!health$).*/, (req, res, next) => {
    const reqPath = req.path === "/" ? "/index" : req.path;
    const candidates = [
      path.join(webBuildPath, `${reqPath}.html`),
      path.join(webBuildPath, reqPath, "index.html"),
      path.join(webBuildPath, "index.html"),
    ];
    const found = candidates.find((c) => fs.existsSync(c));
    if (found) return res.sendFile(found);
    next();
  });
  console.log(`\ud83d\udda5\ufe0f  Serving PWA build from ${webBuildPath}`);
} else {
  console.log("\u2139\ufe0f  No web build at ../dist -- run `npm run build:web` in the project root to serve the PWA from this server.");
}

app.get("/health", (req, res) => res.status(200).send("OK"));

// Default route
app.get("/", (req, res) => res.json({ message: "API OK" }));

// =====================
// START SERVER
// =====================
// Everything below needs a live MongoDB connection — especially the cron
// jobs, which run their first pass just 5 seconds after boot. The previous
// version called mongoose.connect() without awaiting it, then immediately
// required the cron schedulers and started listening — so requests and
// background jobs could run before the connection was actually ready.
// Mongoose's default query buffering papers over *short* gaps, but a slow
// Atlas connection blows past its 10s buffer timeout, throwing "Operation
// X buffering timed out" — which is exactly what was silently swallowing
// the MikroTik expiry scheduler's SchedulerState writes (caught by that
// function's own try/catch, so it looked like it succeeded even though
// nothing was ever actually saved to the database).
async function startServer() {
  if (!process.env.MONGODB_URI) {
    console.error("❌ Missing MONGODB_URI. Refusing to start without a database connection.");
    process.exit(1);
  }

  await connectDB();

  // Load schedulers only after MongoDB is ready so background jobs never
  // run a query against a not-yet-connected instance.
  require("./cron/reminderScheduler");

  // Automatic MikroTik expiry enable/disable is intentionally NOT loaded
  // anymore -- the owner wants to enable/disable each customer's internet
  // manually instead of it happening automatically at noon based on
  // billReceiveDate. The underlying router logic (services/mikrotikService.js)
  // and its manual routes (routes/mikrotikRoutes.js, mounted at /api/mikrotik
  // above) are untouched and still fully working -- only the automatic daily
  // cron trigger (cron/mikrotikExpiryScheduler.js) is disabled. That file is
  // left in place, unused, in case automatic scheduling is ever wanted again.

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
}

startServer().catch((error) => {
  console.error("❌ Startup failed:", error);
  process.exit(1);
});
