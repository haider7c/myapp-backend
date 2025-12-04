// backend/routes/additionalChargeRoutes.js
const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const AdditionalCharge = require("../models/AdditionalCharge");

const createWhatsAppService = require("../services/whatsappService");
const whatsappServicePromise = createWhatsAppService();

// Create /temp folder if missing
const tempDir = path.join(__dirname, "../temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// A7 exact size for invoice
const A7_WIDTH = 2.9 * 72; // 209 pts
const A7_HEIGHT = 3.7 * 72; // 266 pts

// ----------------------------
// POST /api/charges/add
// Save an additional charge record (no PDF sending)
// ----------------------------
router.post("/add", async (req, res) => {
  try {
    const {
      customerObjectId, // prefer actual MongoDB _id
      charges,
      total,
      includeInNextBill = false,
      month = null,
      year = null,
    } = req.body;

    if (!customerObjectId) {
      return res.status(400).json({ success: false, error: "customerObjectId is required" });
    }

    const saved = await AdditionalCharge.create({
      customerId: customerObjectId,
      charges: charges || [],
      totalAmount: total || 0,
      includeInNextBill,
      month,
      year,
    });

    return res.json({ success: true, message: "Additional charge saved", data: saved });
  } catch (err) {
    console.error("ADD CHARGE ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});
// GET /api/charges/all
router.get("/all", async (req, res) => {
  try {
    const records = await AdditionalCharge.find().sort({ createdAt: -1 });
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
  
// PUT /api/charges/customer/:customerId
router.put("/customer/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;
    const { charges, includeInNextBill, month, year } = req.body;

    const updated = await AdditionalCharge.findOneAndUpdate(
      { customerId },
      {
        charges,
        totalAmount: charges?.reduce((sum, c) => sum + (c.amount || 0), 0) || 0,
        includeInNextBill,
        month,
        year
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, error: "Record not found" });
    }

    res.json({ success: true, message: "Updated successfully", data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// POST /api/charges/customer/:customerId/add-charge
router.post("/customer/:customerId/add-charge", async (req, res) => {
  try {
    const { customerId } = req.params;
    const { title, amount } = req.body;

    const updated = await AdditionalCharge.findOneAndUpdate(
      { customerId },
      {
        $push: { charges: { title, amount } }
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, error: "Record not found" });
    }

    res.json({ success: true, message: "Charge added", data: updated });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/charges/customer/:customerId/charge/:chargeId
router.delete("/customer/:customerId/charge/:chargeId", async (req, res) => {
  try {
    const { customerId, chargeId } = req.params;

    const updated = await AdditionalCharge.findOneAndUpdate(
      { customerId },
      { $pull: { charges: { _id: chargeId } } },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, error: "Charge not found" });
    }

    // recalc total
    updated.totalAmount = updated.charges.reduce(
      (sum, c) => sum + (c.amount || 0),
      0
    );
    await updated.save();

    res.json({ success: true, message: "Charge deleted", data: updated });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// DELETE /api/charges/customer/:customerId
router.delete("/customer/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;

    const deleted = await AdditionalCharge.findOneAndDelete({ customerId });

    if (!deleted) {
      return res.status(404).json({ success: false, error: "Record not found" });
    }

    res.json({ success: true, message: "Record deleted", data: deleted });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ----------------------------
// POST /api/charges/generate-pdf
// Save record, create PDF, send via WhatsApp
// ----------------------------
router.post("/generate-pdf", async (req, res) => {
  try {
    const service = await whatsappServicePromise;

    const {
      customerName,
      customerId,
      customerUid,
      customerObjectId,
      phone,
      charges = [],
      total = 0,
    } = req.body;

    if (!customerObjectId && !customerId) {
      return res.status(400).json({ success: false, error: "customerObjectId or customerId required" });
    }

    if (!phone) {
      return res.status(400).json({ success: false, error: "phone is required for WhatsApp sending" });
    }

    // 1) Save record in DB (so both buttons persist)
    const saved = await AdditionalCharge.create({
      customerId: customerObjectId || null,
      charges,
      totalAmount: total,
      includeInNextBill: false,
    });

    // 2) Build PDF
    const fileName = `additional_charges_${Date.now()}.pdf`;
    const filePath = path.join(tempDir, fileName);

    const doc = new PDFDocument({
      size: [A7_WIDTH, A7_HEIGHT],
      margins: { top: 10, left: 14, right: 14, bottom: 10 },
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Header
    doc.font("Helvetica-Bold").fontSize(14).text("Additional Charges", { align: "center" }).moveDown(0.7);
    doc.fontSize(10).font("Helvetica");

    // Helper for rows
    const addRow = (label, value) => {
      const y = doc.y;
      doc.text(label, 14, y, { width: 80 });
      doc.text(value, 0, y, { width: A7_WIDTH - 28, align: "right" });
      doc.moveDown(0.45);
    };

    // Customer Info
    addRow("Customer", customerName || "N/A");
    addRow("ID", customerUid || customerId || "N/A");
    addRow("Phone", phone || "N/A");

    // Charges header with left padding and bottom padding
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(11).text("Charges:", 22, doc.y, { underline: true });
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(10);

    // Charges list
    (charges || []).forEach((c) => {
      const title = c.title || "Item";
      const amount = (c.amount || 0);
      addRow(title, `Rs. ${amount}`);
    });

    doc.moveDown(0.6);
    addRow("Total", `Rs. ${total}`);

    // Footer
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(9).text("Ali Haider's Creation", { align: "center" });
    doc.font("Helvetica").fontSize(9).text("0304-1275276", { align: "center" });

    doc.end();

    // 3) When PDF finished, send it via WhatsApp using service.sendDocument
    stream.on("finish", async () => {
      try {
        // service.sendDocument expects normalized phone and filesystem-accessible path
        await service.sendDocument(phone, filePath, fileName);

        // respond with DB record + file info
        return res.json({
          success: true,
          message: "PDF generated, saved in DB & sent via WhatsApp",
          dbRecord: saved,
          filePath,
          fileName,
        });
      } catch (err) {
        console.error("WHATSAPP SEND ERROR:", err);
        return res.status(500).json({
          success: false,
          error: "PDF created but failed to send via WhatsApp: " + err.message,
          dbRecord: saved,
          filePath,
          fileName,
        });
      }
    });

    stream.on("error", (err) => {
      console.error("PDF STREAM ERROR:", err);
      return res.status(500).json({ success: false, error: err.message });
    });

  } catch (err) {
    console.error("GENERATE-PDF ROUTE ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
