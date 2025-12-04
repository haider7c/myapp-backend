const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const createWhatsAppService = require("../services/whatsappService");
const whatsappServicePromise = createWhatsAppService();

// Create /temp folder if missing
const tempDir = path.join(__dirname, "../temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// A7 exact size for invoice
const A7_WIDTH = 2.9 * 72;   // 209 pts
const A7_HEIGHT = 3.7 * 72;  // 266 pts

/*
|--------------------------------------------------------------------------
| 1️⃣ Generate Additional Charges PDF + Send via WhatsApp
|--------------------------------------------------------------------------
*/
router.post("/generate-pdf", async (req, res) => {
  try {
    const service = await whatsappServicePromise;

    const {
      customerName,
      customerId,
      customerUid,
      phone,
      charges,
      total
    } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, error: "Phone missing" });
    }

    // PDF Name & Path
    const fileName = `additional_charges_${Date.now()}.pdf`;
    const filePath = path.join(tempDir, fileName);

    // Create PDF (A7 style like your receipt)
    const doc = new PDFDocument({
      size: [A7_WIDTH, A7_HEIGHT],
      margins: { top: 10, left: 14, right: 14, bottom: 10 }
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // HEADER
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .text("Additional Charges", { align: "center" })
      .moveDown(0.7);

    doc.fontSize(10).font("Helvetica");

    // Helper for two-column layout
    const addRow = (label, value) => {
      const y = doc.y;

      doc.text(label, 14, y, { width: 80 });

      doc.text(value, 0, y, {
        width: A7_WIDTH - 28,
        align: "right"
      });

      doc.moveDown(0.45);
    };

    // BODY
    addRow("Customer", customerName);
    addRow("ID", customerUid || customerId);
    addRow("Phone", phone);

    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").text("Charges:", { underline: true });
    doc.font("Helvetica");

    charges.forEach((c) => {
      addRow(c.title, `Rs. ${c.amount}`);
    });

    doc.moveDown(0.8);
    addRow("Total", `Rs. ${total}`);

    // FOOTER
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

    // SEND PDF via WhatsApp
    stream.on("finish", async () => {
      try {
        await service.sendDocument(phone, filePath, fileName);

        res.json({
          success: true,
          message: "PDF generated & sent successfully",
          filePath,
          fileName
        });
      } catch (err) {
        res.status(500).json({
          success: false,
          error: "PDF created but failed to send via WhatsApp: " + err.message
        });
      }
    });

    stream.on("error", (err) => {
      res.status(500).json({ success: false, error: err.message });
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
