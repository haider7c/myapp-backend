const express = require("express");
const router = express.Router();
const AdditionalCharge = require("../models/AdditionalCharge");

// =============================
// ADD ADDITIONAL CHARGES
// =============================
router.post("/add", async (req, res) => {
  try {
    const charge = await AdditionalCharge.create(req.body);

    res.json({
      success: true,
      message: "Additional charge saved",
      charge,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =============================
// GENERATE PDF FOR ADDITIONAL CHARGES
// =============================
router.post("/generate-pdf", async (req, res) => {
  try {
    const { customerName, customerId, charges, total } = req.body;

    // TODO: build your PDF here using pdfkit or similar

    res.json({
      success: true,
      message: "PDF generated successfully",
      filePath: "/path/to/pdf",
      fileName: "additional-charges.pdf",
    });
  } catch (err) {
    console.error("PDF Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
