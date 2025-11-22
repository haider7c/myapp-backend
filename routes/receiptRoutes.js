const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

router.post("/generate-receipt", async (req, res) => {
  try {
    const {
      customerName,
      phone,
      cnic,
      packageName,
      amount,
      paymentMethod,
      paymentNote,
      billDate,
      receivingDate,
    } = req.body;

    // temp file path
    const fileName = `receipt_${Date.now()}.pdf`;
    const filePath = path.join(__dirname, "../temp", fileName);

    // Create PDF document
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(20).text("Billing Receipt", { align: "center" });
    doc.moveDown();

    doc.fontSize(14).text(`Name: ${customerName}`);
    doc.text(`Phone: ${phone}`);
    doc.text(`CNIC: ${cnic || "N/A"}`);
    doc.text(`Package: ${packageName}`);
    doc.text(`Amount: Rs. ${amount}`);
    doc.text(`Status: Paid`);
    doc.text(`Method: ${paymentMethod}`);
    doc.text(`Note: ${paymentNote || "N/A"}`);
    doc.text(`Bill Date: ${billDate}`);
    doc.text(`Receiving Date: ${receivingDate}`);

    doc.moveDown();
    doc.fontSize(12).text("Ali Haider's Creation", { align: "center" });
    doc.text("0304-1275276", { align: "center" });

    doc.end();

    stream.on("finish", () => {
      res.json({
        success: true,
        filePath,
        fileName,
      });
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
