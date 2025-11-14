// services/whatsappService.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const Customer = require('../models/Customer');

class WhatsAppService {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.currentQR = null;
    this.statusListeners = [];
    this.sessionPath = path.join(process.cwd(), 'whatsapp-sessions');
    this.initializationAttempts = 0;
    this.maxInitializationAttempts = 3;
    this.isInitializing = false;
    
    this.ensureSessionDirectory();
    this.init();
  }

  // Ensure session directory exists
  ensureSessionDirectory() {
    try {
      if (!fs.existsSync(this.sessionPath)) {
        fs.mkdirSync(this.sessionPath, { recursive: true });
        console.log('✅ Created session directory:', this.sessionPath);
      }
    } catch (error) {
      console.error('❌ Failed to create session directory:', error);
    }
  }

  // Check if session exists
  checkSessionExists() {
    try {
      const sessionFile = path.join(this.sessionPath, 'whatsapp-mobile-client', 'session.json');
      const exists = fs.existsSync(sessionFile);
      console.log('📁 Session exists:', exists, 'at:', sessionFile);
      return exists;
    } catch (error) {
      console.error('❌ Error checking session:', error);
      return false;
    }
  }

  // Get session status
  getSessionStatus() {
    return {
      sessionExists: this.checkSessionExists(),
      sessionPath: this.sessionPath,
      sessionFile: path.join(this.sessionPath, 'whatsapp-mobile-client', 'session.json'),
      sessionDirectoryExists: fs.existsSync(this.sessionPath),
      initializationAttempts: this.initializationAttempts
    };
  }

  // Add status listener for real-time updates
  onStatusUpdate(callback) {
    this.statusListeners.push(callback);
  }

  // Remove status listener
  removeStatusListener(callback) {
    const index = this.statusListeners.indexOf(callback);
    if (index > -1) {
      this.statusListeners.splice(index, 1);
    }
  }

  // Notify all listeners of status change
  notifyStatusUpdate() {
    const status = this.getStatus();
    this.statusListeners.forEach(callback => {
      try {
        callback(status);
      } catch (error) {
        console.error('Error in status listener:', error);
      }
    });
  }

  async init() {
    if (this.isInitializing) {
      console.log('🔄 WhatsApp client is already initializing...');
      return;
    }

    if (this.initializationAttempts >= this.maxInitializationAttempts) {
      console.error('❌ Max initialization attempts reached. Stopping...');
      return;
    }

    this.isInitializing = true;
    this.initializationAttempts++;

    try {
      console.log(`🔄 Initializing WhatsApp client (attempt ${this.initializationAttempts}/${this.maxInitializationAttempts})...`);
      
      // Clean up previous client if exists
      if (this.client) {
        try {
          await this.client.destroy();
        } catch (error) {
          console.log('⚠️ Error destroying previous client:', error);
        }
        this.client = null;
      }

      const sessionExists = this.checkSessionExists();
      console.log('💾 Session exists before initialization:', sessionExists);

      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: "whatsapp-mobile-client",
          dataPath: this.sessionPath
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--single-process',
            '--no-zygote',
            '--max-old-space-size=256'
          ],
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        }
      });

      // Setup event handlers
      this.setupEventHandlers();

      console.log('🚀 Starting WhatsApp client initialization...');
      await this.client.initialize();
      console.log('✅ WhatsApp client initialization started successfully');

    } catch (error) {
      console.error('❌ WhatsApp client initialization failed:', error);
      this.handleInitializationError(error);
    } finally {
      this.isInitializing = false;
    }
  }

  setupEventHandlers() {
    // QR Code Handler
    this.client.on('qr', (qr) => {
      console.log('📱 WhatsApp QR Code received');
      this.currentQR = qr;
      this.isReady = false;
      
      // Generate terminal QR
      qrcode.generate(qr, { small: true });
      console.log('Scan the QR code above with WhatsApp');
      
      this.notifyStatusUpdate();
    });

    this.client.on('ready', () => {
      console.log('✅ WhatsApp client is ready!');
      this.isReady = true;
      this.currentQR = null;
      this.initializationAttempts = 0; // Reset attempts on success
      console.log('💾 Session should be saved');
      this.notifyStatusUpdate();
    });

    this.client.on('authenticated', () => {
      console.log('✅ WhatsApp client authenticated!');
      this.notifyStatusUpdate();
    });

    this.client.on('auth_failure', (msg) => {
      console.error('❌ WhatsApp authentication failed:', msg);
      this.isReady = false;
      this.currentQR = null;
      this.notifyStatusUpdate();
    });

    this.client.on('disconnected', (reason) => {
      console.log('❌ WhatsApp client disconnected:', reason);
      this.isReady = false;
      this.currentQR = null;
      this.notifyStatusUpdate();
      
      // Don't auto-reconnect immediately to prevent loops
      console.log('⏳ Waiting before reconnection...');
      setTimeout(() => {
        console.log('🔄 Attempting to reconnect WhatsApp...');
        this.init();
      }, 30000); // Wait 30 seconds before reconnection
    });

    // Add loading state handler
    this.client.on('loading_screen', (percent, message) => {
      console.log(`🔄 WhatsApp loading: ${percent}% - ${message}`);
    });

    this.client.on('remote_session_saved', () => {
      console.log('💾 Remote session saved successfully');
    });
  }

  handleInitializationError(error) {
    console.error('❌ Initialization error details:', {
      message: error.message,
      stack: error.stack,
      attempts: this.initializationAttempts
    });

    this.isReady = false;
    this.currentQR = null;
    this.notifyStatusUpdate();

    // Don't retry immediately to prevent loops
    if (this.initializationAttempts < this.maxInitializationAttempts) {
      const retryDelay = Math.min(30000, this.initializationAttempts * 10000); // Max 30 seconds
      console.log(`⏳ Retrying initialization in ${retryDelay/1000} seconds...`);
      setTimeout(() => {
        this.init();
      }, retryDelay);
    } else {
      console.error('🚨 Max initialization attempts reached. Manual intervention required.');
    }
  }

  // Format phone number for WhatsApp
  formatPhoneNumber(phone) {
    if (!phone) {
      throw new Error('Phone number is required');
    }

    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '');
    
    // Remove leading zeros
    cleaned = cleaned.replace(/^0+/, '');
    
    // If number starts with 92 and length is 10, it's good
    // If number doesn't start with country code, add it
    if (!cleaned.startsWith('92') && cleaned.length === 10) {
      cleaned = '92' + cleaned;
    }
    
    // Validate length
    if (cleaned.length !== 12) {
      throw new Error(`Invalid phone number length: ${cleaned}. Expected 12 digits, got ${cleaned.length}`);
    }
    
    // Add @c.us suffix
    return cleaned + '@c.us';
  }

  // Send message to a phone number
  async sendMessage(phone, message) {
    if (!this.isReady || !this.client) {
      throw new Error('WhatsApp client is not ready. Please scan QR code first.');
    }

    try {
      const formattedPhone = this.formatPhoneNumber(phone);
      console.log(`📤 Sending message to ${formattedPhone}`);
      
      const response = await this.client.sendMessage(formattedPhone, message);
      console.log(`✅ Message sent to ${phone}: ${response.id._serialized}`);
      return { success: true, messageId: response.id._serialized };
    } catch (error) {
      console.error(`❌ Failed to send message to ${phone}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Send payment reminder to customer
  async sendPaymentReminder(customerId) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) {
        throw new Error('Customer not found');
      }

      if (!customer.phone) {
        throw new Error('Customer phone number not found');
      }

      const message = `💳 *Payment Reminder*

Dear ${customer.customerName},

This is a friendly reminder that your payment for *${customer.packageName}* package is due.

*Bill Details:*
📦 Package: ${customer.packageName}
💰 Amount: Rs. ${customer.amount}
📅 Due Date: Day ${customer.billReceiveDate} of every month

Please make the payment at your earliest convenience to avoid any service interruption.

Thank you for your prompt attention.

Best regards,
Your ISP Team 🌐`;

      const result = await this.sendMessage(customer.phone, message);
      return result;
    } catch (error) {
      console.error('❌ Error sending payment reminder:', error);
      return { success: false, error: error.message };
    }
  }

  // Send thank you message for payment
  async sendThankYouMessage(customerId, paymentDetails = {}) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) {
        throw new Error('Customer not found');
      }

      if (!customer.phone) {
        throw new Error('Customer phone number not found');
      }

      const message = `🙏 *Thank You for Your Payment!*

Dear ${customer.customerName},

Thank you for your payment for *${customer.packageName}* package.

${paymentDetails.amount ? `💰 Amount: Rs. ${paymentDetails.amount}` : ''}
${paymentDetails.method ? `💳 Method: ${paymentDetails.method}` : ''}
${paymentDetails.transactionId ? `🆔 Transaction: ${paymentDetails.transactionId}` : ''}

We appreciate your business and look forward to serving you.

Your service will continue uninterrupted. Next payment due on Day ${customer.billReceiveDate} of next month.

For any queries, please contact support.

Best regards,
Your ISP Team 🌐`;

      const result = await this.sendMessage(customer.phone, message);
      return result;
    } catch (error) {
      console.error('❌ Error sending thank you message:', error);
      return { success: false, error: error.message };
    }
  }

  // Send general message to customer
  async sendCustomerMessage(customerId, customMessage) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) {
        throw new Error('Customer not found');
      }

      if (!customer.phone) {
        throw new Error('Customer phone number not found');
      }

      const message = `📱 *Message from Your ISP*

Dear ${customer.customerName},

${customMessage}

Best regards,
Your ISP Team 🌐`;

      const result = await this.sendMessage(customer.phone, message);
      return result;
    } catch (error) {
      console.error('❌ Error sending custom message:', error);
      return { success: false, error: error.message };
    }
  }

  // Send expiry reminder
  async sendExpiryReminder(customerId) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) {
        throw new Error('Customer not found');
      }

      const message = `⚠️ *Package Expiry Reminder*

Dear ${customer.customerName},

Your *${customer.packageName}* package will expire soon.

📦 Package: ${customer.packageName}
💰 Amount: Rs. ${customer.amount}
📅 Renew before: Day ${customer.billReceiveDate}

Please renew your package to avoid service interruption.

Best regards,
Your ISP Team 🌐`;

      const result = await this.sendMessage(customer.phone, message);
      return result;
    } catch (error) {
      console.error('❌ Error sending expiry reminder:', error);
      return { success: false, error: error.message };
    }
  }

  // Get status with enhanced information
  getStatus() {
    const sessionStatus = this.getSessionStatus();
    return {
      isReady: this.isReady,
      isConnected: this.isReady,
      hasQR: !!this.currentQR,
      timestamp: new Date().toISOString(),
      sessionSaved: sessionStatus.sessionExists,
      sessionExists: sessionStatus.sessionExists,
      sessionPath: sessionStatus.sessionPath,
      initializationAttempts: this.initializationAttempts,
      isInitializing: this.isInitializing
    };
  }

  // Get current QR code
  getCurrentQR() {
    return this.currentQR;
  }

  // Test connection by checking if client is ready
  async testConnection() {
    try {
      if (!this.client) {
        return { success: false, error: 'WhatsApp client not initialized' };
      }
      
      const state = await this.client.getState();
      return { 
        success: state === 'CONNECTED', 
        state: state,
        isReady: this.isReady 
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Clear session (for debugging)
  async clearSession() {
    try {
      console.log('🗑️ Clearing WhatsApp session...');
      if (this.client) {
        await this.client.destroy();
      }
      
      // Delete session files
      const sessionDir = path.join(this.sessionPath, 'whatsapp-mobile-client');
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log('✅ Session cleared successfully');
      }
      
      this.isReady = false;
      this.currentQR = null;
      this.initializationAttempts = 0;
      this.notifyStatusUpdate();
      
      return { success: true, message: 'Session cleared successfully' };
    } catch (error) {
      console.error('❌ Error clearing session:', error);
      return { success: false, error: error.message };
    }
  }

  // Restart WhatsApp service
  async restartService() {
    try {
      console.log('🔄 Restarting WhatsApp service...');
      
      if (this.client) {
        await this.client.destroy();
      }
      
      this.isReady = false;
      this.currentQR = null;
      this.initializationAttempts = 0;
      this.isInitializing = false;
      
      // Wait a bit before restarting
      setTimeout(() => {
        this.init();
      }, 5000);
      
      return { success: true, message: 'WhatsApp service restart initiated' };
    } catch (error) {
      console.error('❌ Error restarting service:', error);
      return { success: false, error: error.message };
    }
  }

  // Regenerate QR code
  async regenerateQR() {
    try {
      console.log('🔄 Regenerating QR code...');
      
      if (this.client) {
        await this.client.destroy();
      }
      
      this.isReady = false;
      this.currentQR = null;
      this.initializationAttempts = 0;
      this.notifyStatusUpdate();
      
      // Reinitialize after a short delay
      setTimeout(() => {
        this.init();
      }, 3000);
      
      return { success: true, message: 'QR code regeneration initiated' };
    } catch (error) {
      console.error('❌ Error regenerating QR:', error);
      return { success: false, error: error.message };
    }
  }

  // Destroy client properly
  async destroyClient() {
    if (this.client) {
      try {
        await this.client.destroy();
        this.client = null;
        this.isReady = false;
        this.currentQR = null;
        this.notifyStatusUpdate();
      } catch (error) {
        console.error('Error destroying client:', error);
      }
    }
  }

  // Clean up all listeners
  cleanup() {
    this.statusListeners = [];
    if (this.client) {
      this.client.removeAllListeners();
    }
  }
}

// Create singleton instance
const whatsappService = new WhatsAppService();
module.exports = whatsappService;