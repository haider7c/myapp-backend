const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const AdditionalCharge = require("../models/AdditionalCharge");
const axios = require("axios");

const WHATSAPP_API = "https://myapp-backend-nrka.onrender.com/api/whatsapp/send-document";

// =============================
// GENERATE PDF + SAVE + SEND
// =============================
router.post("/generate-pdf", async (req, res) => {
  try {
    const { customerName, customerId, charges, total } = req.body;

    if (!customerName || !customerId || !charges || charges.length === 0) {
      return res.status(400).json({ success: false, error: "Invalid data" });
    }

    // 1) SAVE RECORD IN DATABASE
    const record = await AdditionalCharge.create({
      customerId: req.body.customerObjectId, // optional
      customerName,
      customerUid: customerId,
      charges,
      total,
    });

    // 2) GENERATE PDF
    const pdfName = `Charge-${customerId}-${Date.now()}.pdf`;
    const pdfPath = path.join(__dirname, "../temp", pdfName);

    const doc = new PDFDocument();
    doc.pipe(fs.createWriteStream(pdfPath));

    doc.fontSize(20).text("Additional Charges Receipt", { align: "center" });
    doc.moveDown();
    doc.fontSize(14).text(`Customer: ${customerName}`);
    doc.text(`ID: ${customerId}`);
    doc.text(`Date: ${new Date().toLocaleDateString()}`);
    doc.moveDown();

    doc.fontSize(16).text("Charges:");
    charges.forEach((c) => {
      doc.text(`• ${c.title} — Rs. ${c.amount}`);
    });

    doc.moveDown();
    doc.fontSize(18).text(`Total: Rs. ${total}`);

    doc.end();

    // Save PDF path in DB
    record.pdfPath = pdfPath;
    record.pdfName = pdfName;
    await record.save();

    // 3) SEND DOCUMENT TO CUSTOMER
    const formattedPhone = "92" + req.body.phone?.slice(1); // if needed

    await axios.post(WHATSAPP_API, {
      phone: formattedPhone,
      filePath: pdfPath,
      fileName: pdfName,
    });

    res.json({
      success: true,
      message: "PDF created & sent via WhatsApp",
      recordId: record._id,
      fileName: pdfName,
      filePath: pdfPath,
    });

  } catch (err) {
    console.error("PDF Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
