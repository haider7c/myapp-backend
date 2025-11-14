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
    this.maxInitializationAttempts = 5; // Increased attempts
    this.isInitializing = false;
    this.reconnectionDelay = 10000; // 10 seconds
    this.reconnectionAttempts = 0;
    this.maxReconnectionAttempts = 3;
    
    this.ensureSessionDirectory();
    // Don't auto-init, wait for manual start
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
      
      if (exists) {
        // Verify session file is valid
        const sessionData = fs.readFileSync(sessionFile, 'utf8');
        const isValid = sessionData && sessionData.length > 50; // Basic validation
        console.log('📁 Session exists:', isValid, 'at:', sessionFile);
        return isValid;
      }
      
      console.log('📁 No valid session file found');
      return false;
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
      initializationAttempts: this.initializationAttempts,
      reconnectionAttempts: this.reconnectionAttempts
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

  // Start WhatsApp service manually
  async start() {
    if (this.isInitializing) {
      console.log('🔄 WhatsApp client is already initializing...');
      return { success: false, error: 'Already initializing' };
    }

    if (this.initializationAttempts >= this.maxInitializationAttempts) {
      console.error('❌ Max initialization attempts reached. Stopping...');
      return { success: false, error: 'Max initialization attempts reached' };
    }

    this.isInitializing = true;
    this.initializationAttempts++;

    try {
      console.log(`🔄 Starting WhatsApp client (attempt ${this.initializationAttempts}/${this.maxInitializationAttempts})...`);
      
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

      // Enhanced client configuration
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: "whatsapp-mobile-client",
          dataPath: this.sessionPath,
          backupSyncIntervalMs: 60000 // Backup sync every minute
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
            '--disable-features=AudioService',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--window-size=1920,1080'
          ],
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
          timeout: 60000 // 60 seconds timeout
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        },
        qrMaxRetries: 3, // Limit QR retries
        takeoverOnConflict: false,
        takeoverTimeoutMs: 0,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      });

      // Setup event handlers
      this.setupEventHandlers();

      console.log('🚀 Starting WhatsApp client initialization...');
      await this.client.initialize();
      console.log('✅ WhatsApp client initialization started successfully');

      return { success: true, message: 'WhatsApp client started' };

    } catch (error) {
      console.error('❌ WhatsApp client initialization failed:', error);
      this.handleInitializationError(error);
      return { success: false, error: error.message };
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
      this.reconnectionAttempts = 0; // Reset reconnection attempts on new QR
      
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
      this.reconnectionAttempts = 0; // Reset reconnection attempts
      console.log('💾 Session should be saved');
      this.notifyStatusUpdate();
    });

    this.client.on('authenticated', (session) => {
      console.log('✅ WhatsApp client authenticated!');
      this.notifyStatusUpdate();
    });

    this.client.on('auth_failure', (msg) => {
      console.error('❌ WhatsApp authentication failed:', msg);
      this.isReady = false;
      this.currentQR = null;
      this.handleAuthFailure();
      this.notifyStatusUpdate();
    });

    this.client.on('disconnected', (reason) => {
      console.log('❌ WhatsApp client disconnected:', reason);
      this.isReady = false;
      this.currentQR = null;
      this.reconnectionAttempts++;
      this.notifyStatusUpdate();
      
      this.handleDisconnection(reason);
    });

    // Add loading state handler
    this.client.on('loading_screen', (percent, message) => {
      console.log(`🔄 WhatsApp loading: ${percent}% - ${message}`);
    });

    this.client.on('remote_session_saved', () => {
      console.log('💾 Remote session saved successfully');
    });

    // Add change_state event
    this.client.on('change_state', (state) => {
      console.log('🔄 WhatsApp state changed:', state);
    });
  }

  handleAuthFailure() {
    console.log('🔄 Handling authentication failure...');
    // Clear session on auth failure
    setTimeout(() => {
      this.clearSession();
    }, 5000);
  }

  handleDisconnection(reason) {
    console.log('🔄 Handling disconnection... Reason:', reason);
    
    // Don't auto-reconnect if we have too many attempts
    if (this.reconnectionAttempts >= this.maxReconnectionAttempts) {
      console.log('🚨 Max reconnection attempts reached. Manual restart required.');
      return;
    }

    // Wait before reconnection attempt
    const delay = Math.min(30000, this.reconnectionAttempts * 10000);
    console.log(`⏳ Waiting ${delay/1000} seconds before reconnection attempt ${this.reconnectionAttempts}/${this.maxReconnectionAttempts}...`);
    
    setTimeout(() => {
      console.log('🔄 Attempting to reconnect WhatsApp...');
      this.start();
    }, delay);
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
      const retryDelay = Math.min(60000, this.initializationAttempts * 15000); // Max 60 seconds
      console.log(`⏳ Retrying initialization in ${retryDelay/1000} seconds...`);
      setTimeout(() => {
        this.start();
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
      reconnectionAttempts: this.reconnectionAttempts,
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
      this.reconnectionAttempts = 0;
      this.notifyStatusUpdate();
      
      return { success: true, message: 'Session cleared successfully' };
    } catch (error) {
      console.error('❌ Error clearing session:', error);
      return { success: false, error: error.message };
    }
  }

  // Stop WhatsApp service
  async stop() {
    try {
      console.log('🛑 Stopping WhatsApp service...');
      
      if (this.client) {
        await this.client.destroy();
      }
      
      this.isReady = false;
      this.currentQR = null;
      this.isInitializing = false;
      this.notifyStatusUpdate();
      
      return { success: true, message: 'WhatsApp service stopped' };
    } catch (error) {
      console.error('❌ Error stopping service:', error);
      return { success: false, error: error.message };
    }
  }

  // Restart WhatsApp service
  async restartService() {
    try {
      console.log('🔄 Restarting WhatsApp service...');
      
      await this.stop();
      
      // Wait a bit before restarting
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const result = await this.start();
      return result;
    } catch (error) {
      console.error('❌ Error restarting service:', error);
      return { success: false, error: error.message };
    }
  }

  // Regenerate QR code
  async regenerateQR() {
    try {
      console.log('🔄 Regenerating QR code...');
      
      await this.stop();
      
      // Clear session to force new QR
      await this.clearSession();
      
      // Wait before restarting
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const result = await this.start();
      return result;
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

// Create singleton instance but don't auto-start
const whatsappService = new WhatsAppService();

// Export start function to manually start the service
module.exports = whatsappService;