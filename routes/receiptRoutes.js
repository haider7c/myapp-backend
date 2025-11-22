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

    const fileName = `receipt_${Date.now()}.pdf`;
    const filePath = path.join(tempDir, fileName);

    console.log("📝 Creating Styled PDF:", filePath);

    // MATCH Template2 size EXACTLY
    const doc = new PDFDocument({
      size: [420, 595], // Same as Template2 PDF size
      margins: { top: 30, left: 20, right: 20, bottom: 20 }
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // ============================
    // HEADER TITLE
    // ============================
    doc
      .fontSize(22)
      .font("Helvetica-Bold")
      .text("Billing Receipt", { align: "center" })
      .moveDown(1);

    // ============================
    // CENTERED CUSTOMER DETAILS BOX
    // ============================
    doc
      .fontSize(12)
      .font("Helvetica")
      .text(`Name: ${customerName}`, { align: "center" })
      .moveDown(0.3);

    doc.text(`Phone: ${phone}`, { align: "center" }).moveDown(0.3);
    doc.text(`CNIC: ${cnic || "N/A"}`, { align: "center" }).moveDown(0.3);
    doc.text(`Package: ${packageName}`, { align: "center" }).moveDown(0.3);
    doc.text(`Amount: Rs. ${amount}`, { align: "center" }).moveDown(0.3);
    doc.text(`Payment Method: ${paymentMethod}`, { align: "center" }).moveDown(0.3);
    doc.text(`Note: ${paymentNote || "N/A"}`, { align: "center" }).moveDown(0.3);
    doc.text(`Bill Date: ${billDate}`, { align: "center" }).moveDown(0.3);
    doc.text(`Receiving Date: ${receivingDate}`, { align: "center" }).moveDown(1);

    // Divider line
    doc
      .moveDown(1)
      .strokeColor("#000000")
      .lineWidth(1)
      .moveTo(20, doc.y)
      .lineTo(400, doc.y)
      .stroke();

    // FOOTER (Same style as Template2)
    doc
      .moveDown(1.5)
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("Ali Haider's Creation", { align: "center" });

    doc
      .fontSize(10)
      .font("Helvetica")
      .text("0304-1275276", { align: "center" });

    doc
      .fontSize(10)
      .text("Sadhar Bypass Chabba Road, Faisalabad", {
        align: "center",
      });

    doc.end();

    stream.on("finish", () => {
      console.log("✅ Styled PDF Generated Successfully");
      res.json({
        success: true,
        filePath,
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
