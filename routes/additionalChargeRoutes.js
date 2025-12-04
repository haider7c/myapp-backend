const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const AdditionalCharge = require("../models/AdditionalCharge");
const Customer = require("../models/Customer");

const createWhatsAppService = require("../services/whatsappService");

// Shared WhatsApp instance
const whatsappServicePromise = createWhatsAppService();

// Create temp folder if missing
const tempDir = path.join(__dirname, "../temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/*
|--------------------------------------------------------------------------
| 1️⃣ SAVE Additional Charges
|--------------------------------------------------------------------------
*/
router.post("/add", async (req, res) => {
  try {
    const {
      customerObjectId,
      customerId,
      customerName,
      phone,
      charges,
      total,
      includeInNextBill,
    } = req.body;

    const charge = await AdditionalCharge.create({
      customerId: customerObjectId,
      charges,
      totalAmount: total,
      includeInNextBill,
    });

    res.json({
      success: true,
      message: "Additional charge saved",
      charge,
    });
  } catch (err) {
    console.error("ADD ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/*
|--------------------------------------------------------------------------
| 2️⃣ Generate PDF + Send via WhatsApp
|--------------------------------------------------------------------------
*/
router.post("/generate-pdf", async (req, res) => {
  try {
    const service = await whatsappServicePromise;

    const {
      customerId,
      customerName,
      customerUid,
      phone,
      charges,
      total,
    } = req.body;

    if (!phone) throw new Error("Customer phone not provided");

    // -------------------------------
    // Create PDF file
    // -------------------------------
    const fileName = `additional_charge_${Date.now()}.pdf`;
    const filePath = path.join(tempDir, fileName);

    const doc = new PDFDocument({ margin: 40 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(18).text("Additional Charges Invoice", { align: "center" });
    doc.moveDown();

    doc.fontSize(12).text(`Customer: ${customerName}`);
    doc.text(`Customer ID: ${customerUid}`);
    doc.text(`Phone: ${phone}`);
    doc.moveDown();

    doc.text("Charges:");
    doc.moveDown(0.3);

    charges.forEach((item) => {
      doc.text(`• ${item.title}: Rs ${item.amount}`);
    });

    doc.moveDown();
    doc.text(`Total Additional Charges: Rs ${total}`, { bold: true });

    doc.end();

    // When PDF is finished writing
    stream.on("finish", async () => {
      try {
        // -------------------------------
        // Send PDF to WhatsApp
        // -------------------------------
        await service.sendDocument(phone, filePath, fileName);

        res.json({
          success: true,
          message: "PDF generated and sent successfully",
          filePath,
          fileName,
        });
      } catch (err) {
        console.error("WhatsApp Send Error:", err.message);
        res.status(500).json({
          success: false,
          error: "PDF generated but failed to send via WhatsApp",
        });
      }
    });

    stream.on("error", (err) => {
      res.status(500).json({ success: false, error: err.message });
    });

  } catch (err) {
    console.error("PDF ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
