const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');

// Backend update needed:
router.get("/", async (req, res) => {
  try {
    const { date } = req.query;
    let customers;

    if (date) {
      // Convert date to start and end of the day
      const selectedDate = new Date(date);
      const nextDate = new Date(selectedDate);
      nextDate.setDate(selectedDate.getDate() + 1);

      // CHANGE THIS: Filter by billReceiveDate instead of regDate
      customers = await Customer.find({
        billReceiveDate: { $gte: selectedDate, $lt: nextDate },
      });
    } else {
      customers = await Customer.find();
    }

    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get customer by ID
router.get('/:id', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    res.json(customer);
  } catch (err) {
    res.status(404).json({ message: 'Customer not found' });
  }
});
// =============================
// GET ACTIVE CUSTOMERS
// =============================
router.get("/active", async (req, res) => {
  try {
    const customers = await Customer.find({ status: "active" });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// =============================
// GET DISCONTINUED CUSTOMERS
// =============================
router.get("/discontinued", async (req, res) => {
  try {
    const customers = await Customer.find({ status: "discontinued" });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// =============================
// MARK AS DISCONTINUED
// =============================
router.put("/:id/discontinue", async (req, res) => {
  try {
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      { status: "discontinued" },
      { new: true }
    );

    res.json({
      message: "Customer discontinued successfully",
      customer,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// =============================
// REACTIVATE A CUSTOMER
// =============================
router.put("/:id/reactivate", async (req, res) => {
  try {
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      { status: "active" },
      { new: true }
    );

    res.json({
      message: "Customer reactivated successfully",
      customer,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


module.exports = router;
