const express = require('express');
const router = express.Router();
const Bill = require('../models/Bill');
const auth = require('../middleware/auth');

function ownerScope(req) {
  return req.user.role === "owner" ? req.user.id : req.user.ownerId;
}

// Get all bills (scoped to the logged-in owner's tenant)
router.get('/', auth, async (req, res) => {
  try {
    const bills = await Bill.find({ ownerId: ownerScope(req) });
    res.json(bills);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get bill by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const bill = await Bill.findOne({ _id: req.params.id, ownerId: ownerScope(req) });
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    res.json(bill);
  } catch (err) {
    res.status(404).json({ message: 'Bill not found' });
  }
});

module.exports = router;
