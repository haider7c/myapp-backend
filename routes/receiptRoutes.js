// backend/routes/receiptRoutes.js
const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const tempDir = path.join(__dirname, "../temp");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const logoPath = path.join(__dirname, "../assets/logo.png");

// A7 / Thermal compatible size
const WIDTH = 2.9 * 72;
const HEIGHT = 5.2 * 72;

router.post("/generate-receipt", async (req, res) => {
  try {
    const {
      customerId,
      customerName,
      phone,
      packageName,
      amount,
      paymentMethod,
      billDate,
      receivingDate,
      paymentNote,
      collectedBy = "Admin",
      companyName = "INTERNETWORKS",
      companyPhone = "0304-1275276",
      additionalConnections,
    } = req.body;

    // Multi-connection customers (e.g. home + office): `amount` is always
    // the combined total across every connection ID (see models/Customer.js),
    // so this one receipt covers all of them. When there's more than one,
    // list a line per ID instead of just the flat total.
    const extraConnections = Array.isArray(additionalConnections) ? additionalConnections : [];
    const hasMultipleConnections = extraConnections.length > 0;
    const extraTotal = extraConnections.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    const primaryAmount = Math.max((Number(amount) || 0) - extraTotal, 0);

    const billNo = Date.now().toString().slice(-12);
    const fileName = `receipt_${billNo}.pdf`;
    const filePath = path.join(tempDir, fileName);

    // Grow the page to fit each extra connection line -- HEIGHT is the
    // normal single-connection print size, only expanded when needed.
    const pageHeight = HEIGHT + (hasMultipleConnections ? extraConnections.length * 12 : 0);

    const doc = new PDFDocument({
      size: [WIDTH, pageHeight],
      margins: { top: 12, left: 14, right: 14, bottom: 10 },
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // =======================
    // LOGO
    // =======================
    // if (fs.existsSync(logoPath)) {
    //   doc.image(logoPath, WIDTH / 2 - 20, 12, { width: 40 });
    //   doc.moveDown(2.2);
    // }

    // =======================
    // HEADER
    // =======================
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .text(companyName, { align: "center" });

    doc.fontSize(8).font("Helvetica").text(companyPhone, { align: "center" });

    // Divider
    doc
      .moveDown(0.4)
      .rect(14, doc.y, WIDTH - 28, 1)
      .fill("#ff6600")
      .moveDown(0.6);
    doc.fillColor("black");

    const row = (label, value, color = "black") => {
      const y = doc.y;
      doc
        .font("Helvetica-Bold")
        .fillColor("black")
        .text(label + " :", 14, y);
      doc
        .font("Helvetica")
        .fillColor(color)
        .text(value || "-", 85, y);
      doc.moveDown(0.35);
    };

    // =======================
    // INFO
    // =======================
    row("Bill No", billNo);
    row("Name", customerName);
    row("User ID", customerId || customerName?.replace(/\s/g, ""));
    row("Mobile", phone);
    row("Due Date", billDate);
    row("Package", packageName);

    if (hasMultipleConnections) {
      row(String(customerId || "Connection 1"), `Rs.${primaryAmount}`);
      extraConnections.forEach((c) => {
        row(`${c.customerId}${c.label ? ` (${c.label})` : ""}`, `Rs.${Number(c.amount) || 0}`);
      });
      row("Total Fee", amount);
    } else {
      row("Fee", amount);
    }
    row("Prev Balance", "0");

    // =======================
    // TOTAL
    // =======================
    doc.moveDown(0.3);
    doc
      .fillColor("#2b7cd3")
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(`Total Bill : ${amount}`, { align: "center" });

    // =======================
    // PAID BOX
    // =======================
    doc.moveDown(0.4);
    const boxW = WIDTH - 60;
    const boxX = (WIDTH - boxW) / 2;
    const boxY = doc.y;

    doc.roundedRect(boxX, boxY, boxW, 24, 6).stroke("#4CAF50");

    doc
      .fillColor("#4CAF50")
      .fontSize(13)
      .font("Helvetica-Bold")
      .text(`PAID : ${amount}`, boxX, boxY + 6, {
        width: boxW,
        align: "center",
      });

    doc.moveDown(1.8);

    // =======================
    // PAYMENT DETAILS
    // =======================
    doc.fontSize(8).fillColor("black");

    row("Remaining", "0");
    row("Paid Via", paymentMethod, "#0a8f3c");
    row("Collected", collectedBy, "#8e44ad");
    row("Date", receivingDate);
    row("Time", new Date().toLocaleTimeString());

    if (paymentNote) row("Note", paymentNote, "#16a085");

    // =======================
    // URDU THANK YOU
    // =======================
    doc.moveDown(0.3);
    doc
      .fontSize(8)
      .fillColor("#0a8f3c")
      .text("شکریہ — آپ کی ادائیگی موصول ہو گئی", { align: "center" });

    // =======================
    // QR CODE (VERIFY)
    // =======================
    const qrText = `Bill:${billNo} | ${customerName} | Paid:${amount}`;
    const qr = await QRCode.toDataURL(qrText);

    const qrImg = qr.replace(/^data:image\/png;base64,/, "");
    const qrBuffer = Buffer.from(qrImg, "base64");

    doc.image(qrBuffer, WIDTH / 2 - 18, doc.y + 5, { width: 36 });

    doc.moveDown(2.5);

    // =======================
    // PAID STAMP
    // =======================
    const cx = WIDTH / 2;
    const cy = doc.y + 5;

    doc.circle(cx, cy, 11).stroke("#4CAF50");
    doc
      .fillColor("#4CAF50")
      .fontSize(7)
      .font("Helvetica-Bold")
      .text("PAID", cx - 9, cy - 3);

    doc.moveDown(2);

    // =======================
    // FOOTER
    // =======================
    doc
      .fontSize(6)
      .fillColor("#777")
      .text("Computer generated receipt — No signature required", {
        align: "center",
      });

    doc.end();

    stream.on("finish", () => {
      res.json({ success: true, filePath, fileName });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
