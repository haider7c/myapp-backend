const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const auth = require("../middleware/auth");


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
// Create CUSTOMER
// =============================
router.post("/", auth, async (req, res) => {
  try {
    console.log("User data from token:", req.user); // Debug log
    
    // Get ownerId based on user role
    let ownerId;
    
    if (req.user.role === "owner") {
      ownerId = req.user.id;
    } else if (req.user.role === "employee" && req.user.ownerId) {
      ownerId = req.user.ownerId;
    } else {
      // Fallback: try to get from body or use user id
      ownerId = req.body.ownerId || req.user.id;
    }
    
    console.log("Extracted ownerId:", ownerId); // Debug log
    
    // Validate required fields
    if (!ownerId) {
      return res.status(400).json({ 
        message: "ownerId is required. Please provide a valid owner." 
      });
    }
    
    // Validate areaId and serviceId
    if (!req.body.areaId) {
      return res.status(400).json({ message: "areaId is required" });
    }
    
    if (!req.body.serviceId) {
      return res.status(400).json({ message: "serviceId is required" });
    }
    
    // Create customer with ownerId
    const customerData = {
      ...req.body,
      ownerId: ownerId, // Ensure ownerId is included
    };
    
    console.log("Creating customer with data:", customerData); // Debug log
    
    const customer = await Customer.create(customerData);
    
    res.status(201).json({
      message: "Customer created successfully",
      customer
    });
    
  } catch (err) {
    console.error("Customer creation error:", err); // Detailed error log
    
    // Handle specific Mongoose validation errors
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ 
        message: "Validation Error", 
        errors 
      });
    }
    
    // Handle duplicate key errors
    if (err.code === 11000) {
      return res.status(400).json({ 
        message: "Duplicate entry. Customer with this phone or CNIC already exists." 
      });
    }
    
    res.status(500).json({ 
      message: err.message || "Server error creating customer" 
    });
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
// =============================
// EMPLOYEE: GET MY CUSTOMERS
// =============================
router.get("/my", auth, async (req, res) => {
  try {
    if (req.user.role !== "employee") {
      return res.status(403).json({ message: "Employee only" });
    }

    const customers = await Customer.find({
      areaId: { $in: req.user.assignedAreas },
    });

    res.json(customers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


module.exports = router;
