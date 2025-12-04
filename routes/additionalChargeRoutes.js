const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const AdditionalCharge = require("../models/AdditionalCharge");

const createWhatsAppService = require("../services/whatsappService");
const whatsappServicePromise = createWhatsAppService();

// TEMP FOLDER
const tempDir = path.join(__dirname, "../temp");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const A7_WIDTH = 2.9 * 72;
const A7_HEIGHT = 3.7 * 72;

// -------------------------------
// SAVE OR UPDATE (MAIN LOGIC)
// -------------------------------
router.post("/save-or-update", async (req, res) => {
  try {
    const { customerObjectId, charges, total, includeInNextBill } = req.body;

    if (!customerObjectId)
      return res.status(400).json({ success: false, error: "customerObjectId required" });

    let record = await AdditionalCharge.findOne({ customerId: customerObjectId });

    if (record) {
      record.charges = charges;
      record.totalAmount = total;
      record.includeInNextBill = includeInNextBill;
      await record.save();

      return res.json({ success: true, updated: true, data: record });
    }

    const created = await AdditionalCharge.create({
      customerId: customerObjectId,
      charges,
      totalAmount: total,
      includeInNextBill
    });

    return res.json({ success: true, created: true, data: created });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------
// GET ALL
// -------------------------------
router.get("/all", async (req, res) => {
  try {
    const records = await AdditionalCharge.find().sort({ createdAt: -1 });
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------
// GET SPECIFIC CUSTOMER
// -------------------------------
router.get("/customer/:customerId", async (req, res) => {
  try {
    const record = await AdditionalCharge.findOne({ customerId: req.params.customerId });
    res.json({ success: true, data: record || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------
// DELETE SINGLE CHARGE
// -------------------------------
router.delete("/customer/:customerId/charge/:chargeId", async (req, res) => {
  try {
    const { customerId, chargeId } = req.params;

    const updated = await AdditionalCharge.findOneAndUpdate(
      { customerId },
      { $pull: { charges: { _id: chargeId } } },
      { new: true }
    );

    if (!updated)
      return res.status(404).json({ success: false, error: "Charge not found" });

    updated.totalAmount = updated.charges.reduce((s, c) => s + (c.amount || 0), 0);
    await updated.save();

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------
// DELETE FULL RECORD
// -------------------------------
router.delete("/customer/:customerId", async (req, res) => {
  try {
    const deleted = await AdditionalCharge.findOneAndDelete({
      customerId: req.params.customerId,
    });

    if (!deleted)
      return res.status(404).json({ success: false, error: "Record not found" });

    res.json({ success: true, data: deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------
// GENERATE PDF — SEND WHATSAPP — UPDATE RECORD (NO DUPLICATE)
// -------------------------------
router.post("/generate-pdf", async (req, res) => {
  try {
    const service = await whatsappServicePromise;

    const { customerName, customerId, customerObjectId, phone, charges, total } = req.body;

    if (!customerObjectId)
      return res.status(400).json({ success: false, error: "customerObjectId required" });

    if (!phone)
      return res.status(400).json({ success: false, error: "phone required" });

    // Update or Create
    let record = await AdditionalCharge.findOne({ customerId: customerObjectId });

    if (record) {
      record.charges = charges;
      record.totalAmount = total;
      record.includeInNextBill = false;
      await record.save();
    } else {
      record = await AdditionalCharge.create({
        customerId: customerObjectId,
        charges,
        totalAmount: total,
        includeInNextBill: false,
      });
    }

    // PDF generation
    const fileName = `additional_${Date.now()}.pdf`;
    const filePath = path.join(tempDir, fileName);

    const doc = new PDFDocument({
      size: [A7_WIDTH, A7_HEIGHT],
      margins: { top: 10, left: 14, right: 14, bottom: 10 },
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.font("Helvetica-Bold").fontSize(14).text("Additional Charges", { align: "center" });
    doc.moveDown(1);

    const addLine = (k, v) => {
      doc.font("Helvetica").fontSize(10);
      doc.text(`${k}: ${v}`);
      doc.moveDown(0.4);
    };

    addLine("Customer", customerName);
    addLine("ID", customerId);
    addLine("Phone", phone);

    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").text("Charges:");
    doc.moveDown(0.5);

    charges.forEach((c) => addLine(c.title, `Rs. ${c.amount}`));

    doc.moveDown(0.5);
    addLine("Total", `Rs. ${total}`);

    doc.end();

    stream.on("finish", async () => {
      await service.sendDocument(phone, filePath, fileName);
      return res.json({ success: true, message: "PDF sent", data: record });
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
