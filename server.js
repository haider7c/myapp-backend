// backend/server.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================
// DATABASE CONNECT
// =====================
console.log("Mongo URI:", process.env.MONGODB_URI);

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));


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




app.get("/health", (req, res) => res.status(200).send("OK"));

// Default route
app.get("/", (req, res) => res.json({ message: "API OK" }));


// =====================
// CRON JOBS (AUTO REMINDER SYSTEM)
// =====================
require("./cron/reminderScheduler");


// =====================
// START SERVER
// =====================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
