const express = require("express");
const router = express.Router();

const Area = require("../models/Area");
const auth = require("../middleware/auth");
const { isOwner } = require("../middleware/roles");

/**
 * CREATE AREA
 */
router.post("/", auth, isOwner, async (req, res) => {
  try {
    if (!req.body.name) {
      return res.status(400).json({ message: "Area name required" });
    }

    const area = await Area.create({
      name: req.body.name,
      ownerId: req.user.id,
    });

    res.json(area);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET AREAS (OWNER)
 */
router.get("/", auth, async (req, res) => {
  try {
    const ownerId =
      req.user.role === "owner" ? req.user.id : req.user.ownerId;

    const areas = await Area.find({ ownerId }).sort({ name: 1 });

    res.json(areas);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
