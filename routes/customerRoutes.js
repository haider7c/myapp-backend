const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const auth = require("../middleware/auth");

// =============================
// GET ACTIVE CUSTOMERS
// =============================
router.get("/active", async (req, res) => {
  try {
    const customers = await Customer.find({ status: "active" })
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");
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
    const customers = await Customer.find({ status: "discontinued" })
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// =============================
// GET BY BILL DATE OR ALL
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
      })
        .populate("areaId", "name")
        .populate("serviceId", "name")
        .populate("assignedEmployeeId", "name");
    } else {
      customers = await Customer.find()
        .populate("areaId", "name")
        .populate("serviceId", "name")
        .populate("assignedEmployeeId", "name");
    }

    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// =============================
// GET ONE CUSTOMER
// =============================
router.get("/:id", async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id)
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");
    
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }
    
    res.json(customer);
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
    })
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");

    res.json(customers);
  } catch (err) {
    res.status(500).json({ message: err.message });
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
    )
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");

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
        discontinuedAt: null,
      },
      { new: true }
    )
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");

    res.json({
      message: "Customer reactivated successfully",
      customer,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// =============================
// Create CUSTOMER
// =============================
router.post("/", auth, async (req, res) => {
  try {
    console.log("User data from token:", req.user);
    
    let ownerId;
    
    if (req.user.role === "owner") {
      ownerId = req.user.id;
    } else if (req.user.role === "employee" && req.user.ownerId) {
      ownerId = req.user.ownerId;
    } else {
      ownerId = req.body.ownerId || req.user.id;
    }
    
    console.log("Extracted ownerId:", ownerId);
    
    if (!ownerId) {
      return res.status(400).json({ 
        message: "ownerId is required. Please provide a valid owner." 
      });
    }
    
    if (!req.body.areaId) {
      return res.status(400).json({ message: "areaId is required" });
    }
    
    if (!req.body.serviceId) {
      return res.status(400).json({ message: "serviceId is required" });
    }
    
    const customerData = {
      ...req.body,
      ownerId: ownerId,
    };
    
    console.log("Creating customer with data:", customerData);
    
    const customer = await Customer.create(customerData);
    
    // Populate the created customer before sending response
    const populatedCustomer = await Customer.findById(customer._id)
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");
    
    res.status(201).json({
      message: "Customer created successfully",
      customer: populatedCustomer
    });
    
  } catch (err) {
    console.error("Customer creation error:", err);
    
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ 
        message: "Validation Error", 
        errors 
      });
    }
    
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
    )
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");

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