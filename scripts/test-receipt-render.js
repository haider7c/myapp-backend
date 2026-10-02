/**
 * Manual visual-verification tool for the new WhatsApp bill/receipt image
 * feature -- renders sample PNGs for a real customer using real data
 * (previous dues, package speed, etc.) WITHOUT sending anything over
 * WhatsApp, so it's safe to run against production data at any time.
 *
 * Usage (run from the backend/ folder):
 *   node scripts/test-receipt-render.js <customerId-or-mongo-_id>
 *
 * Writes 4 PNGs into backend/temp/ (one per brand x bill/receipt) and
 * prints their paths -- download/open them to confirm the layout, your
 * own office contact info, and this customer's real previous-dues number
 * all look right before relying on the real "Send Reminder"/"Send
 * Receipt" buttons in the app.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");

const Customer = require("../models/Customer");
const BillStatus = require("../models/BillStatus");
const { buildBillImageData, buildReceiptImageData } = require("../services/receiptDataBuilder");
const { renderReceiptImage } = require("../services/receiptImageService");

async function main() {
  const lookup = process.argv[2];
  if (!lookup) {
    console.error("Usage: node scripts/test-receipt-render.js <customerId-or-mongo-_id>");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.\n");

  const customer = mongoose.isValidObjectId(lookup)
    ? await Customer.findById(lookup)
    : await Customer.findOne({ customerId: new RegExp(`^${lookup}$`, "i") });

  if (!customer) {
    console.error(`No customer found matching "${lookup}".`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Found: ${customer.customerName} (${customer.customerId})\n`);

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const billStatus = await BillStatus.findOne({
    customerId: customer._id,
    ownerId: customer.ownerId,
    month,
    year,
  });

  const brands = ["stormfiber", "nationalbroadband"];
  for (const brand of brands) {
    const billData = await buildBillImageData({ customer, ownerId: customer.ownerId, month, year });
    const bill = await renderReceiptImage({ brand, kind: "bill", data: billData });
    console.log(`[${brand}] bill   -> ${path.resolve(bill.filePath)}`);

    if (billStatus?.billStatus === true) {
      const receiptData = await buildReceiptImageData({ customer, ownerId: customer.ownerId, billStatus, month, year });
      const receipt = await renderReceiptImage({ brand, kind: "receipt", data: receiptData });
      console.log(`[${brand}] receipt-> ${path.resolve(receipt.filePath)}`);
    } else {
      console.log(`[${brand}] receipt-> skipped (no PAID bill on record for ${month}/${year})`);
    }
  }

  console.log("\nDone. Nothing was sent over WhatsApp -- these are local files only.");
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("\ntest-receipt-render aborted:", err.message);
  process.exit(1);
});
