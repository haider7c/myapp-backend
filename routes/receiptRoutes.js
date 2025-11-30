// backend/routes/receiptRoutes.js
const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

// Create /temp folder if missing
const tempDir = path.join(__dirname, "../temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// A7 exact size
const A7_WIDTH = 2.9 * 72;   // 209 pts
const A7_HEIGHT = 3.7 * 72;  // 266 pts

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
      billStatus
    } = req.body;

    const fileName = `receipt_${Date.now()}.pdf`;
    const filePath = path.join(tempDir, fileName);

    const doc = new PDFDocument({
      size: [A7_WIDTH, A7_HEIGHT],
      margins: { top: 10, left: 14, right: 14, bottom: 10 }
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // ==============================
    // HEADER
    // ==============================
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .text("Billing Receipt", { align: "center" })
      .moveDown(0.7);

    // Smaller font for body
    doc.fontSize(10).font("Helvetica");

    // Helper for two-column rows
    const addRow = (label, value) => {
      const y = doc.y;

      doc.text(label, 14, y, { width: 80 });

      doc.text(value, 0, y, {
        width: A7_WIDTH - 28,
        align: "right"
      });

      doc.moveDown(0.45);
    };

    // Mask CNIC (### except last digit)
    const maskCNIC = (cnicVal) => {
      if (!cnicVal) return "N/A";
      const d = cnicVal.replace(/\D/g, "");
      if (d.length === 0) return "N/A";
      return d.slice(0, -1).replace(/\d/g, "#") + d.slice(-1);
    };

    // ==============================
    // BODY CONTENT (Two columns)
    // ==============================
    addRow("Name", customerName);
    addRow("Phone", phone);
    addRow("CNIC", maskCNIC(cnic));
    addRow("Package", packageName);
    addRow("Amount", `Rs. ${amount}`);
    addRow("Status", billStatus ? "Paid" : "Unpaid");
    addRow("Method", paymentMethod || "N/A");

    if (paymentNote) addRow("Note", paymentNote);

    addRow("Bill Date", billDate);
    addRow("Receiving Date", receivingDate);

    // ==============================
    // FOOTER
    // ==============================
    doc.moveDown(1);

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .text("Ali Haider's Creation", { align: "center" });

    doc
      .font("Helvetica")
      .fontSize(9)
      .text("0304-1275276", { align: "center" });

    doc.end();

    stream.on("finish", () => {
      res.json({ success: true, filePath, fileName });
    });

    stream.on("error", (err) => {
      res.status(500).json({ success: false, error: err.message });
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
