// scripts/createOwnerAccount.js
//
// Manually onboard a new shop-owner client (a new independent tenant on
// this shared backend). Replaces the old public POST /api/auth/register
// route, which was removed -- see routes/authRoutes.js -- so new owner
// accounts are now only ever created this way, by whoever runs this
// script on the server. Every customer/bill/package/etc. this new owner
// creates is automatically scoped to their own ownerId (same as every
// existing tenant), so they can't see or touch anyone else's data, and
// nobody else can see theirs.
//
// Run on the server:
//   cd ~/path-to-backend && node scripts/createOwnerAccount.js "Full Name" "email@example.com" "a-strong-password"
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

async function run() {
  const [, , name, email, password] = process.argv;

  if (!name || !email || !password) {
    console.error('Usage: node scripts/createOwnerAccount.js "Full Name" "email@example.com" "password"');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("Password must be at least 6 characters.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.\n");

  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    console.error(`A user with email "${email}" already exists (role: ${existing.role}). Nothing created.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await User.create({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password: hashedPassword,
    role: "owner",
    ownerId: null,
  });

  console.log(`Created new owner account:`);
  console.log(`  Name:  ${user.name}`);
  console.log(`  Email: ${user.email}`);
  console.log(`  ID:    ${user._id}`);
  console.log(`\nThey can now log in on the desktop or mobile app with this email/password.`);
  console.log(`Their data (customers, bills, WhatsApp session, etc.) starts completely empty and separate from every other owner.`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed to create owner account:", err);
  process.exit(1);
});
