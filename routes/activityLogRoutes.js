// routes/activityLogRoutes.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const ActivityLog = require("../models/ActivityLog");

// GET /api/activitylog?page=1&limit=30&type=bill_payment&date=2026-07-25
// Paginated, newest-first, scoped to the logged-in user's own tenant
// (owners see their own tenant's activity; employees see their owner's).
router.get("/", auth, async (req, res) => {
  try {
    const ownerId = req.user.role === "owner" ? req.user.id : req.user.ownerId;

    if (!ownerId) {
      return res.json({ success: true, items: [], total: 0, page: 1, pages: 0 });
    }

    const { type, date, customerId } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 100);

    const query = { ownerId };
    if (type) query.type = type;
    // Optional: scope to one customer's activity -- used by the Customer
    // Management page's per-customer Activity Log tab.
    if (customerId) query.customerId = customerId;

    // date="YYYY-MM-DD" filters that single calendar day; omit for "all
    // previous activity" (still newest-first, paginated).
    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(`${date}T23:59:59.999Z`);
      if (!isNaN(start.getTime())) {
        query.createdAt = { $gte: start, $lte: end };
      }
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      ActivityLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      ActivityLog.countDocuments(query),
    ]);

    res.json({
      success: true,
      items,
      total,
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
