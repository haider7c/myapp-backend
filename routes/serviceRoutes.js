const express = require("express");
const router = express.Router();

const Service = require("../models/Service");
const auth = require("../middleware/auth");
const { isOwner } = require("../middleware/roles");

/**
 * CREATE SERVICE (OWNER)
 */
router.post("/", auth, isOwner, async (req, res) => {
  try {
    if (!req.body.name) {
      return res.status(400).json({ message: "Service name required" });
    }

    const service = await Service.create({
      name: req.body.name,
      ownerId: req.user.id,
    });

    res.json(service);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET SERVICES (DROPDOWN)
 */
router.get("/", auth, async (req, res) => {
  try {
    const ownerId =
      req.user.role === "owner" ? req.user.id : req.user.ownerId;

    const services = await Service.find({
      ownerId,
      isActive: true,
    }).sort({ name: 1 });

    res.json(services);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
