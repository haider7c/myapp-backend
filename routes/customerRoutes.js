const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");

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
      {
        status: "discontinued",
        discontinuedAt: new Date(),
      },
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
      {
        status: "active",
        discontinuedAt: null, // <-- RESET discontinued date/time
      },
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

// =============================
// GET BY BILL DATE OR ALL
// (THIS MUST BE LAST!)
// =============================
router.get("/", async (req, res) => {
  try {
    const { date } = req.query;
    let customers;

    if (date) {
      const selectedDate = new Date(date);
      const nextDate = new Date(selectedDate);
      nextDate.setDate(selectedDate.getDate() + 1);

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

// =============================
// GET ONE CUSTOMER (LAST ROUTE)
// =============================
router.get("/:id", async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    res.json(customer);
  } catch (err) {
    res.status(404).json({ message: "Customer not found" });
  }
});

// =============================
// Create CUSTOMER (SINGLE ADDING ROUTE)
// =============================

router.post("/", async (req, res) => {
  try {
    const customer = await Customer.create(req.body);
    res.json(customer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================
// UPDATE CUSTOMER
// =============================
router.put("/:id", async (req, res) => {
  try {
    const updatedCustomer = await Customer.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!updatedCustomer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json({
      message: "Customer updated successfully",
      customer: updatedCustomer,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================
// DELETE CUSTOMER
// =============================
router.delete("/:id", async (req, res) => {
  try {
    const deletedCustomer = await Customer.findByIdAndDelete(req.params.id);

    if (!deletedCustomer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json({
      message: "Customer deleted successfully",
      customer: deletedCustomer,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});



module.exports = router;
