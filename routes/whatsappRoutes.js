// routes/whatsappRoutes.js
const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const BillStatus = require("../models/BillStatus");
const whatsappService = require("../services/whatsappService");
const fs = require('fs');
const path = require('path');

// Get WhatsApp status
router.get("/status", async (req, res) => {
  try {
    const status = whatsappService.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Status route error:', error);
    res.status(500).json({ 
      error: "Failed to get WhatsApp status: " + error.message 
    });
  }
});

// Get session status
router.get("/session-status", async (req, res) => {
  try {
    const sessionStatus = whatsappService.getSessionStatus();
    const whatsappStatus = whatsappService.getStatus();
    
    res.json({
      ...sessionStatus,
      whatsappStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear session (for debugging)
router.post("/clear-session", async (req, res) => {
  try {
    const result = await whatsappService.clearSession();
    res.json(result);
  } catch (error) {
    console.error('Clear session error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Send test message
router.post("/send-test", async (req, res) => {
  try {
    const { phone, message } = req.body;

    console.log('Send test request:', { phone, message });

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: "Phone and message are required",
      });
    }

    // Check if WhatsApp is ready
    if (!whatsappService.isReady) {
      return res.status(503).json({
        success: false,
        error: "WhatsApp is not connected. Please scan the QR code first.",
      });
    }

    console.log('Sending test message via WhatsApp service...');
    const result = await whatsappService.sendMessage(phone, message);
    
    console.log('Send test result:', result);
    res.json(result);
    
  } catch (error) {
    console.error('Send test error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Send payment reminder to customer
router.post("/send-payment-reminder/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;
    console.log('Send payment reminder for customer:', customerId);

    if (!whatsappService.isReady) {
      return res.status(503).json({
        success: false,
        error: "WhatsApp is not connected",
      });
    }

    const result = await whatsappService.sendPaymentReminder(customerId);
    console.log('Payment reminder result:', result);
    res.json(result);
    
  } catch (error) {
    console.error('Send payment reminder error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Send thank you message for payment
router.post("/send-thank-you/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;
    const { amount, method, transactionId } = req.body;

    console.log('Send thank you message for customer:', customerId);

    if (!whatsappService.isReady) {
      return res.status(503).json({
        success: false,
        error: "WhatsApp is not connected",
      });
    }

    const paymentDetails = {
      amount,
      method,
      transactionId,
    };

    const result = await whatsappService.sendThankYouMessage(customerId, paymentDetails);
    console.log('Thank you message result:', result);
    res.json(result);
    
  } catch (error) {
    console.error('Send thank you message error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Send custom message to customer
router.post("/send-custom-message/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;
    const { message } = req.body;

    console.log('Send custom message for customer:', customerId);

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Message is required",
      });
    }

    if (!whatsappService.isReady) {
      return res.status(503).json({
        success: false,
        error: "WhatsApp is not connected",
      });
    }

    const result = await whatsappService.sendCustomerMessage(customerId, message);
    console.log('Custom message result:', result);
    res.json(result);
    
  } catch (error) {
    console.error('Send custom message error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Send expiry reminder
router.post("/send-expiry-reminder/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;
    console.log('Send expiry reminder for customer:', customerId);

    if (!whatsappService.isReady) {
      return res.status(503).json({
        success: false,
        error: "WhatsApp is not connected",
      });
    }

    const result = await whatsappService.sendExpiryReminder(customerId);
    console.log('Expiry reminder result:', result);
    res.json(result);
    
  } catch (error) {
    console.error('Send expiry reminder error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get expiring packages (unpaid customers with bill dates in next 3 days)
router.get("/expiring-packages", async (req, res) => {
  try {
    const { days = 3 } = req.query;
    const today = new Date();
    const todayDay = today.getDate();

    // Get all customers
    const allCustomers = await Customer.find();

    // Filter customers whose bill date is within the next X days and are unpaid
    const expiringPackages = [];

    for (let i = 1; i <= parseInt(days); i++) {
      const targetDay = todayDay + i;
      
      const customersWithTargetDay = allCustomers.filter(customer => {
        const billDay = parseInt(customer.billReceiveDate);
        return billDay === targetDay;
      });

      // Check payment status for each customer
      for (const customer of customersWithTargetDay) {
        const billStatus = await BillStatus.findOne({
          customerId: customer._id,
          month: today.getMonth() + 1,
          year: today.getFullYear(),
        });

        // Only include unpaid customers
        if (!billStatus || billStatus.billStatus === false) {
          expiringPackages.push({
            ...customer.toObject(),
            expiresInDays: i,
            expiryDate: `Day ${targetDay} (in ${i} day${i > 1 ? 's' : ''})`
          });
        }
      }
    }

    res.json(expiringPackages);
  } catch (error) {
    console.error('Get expiring packages error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get due today packages (unpaid customers with bill date today)
router.get("/due-today", async (req, res) => {
  try {
    const today = new Date();
    const todayDay = today.getDate();

    // Get all customers with bill date today
    const allCustomers = await Customer.find();
    const dueCustomers = allCustomers.filter(customer => {
      const billDay = parseInt(customer.billReceiveDate);
      return billDay === todayDay;
    });

    // Filter only unpaid customers
    const unpaidDueCustomers = [];
    
    for (const customer of dueCustomers) {
      const billStatus = await BillStatus.findOne({
        customerId: customer._id,
        month: today.getMonth() + 1,
        year: today.getFullYear(),
      });

      if (!billStatus || billStatus.billStatus === false) {
        unpaidDueCustomers.push(customer);
      }
    }

    res.json(unpaidDueCustomers);
  } catch (error) {
    console.error('Get due today error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Regenerate QR code
router.post("/regenerate-qr", async (req, res) => {
  try {
    const result = await whatsappService.regenerateQR();
    res.json(result);
  } catch (error) {
    console.error('Regenerate QR error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get current QR code
router.get("/qr-code", async (req, res) => {
  try {
    const qrCode = whatsappService.getCurrentQR();
    res.json({ qrCode });
  } catch (error) {
    console.error('Get QR code error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;