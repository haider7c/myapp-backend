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

// A7 exact size (same as your React-PDF design)
const A7_WIDTH = 2.9 * 72;   // ≈ 209 pts
const A7_HEIGHT = 3.7 * 72;  // ≈ 266 pts

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
      margins: { top: 20, left: 18, right: 18, bottom: 20 }
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // ==============================
    // HEADER (CENTERED)
    // ==============================
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .text("Billing Receipt", { align: "center" })
      .moveDown(1);

    // ==============================
    // BODY (LEFT ALIGNED - SAME AS IMAGE)
    // ==============================
    doc.font("Helvetica").fontSize(12);

    const addLine = (label, value) => {
      doc.text(`${label} ${value}`).moveDown(0.35);
    };

    // Mask CNIC except last digit (same behavior as your React-PDF)
    const maskCNIC = (cnicValue) => {
      if (!cnicValue) return "N/A";
      const digits = cnicValue.replace(/\D/g, "");
      if (digits.length === 0) return "N/A";
      return digits.slice(0, -1).replace(/\d/g, "#") + digits.slice(-1);
    };

    addLine("Name", customerName);
    addLine("Phone", phone);
    addLine("CNIC", maskCNIC(cnic));
    addLine("Package", packageName);
    addLine("Amount", `Rs. ${amount}`);
    addLine("Status", billStatus ? "Paid" : "Unpaid");
    addLine("Method", paymentMethod || "N/A");

    if (paymentNote) addLine("Note", paymentNote);

    addLine("Bill Date", billDate);
    addLine("Receiving Date", receivingDate);

    // ==============================
    // FOOTER (CENTERED)
    // ==============================
    doc.moveDown(1.2);
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .text("Ali Haider's Creation", { align: "center" });

    doc
      .font("Helvetica")
      .fontSize(10)
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
