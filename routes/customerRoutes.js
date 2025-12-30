const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const auth = require("../middleware/auth");

// =============================
// GET ALL CUSTOMERS (WITH ROLE-BASED FILTERING)
// =============================
router.get("/", auth, async (req, res) => {
  try {
    const { date } = req.query;
    let query = {};

    // Date filter if provided
    if (date) {
      const selectedDate = new Date(date);
      const nextDate = new Date(selectedDate);
      nextDate.setDate(selectedDate.getDate() + 1);
      query.billReceiveDate = { $gte: selectedDate, $lt: nextDate };
    }

    // Role-based filtering
    if (req.user.role === "employee") {
      // Employee can only see customers in their assigned areas
      // Check if assignedAreas exists and is not empty
      if (!req.user.assignedAreas || req.user.assignedAreas.length === 0) {
        return res.json([]); // Return empty array if no areas assigned
      }
      query.areaId = { $in: req.user.assignedAreas };
    }
    // Owner can see all (no additional filter)

    console.log("User role:", req.user.role);
    console.log("Assigned areas:", req.user.assignedAreas);
    console.log("Query:", query);

    const customers = await Customer.find(query)
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");

    console.log("Found customers:", customers.length);
    res.json(customers);
  } catch (error) {
    console.error("Error fetching customers:", error);
    res.status(500).json({ message: error.message });
  }
});

// =============================
// GET ACTIVE CUSTOMERS
// =============================
router.get("/active", auth, async (req, res) => {
  try {
    let query = { status: "active" };

    // Role-based filtering
    if (req.user.role === "employee") {
      query.areaId = { $in: req.user.assignedAreas };
    }

    const customers = await Customer.find(query)
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
router.get("/discontinued", auth, async (req, res) => {
  try {
    let query = { status: "discontinued" };

    // Role-based filtering
    if (req.user.role === "employee") {
      query.areaId = { $in: req.user.assignedAreas };
    }

    const customers = await Customer.find(query)
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// =============================
// GET ONE CUSTOMER
// =============================
router.get("/:id", auth, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id)
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");
    
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // Check if employee has permission to view this customer
    if (req.user.role === "employee") {
      const isAssignedArea = req.user.assignedAreas?.some(
        areaId => areaId.toString() === customer.areaId?._id?.toString()
      );
      
      if (!isAssignedArea) {
        return res.status(403).json({ message: "Access denied. You don't have permission to view this customer." });
      }
    }
    
    res.json(customer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================
// MARK AS DISCONTINUED (OWNER ONLY)
// =============================
router.put("/:id/discontinue", auth, async (req, res) => {
  try {
    // Check if user is owner
    if (req.user.role !== "owner") {
      return res.status(403).json({ message: "Only owner can discontinue customers" });
    }

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
// REACTIVATE A CUSTOMER (OWNER ONLY)
// =============================
router.put("/:id/reactivate", auth, async (req, res) => {
  try {
    // Check if user is owner
    if (req.user.role !== "owner") {
      return res.status(403).json({ message: "Only owner can reactivate customers" });
    }

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
// CREATE CUSTOMER
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
// UPDATE CUSTOMER (OWNER ONLY)
// =============================
router.put("/:id", auth, async (req, res) => {
  try {
    // Check if user is owner
    if (req.user.role !== "owner") {
      return res.status(403).json({ message: "Only owner can update customer details" });
    }

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
// DELETE CUSTOMER (OWNER ONLY)
// =============================
router.delete("/:id", auth, async (req, res) => {
  try {
    // Check if user is owner
    if (req.user.role !== "owner") {
      return res.status(403).json({ message: "Only owner can delete customers" });
    }

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
// MARK PAYMENT RECEIVED (EMPLOYEE CAN DO THIS)
// =============================
router.put("/:id/mark-paid", auth, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // Check if employee has permission
    if (req.user.role === "employee") {
      const isAssignedArea = req.user.assignedAreas?.some(
        areaId => areaId.toString() === customer.areaId?.toString()
      );
      
      if (!isAssignedArea) {
        return res.status(403).json({ 
          message: "Access denied. You can only mark payments for customers in your assigned areas." 
        });
      }
    }

    // Update payment status
    const updatedCustomer = await Customer.findByIdAndUpdate(
      req.params.id,
      {
        lastPaymentDate: new Date(),
        lastPaymentAmount: req.body.amount || customer.amount,
        paymentStatus: "paid",
        synced: true,
      },
      { new: true }
    )
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");

    res.json({
      message: "Payment marked as received successfully",
      customer: updatedCustomer,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// =============================
// EMPLOYEE: GET MY CUSTOMERS (SPECIAL ROUTE)
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

module.exports = router;