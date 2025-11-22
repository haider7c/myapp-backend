// backend/routes/receiptRoutes.js
const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

// CREATE temp folder if missing (Fix for Render)
const tempDir = path.join(__dirname, "../temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
  console.log("📁 TEMP folder created:", tempDir);
}

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
    const filePath = path.join(tempDir, fileName);

    console.log("📝 Creating PDF:", filePath);

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
      console.log("✅ PDF Generated Successfully");
      res.json({
        success: true,
        filePath, // Full server path for Baileys
        fileName,
      });
    });

    stream.on("error", (err) => {
      console.error("❌ PDF Write Error:", err);
      res.status(500).json({ success: false, error: err.message });
    });

  } catch (err) {
    console.error("❌ PDF Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
