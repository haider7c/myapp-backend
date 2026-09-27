/**
 * One-off import of the 4 uploaded area CSVs (277JB, 275JB, 276JB, 336JB)
 * into the live Customer/Area/Service collections.
 *
 * Usage (run from the backend/ folder, where .env and node_modules live):
 *   node scripts/import-jb-areas.js --dry-run    # preview only, no writes
 *   node scripts/import-jb-areas.js              # actually create records
 *
 * Safe to re-run: any row whose (ownerId, customerId) already exists in the
 * Customer collection is skipped rather than duplicated.
 *
 * Reads the data from scripts/import-jb-areas-data.json, which sits next to
 * this file (673 rows, already cleaned/normalized -- see the review
 * spreadsheet you were sent for what was excluded/defaulted and why).
 */

require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");

const Customer = require("../models/Customer");
const Area = require("../models/Area");
const Service = require("../models/Service");
const User = require("../models/User");

const DRY_RUN = process.argv.includes("--dry-run");
const DATA_FILE = path.join(__dirname, "import-jb-areas-data.json");
const DEFAULT_SERVICE_NAME = "General";

// Mirrors routes/customerRoutes.js's getOrCreateDefault() exactly, so these
// records land in the same kind of default bucket the app already uses for
// customers created without an explicit Area/Service.
async function getOrCreateDefault(Model, ownerId, name) {
  let doc = await Model.findOne({ ownerId, name });
  if (!doc) {
    doc = await Model.create({ ownerId, name });
    console.log(`  + created ${Model.modelName} "${name}" (${doc._id})`);
  }
  return doc;
}

async function resolveOwnerId() {
  const envOwner = process.env.IMPORT_OWNER_ID;
  if (envOwner) {
    const u = await User.findById(envOwner);
    if (!u) throw new Error(`IMPORT_OWNER_ID=${envOwner} does not match any User`);
    return u;
  }
  const owners = await User.find({ role: "owner" });
  if (owners.length === 0) {
    throw new Error("No User with role 'owner' found -- can't determine ownerId.");
  }
  if (owners.length > 1) {
    const list = owners.map((o) => `  ${o._id}  ${o.name || o.email || ""}`).join("\n");
    throw new Error(
      `Found ${owners.length} owner accounts, can't guess which one:\n${list}\n` +
      `Re-run with IMPORT_OWNER_ID=<id> node scripts/import-jb-areas.js`
    );
  }
  return owners[0];
}

async function main() {
  const data = require(DATA_FILE);
  console.log(`Loaded ${data.length} rows from ${path.basename(DATA_FILE)}`);
  console.log(DRY_RUN ? "*** DRY RUN -- no writes will happen ***\n" : "*** LIVE RUN -- writing to the database ***\n");

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.\n");

  const owner = await resolveOwnerId();
  console.log(`Owner: ${owner._id}  (${owner.name || owner.email || "no name"})\n`);

  const areaCodes = [...new Set(data.map((r) => r.area))];
  const areaIdByCode = {};
  console.log("Areas:");
  for (const code of areaCodes) {
    if (DRY_RUN) {
      const existing = await Area.findOne({ ownerId: owner._id, name: code });
      areaIdByCode[code] = existing ? existing._id : "(would create)";
      console.log(`  ${code} -> ${existing ? existing._id : "NEW"}`);
    } else {
      const area = await getOrCreateDefault(Area, owner._id, code);
      areaIdByCode[code] = area._id;
    }
  }

  let serviceId;
  if (DRY_RUN) {
    const existing = await Service.findOne({ ownerId: owner._id, name: DEFAULT_SERVICE_NAME });
    serviceId = existing ? existing._id : "(would create)";
    console.log(`\nService: ${DEFAULT_SERVICE_NAME} -> ${existing ? existing._id : "NEW"}`);
  } else {
    const service = await getOrCreateDefault(Service, owner._id, DEFAULT_SERVICE_NAME);
    serviceId = service._id;
    console.log(`\nService: ${DEFAULT_SERVICE_NAME} -> ${serviceId}`);
  }

  console.log("\nProcessing customers...\n");
  let created = 0, skipped = 0, failed = 0;
  const failures = [];

  for (const row of data) {
    const existing = await Customer.findOne({ ownerId: owner._id, customerId: row.customerId });
    if (existing) {
      skipped++;
      continue;
    }

    const doc = {
      customerName: row.customerName,
      phone: row.phone,
      billReceiveDate: row.billReceiveDate,
      customerId: row.customerId,
      packageName: row.packageName,
      amount: row.amount,
      address: row.address,
      ownerId: owner._id,
      areaId: DRY_RUN ? undefined : areaIdByCode[row.area],
      serviceId: DRY_RUN ? undefined : serviceId,
      status: row.status,
    };

    if (DRY_RUN) {
      const test = new Customer(doc);
      const err = test.validateSync();
      if (err) {
        failed++;
        failures.push({ customerId: row.customerId, error: err.message });
      } else {
        created++; // "would create"
      }
      continue;
    }

    try {
      await Customer.create(doc);
      created++;
    } catch (err) {
      failed++;
      failures.push({ customerId: row.customerId, error: err.message });
    }
  }

  console.log(`\n${DRY_RUN ? "Would create" : "Created"}: ${created}`);
  console.log(`Skipped (already exist): ${skipped}`);
  console.log(`Failed: ${failed}`);
  if (failures.length) {
    console.log("\nFailures (first 20):");
    for (const f of failures.slice(0, 20)) {
      console.log(`  ${f.customerId}: ${f.error}`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("\nImport aborted:", err.message);
  process.exit(1);
});
