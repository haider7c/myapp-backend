const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const Area = require("../models/Area");
const Service = require("../models/Service");
const auth = require("../middleware/auth");
const { logActivity } = require("../services/activityLogger");

// The desktop billing app doesn't have an Area/Service concept and never
// sends areaId/serviceId when creating a customer. Rather than reject those
// requests, fall back to a per-owner "Unassigned"/"General" record so the
// mobile app's area-based employee filtering keeps working unchanged, and
// desktop-created customers just land in that default bucket.
async function getOrCreateDefault(Model, ownerId, name) {
  let doc = await Model.findOne({ ownerId, name });
  if (!doc) {
    doc = await Model.create({ ownerId, name });
  }
  return doc;
}

// Every business owner is its own tenant. This resolves the tenant id a
// request is allowed to touch: the owner's own id, or the ownerId their
// employee account belongs to. Every query below must be scoped by this.
function ownerScope(req) {
  return req.user.role === "owner" ? req.user.id : req.user.ownerId;
}

// =============================
// GET ALL CUSTOMERS (WITH ROLE-BASED FILTERING)
// =============================
router.get("/", auth, async (req, res) => {
  try {
    const { date } = req.query;
    let query = { ownerId: ownerScope(req) };

    // Date filter if provided
    if (date) {
      const selectedDate = new Date(date);
      const nextDate = new Date(selectedDate);
      nextDate.setDate(selectedDate.getDate() + 1);
      query.billReceiveDate = { $gte: selectedDate, $lt: nextDate };
    }

    // Role-based filtering
    if (req.user.role === "employee" && !req.user.locationOnly) {
      // Employee can only see customers in their assigned areas
      // Check if assignedAreas exists and is not empty
      if (!req.user.assignedAreas || req.user.assignedAreas.length === 0) {
        return res.json([]); // Return empty array if no areas assigned
      }
      query.areaId = { $in: req.user.assignedAreas };
    }
    // Owner sees all customers within their own tenant (scoped above).
    // A locationOnly employee also sees every customer in the tenant,
    // unfiltered by area -- their whole job is recording locations across
    // the board, not one area, and this is the account the Set Customer
    // Location search box calls this route for, so an empty/incomplete
    // "Assign Areas" checklist on their account must never silently zero
    // out their search results the way it does for a normal employee.

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
    let query = { status: "active", ownerId: ownerScope(req) };

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
    let query = { status: "discontinued", ownerId: ownerScope(req) };

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
    const customer = await Customer.findOne({
      _id: req.params.id,
      ownerId: ownerScope(req),
    })
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // Check if employee has permission to view this customer
    if (req.user.role === "employee") {
      const isAssignedArea = req.user.assignedAreas?.some(
        (areaId) => areaId.toString() === customer.areaId?._id?.toString(),
      );

      if (!isAssignedArea) {
        return res.status(403).json({
          message:
            "Access denied. You don't have permission to view this customer.",
        });
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
      return res
        .status(403)
        .json({ message: "Only owner can discontinue customers" });
    }

    const customer = await Customer.findOneAndUpdate(
      { _id: req.params.id, ownerId: ownerScope(req) },
      {
        status: "discontinued",
        discontinuedAt: new Date(),
      },
      { new: true },
    )
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    if (customer) {
      logActivity({
        type: "customer_discontinued",
        reqUser: req.user,
        customer,
        message: `Discontinued customer ${customer.customerName} (${customer.customerId || "no ID"})`,
      });
    }

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
      return res
        .status(403)
        .json({ message: "Only owner can reactivate customers" });
    }

    const customer = await Customer.findOneAndUpdate(
      { _id: req.params.id, ownerId: ownerScope(req) },
      {
        status: "active",
        discontinuedAt: null,
      },
      { new: true },
    )
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

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
        message: "ownerId is required. Please provide a valid owner.",
      });
    }

    let areaId = req.body.areaId;
    if (!areaId) {
      const defaultArea = await getOrCreateDefault(Area, ownerId, "Unassigned");
      areaId = defaultArea._id;
    }

    let serviceId = req.body.serviceId;
    if (!serviceId) {
      const defaultService = await getOrCreateDefault(Service, ownerId, "General");
      serviceId = defaultService._id;
    }

    const customerData = {
      ...req.body,
      ownerId: ownerId,
      areaId,
      serviceId,
    };

    console.log("Creating customer with data:", customerData);

    const customer = await Customer.create(customerData);

    // Populate the created customer before sending response
    const populatedCustomer = await Customer.findById(customer._id)
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");

    logActivity({
      type: "customer_created",
      reqUser: req.user,
      customer: populatedCustomer,
      message: `Created customer ${populatedCustomer.customerName} (${populatedCustomer.customerId || "no ID"})`,
    });

    res.status(201).json({
      message: "Customer created successfully",
      customer: populatedCustomer,
    });
  } catch (err) {
    console.error("Customer creation error:", err);

    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({
        message: "Validation Error",
        errors,
      });
    }

    if (err.code === 11000) {
      return res.status(400).json({
        message:
          "Duplicate entry. Customer with this phone or CNIC already exists.",
      });
    }

    res.status(500).json({
      message: err.message || "Server error creating customer",
    });
  }
});
// =============================
// SEARCH CUSTOMER BY ID/USERNAME
// =============================
router.get("/search/:identifier", auth, async (req, res) => {
  try {
    const identifier = req.params.identifier;

    console.log("Searching for customer with identifier:", identifier);

    // Build search query - search in multiple fields
    const searchQuery = {
      ownerId: ownerScope(req),
      $or: [
        { customerId: { $regex: identifier, $options: "i" } }, // case-insensitive search in customerId
        { customerName: { $regex: identifier, $options: "i" } }, // search in customer name
        { phone: { $regex: identifier, $options: "i" } }, // search in phone
        { serialNumber: identifier }, // exact match in serial number
        { _id: identifier.match(/^[0-9a-fA-F]{24}$/) ? identifier : null }, // if it's a valid ObjectId
      ].filter((condition) => condition !== null), // remove null conditions
    };

    console.log("Search query:", JSON.stringify(searchQuery));

    let customers = await Customer.find(searchQuery)
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");

    // Role-based filtering
    if (req.user.role === "employee") {
      customers = customers.filter((customer) =>
        req.user.assignedAreas?.some(
          (areaId) => areaId.toString() === customer.areaId?._id?.toString(),
        ),
      );
    }

    console.log(`Found ${customers.length} customers`);

    if (customers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No customer found with this identifier",
      });
    }

    // If exact match by customerId, return that customer
    const exactMatch = customers.find(
      (c) => c.customerId?.toLowerCase() === identifier.toLowerCase(),
    );

    if (exactMatch) {
      return res.json({
        success: true,
        exact: true,
        customer: exactMatch,
      });
    }

    // Otherwise return all matches
    res.json({
      success: true,
      exact: false,
      count: customers.length,
      customers: customers,
    });
  } catch (error) {
    console.error("Search customer error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// =============================
// GET CUSTOMER BY CUSTOMER ID
// =============================
router.get("/by-customerid/:customerId", auth, async (req, res) => {
  try {
    const customerId = req.params.customerId;

    const customer = await Customer.findOne({
      customerId: customerId,
      ownerId: ownerScope(req),
    })
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found with this ID",
      });
    }

    // Check if employee has permission
    if (req.user.role === "employee") {
      const isAssignedArea = req.user.assignedAreas?.some(
        (areaId) => areaId.toString() === customer.areaId?._id?.toString(),
      );

      if (!isAssignedArea) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied. You don't have permission to view this customer.",
        });
      }
    }

    res.json({
      success: true,
      customer: customer,
    });
  } catch (error) {
    console.error("Get customer by ID error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
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
      return res
        .status(403)
        .json({ message: "Only owner can update customer details" });
    }

    const updatedCustomer = await Customer.findOneAndUpdate(
      { _id: req.params.id, ownerId: ownerScope(req) },
      req.body,
      { new: true },
    )
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");

    if (!updatedCustomer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    logActivity({
      type: "customer_updated",
      reqUser: req.user,
      customer: updatedCustomer,
      message: `Updated customer ${updatedCustomer.customerName} (${updatedCustomer.customerId || "no ID"})`,
    });

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
      return res
        .status(403)
        .json({ message: "Only owner can delete customers" });
    }

    const deletedCustomer = await Customer.findOneAndDelete({
      _id: req.params.id,
      ownerId: ownerScope(req),
    });

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
    const customer = await Customer.findOne({
      _id: req.params.id,
      ownerId: ownerScope(req),
    });

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // Check if employee has permission
    if (req.user.role === "employee") {
      const isAssignedArea = req.user.assignedAreas?.some(
        (areaId) => areaId.toString() === customer.areaId?.toString(),
      );

      if (!isAssignedArea) {
        return res.status(403).json({
          message:
            "Access denied. You can only mark payments for customers in your assigned areas.",
        });
      }
    }

    // Update payment status
    const updatedCustomer = await Customer.findOneAndUpdate(
      { _id: req.params.id, ownerId: ownerScope(req) },
      {
        lastPaymentDate: new Date(),
        lastPaymentAmount: req.body.amount || customer.amount,
        paymentStatus: "paid",
        synced: true,
      },
      { new: true },
    )
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");

    logActivity({
      type: "bill_payment",
      reqUser: req.user,
      customer: updatedCustomer,
      message: `Payment received from ${updatedCustomer.customerName} (Rs. ${req.body.amount || customer.amount})`,
      details: { amount: req.body.amount || customer.amount, source: "customer.mark-paid" },
    });

    res.json({
      message: "Payment marked as received successfully",
      customer: updatedCustomer,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// =============================
// SET/UPDATE CUSTOMER GPS LOCATION (OWNER OR ASSIGNED EMPLOYEE)
// =============================
// Deliberately not folded into the generic "UPDATE CUSTOMER" route above
// (owner-only, full profile form) -- capturing GPS coordinates is a quick,
// single-purpose action meant to be done by whoever is physically at the
// customer's location, which is very often the employee out collecting
// bills, not just the owner.
router.put("/:id/location", auth, async (req, res) => {
  try {
    const { gpsLat, gpsLng } = req.body;

    const lat = Number(gpsLat);
    const lng = Number(gpsLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({
        message: "gpsLat and gpsLng must both be valid numbers",
      });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        message: "gpsLat/gpsLng are outside valid coordinate ranges",
      });
    }

    const customer = await Customer.findOne({
      _id: req.params.id,
      ownerId: ownerScope(req),
    });

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // Same area-scoping check as mark-paid -- an employee can only set
    // location for customers in their assigned areas. A locationOnly
    // employee is exempt (see the matching note on GET / above): they're
    // meant to be able to set location for any customer in the tenant.
    if (req.user.role === "employee" && !req.user.locationOnly) {
      const isAssignedArea = req.user.assignedAreas?.some(
        (areaId) => areaId.toString() === customer.areaId?.toString(),
      );

      if (!isAssignedArea) {
        return res.status(403).json({
          message:
            "Access denied. You can only set location for customers in your assigned areas.",
        });
      }
    }

    const updatedCustomer = await Customer.findOneAndUpdate(
      { _id: req.params.id, ownerId: ownerScope(req) },
      { gpsLat: lat, gpsLng: lng, gpsUpdatedAt: new Date() },
      { new: true },
    )
      .populate("areaId", "name")
      .populate("serviceId", "name")
      .populate("assignedEmployeeId", "name");

    logActivity({
      type: "customer_location_updated",
      reqUser: req.user,
      customer: updatedCustomer,
      message: `Updated location for ${updatedCustomer.customerName} (${updatedCustomer.customerId || "no ID"})`,
      details: { gpsLat: lat, gpsLng: lng },
    });

    res.json({
      message: "Customer location updated successfully",
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
      ownerId: ownerScope(req),
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
