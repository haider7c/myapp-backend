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
    this.maxInitializationAttempts = 5;
    this.isInitializing = false;
    this.lastActivity = null;
    this.healthCheckInterval = null;
    
    this.ensureSessionDirectory();
    
    // Start with longer delay for server stability
    setTimeout(() => {
      this.init();
    }, 10000);
  }

  ensureSessionDirectory() {
    try {
      if (!fs.existsSync(this.sessionPath)) {
        fs.mkdirSync(this.sessionPath, { recursive: true });
        console.log('✅ Created session directory');
      }
    } catch (error) {
      console.error('❌ Failed to create session directory:', error);
    }
  }

  async init() {
    if (this.isInitializing) {
      console.log('⚠️  Initialization already in progress');
      return;
    }

    if (this.initializationAttempts >= this.maxInitializationAttempts) {
      console.log('ℹ️  Max initialization attempts reached');
      this.isInitializing = false;
      return;
    }

    this.isInitializing = true;
    this.initializationAttempts++;
    console.log(`🔄 Initializing WhatsApp (attempt ${this.initializationAttempts})`);

    try {
      // Clean up previous client properly
      if (this.client) {
        try {
          await this.client.destroy();
          console.log('✅ Previous client destroyed');
        } catch (error) {
          console.log('⚠️  Error cleaning previous client:', error.message);
        }
        this.client = null;
      }

      // Add delay between attempts
      if (this.initializationAttempts > 1) {
        const delay = Math.min(30000, this.initializationAttempts * 8000);
        console.log(`⏳ Waiting ${delay/1000}s before attempt ${this.initializationAttempts}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: "render-client",
          dataPath: this.sessionPath,
          backupSyncIntervalMs: 300000
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
            '--disable-extensions',
            '--max-old-space-size=384',
            '--js-flags="--max-old-space-size=384"',
            '--memory-pressure-off',
            '--max_old_space_size=384'
          ],
          timeout: 60000,
          executablePath: process.env.CHROME_PATH || undefined
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        },
        takeoverOnConflict: true,
        takeoverTimeoutMs: 10000,
        restartOnAuthFail: true,
        qrMaxRetries: 5
      });

      this.setupEventHandlers();
      await this.client.initialize();
      
    } catch (error) {
      console.error('❌ WhatsApp initialization failed:', error.message);
      this.handleInitError(error);
    } finally {
      this.isInitializing = false;
    }
  }

  setupEventHandlers() {
    this.client.on('loading_screen', (percent, message) => {
      console.log(`🔄 Loading: ${percent}% - ${message}`);
    });

    this.client.on('qr', (qr) => {
      console.log('📱 QR Code received');
      this.currentQR = qr;
      this.isReady = false;
      qrcode.generate(qr, { small: true });
      this.notifyStatusUpdate();
    });

    this.client.on('ready', () => {
      console.log('✅ WhatsApp client is READY!');
      this.isReady = true;
      this.currentQR = null;
      this.initializationAttempts = 0;
      this.lastActivity = new Date();
      this.startHealthChecks();
      this.notifyStatusUpdate();
    });

    this.client.on('authenticated', () => {
      console.log('✅ WhatsApp authenticated');
      this.lastActivity = new Date();
    });

    this.client.on('auth_failure', (msg) => {
      console.error('❌ WhatsApp auth failure:', msg);
      this.isReady = false;
      this.currentQR = null;
      this.stopHealthChecks();
      this.handleAuthFailure();
    });

    this.client.on('disconnected', (reason) => {
      console.log('❌ WhatsApp disconnected:', reason);
      this.isReady = false;
      this.currentQR = null;
      this.stopHealthChecks();
      this.handleDisconnection(reason);
    });

    this.client.on('change_state', (state) => {
      console.log('🔁 State changed:', state);
    });
  }

  handleInitError(error) {
    const delay = Math.min(45000, this.initializationAttempts * 12000);
    console.log(`⏳ Retrying in ${delay/1000} seconds...`);
    
    setTimeout(() => {
      this.init();
    }, delay);
  }

  handleAuthFailure() {
    console.log('🔄 Handling auth failure...');
    setTimeout(async () => {
      await this.clearSession();
      setTimeout(() => this.init(), 8000);
    }, 3000);
  }

  handleDisconnection(reason) {
    console.log(`🔄 Handling disconnection: ${reason}`);
    
    if (reason === 'NAVIGATION' || reason === 'CONFLICT') {
      console.log('🔄 Quick reconnect for navigation/conflict');
      setTimeout(() => this.init(), 5000);
    } else {
      const delay = 15000;
      console.log(`⏳ Attempting reconnect in ${delay/1000} seconds...`);
      setTimeout(() => this.init(), delay);
    }
  }

  startHealthChecks() {
    this.stopHealthChecks(); // Clear existing interval
    
    this.healthCheckInterval = setInterval(async () => {
      if (this.isReady && this.client) {
        try {
          const state = await this.client.getState();
          console.log('💚 Session health check: OK');
          this.lastActivity = new Date();
        } catch (error) {
          console.log('❌ Session health check failed, reinitializing...');
          this.isReady = false;
          this.init();
        }
      }
    }, 180000); // Check every 3 minutes
  }

  stopHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  async sendMessage(phone, message) {
    if (!this.isReady || !this.client) {
      throw new Error('WhatsApp not ready. Please scan QR code.');
    }

    try {
      // Update last activity
      this.lastActivity = new Date();
      
      const formattedPhone = this.formatPhoneNumber(phone);
      console.log(`📤 Sending message to: ${formattedPhone}`);
      
      // Add small delay to prevent rapid successive messages
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const response = await this.client.sendMessage(formattedPhone, message);
      
      console.log('✅ Message sent successfully');
      return { success: true, messageId: response.id._serialized };
      
    } catch (error) {
      console.error('❌ Send message error:', error);
      
      // Handle specific errors
      if (error.message.includes('not connected') || 
          error.message.includes('closed') || 
          error.message.includes('CONNECTION')) {
        this.isReady = false;
        this.stopHealthChecks();
        setTimeout(() => this.init(), 8000);
      }
      
      return { success: false, error: error.message };
    }
  }

  formatPhoneNumber(phone) {
    if (!phone) throw new Error('Phone number is required');
    
    let cleaned = phone.replace(/\D/g, '');
    cleaned = cleaned.replace(/^0+/, '');
    
    if (!cleaned.startsWith('92') && cleaned.length === 10) {
      cleaned = '92' + cleaned;
    }
    
    if (cleaned.length !== 12) {
      throw new Error(`Invalid phone number: ${cleaned}`);
    }
    
    return cleaned + '@c.us';
  }

  async sendPaymentReminder(customerId) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) throw new Error('Customer not found');
      if (!customer.phone) throw new Error('Customer phone not found');

      const message = `💳 *Payment Reminder*

Dear ${customer.customerName},

Your payment for *${customer.packageName}* is due.

📦 Package: ${customer.packageName}
💰 Amount: Rs. ${customer.amount}
📅 Due Date: Day ${customer.billReceiveDate}

Please make payment to avoid service interruption.

Thank you!`;

      return await this.sendMessage(customer.phone, message);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async sendThankYouMessage(customerId, paymentDetails) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) throw new Error('Customer not found');

      const message = `✅ *Payment Received - Thank You!*

Dear ${customer.customerName},

Thank you for your payment!

📦 Package: ${customer.packageName}
💰 Amount: Rs. ${paymentDetails.amount}
💳 Method: ${paymentDetails.method}
📄 Transaction ID: ${paymentDetails.transactionId}

Your payment has been processed successfully.

We appreciate your business!`;

      return await this.sendMessage(customer.phone, message);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async sendCustomerMessage(customerId, message) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) throw new Error('Customer not found');
      if (!customer.phone) throw new Error('Customer phone not found');

      return await this.sendMessage(customer.phone, message);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async sendExpiryReminder(customerId) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) throw new Error('Customer not found');

      const message = `⚠️ *Service Expiry Reminder*

Dear ${customer.customerName},

Your *${customer.packageName}* service will expire soon.

📦 Package: ${customer.packageName}
📅 Expiry Date: Day ${customer.billReceiveDate}

Please renew your package to avoid service disruption.

Thank you for choosing us!`;

      return await this.sendMessage(customer.phone, message);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async clearSession() {
    try {
      this.stopHealthChecks();
      
      if (this.client) {
        await this.client.destroy();
      }
      
      const sessionDir = path.join(this.sessionPath, 'render-client');
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log('✅ Session directory cleared');
      }
      
      this.isReady = false;
      this.currentQR = null;
      this.initializationAttempts = 0;
      this.notifyStatusUpdate();
      
      return { success: true, message: 'Session cleared successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async restartService() {
    console.log('🔄 Restarting WhatsApp service...');
    await this.clearSession();
    setTimeout(() => {
      this.init();
    }, 5000);
    return { success: true, message: 'Service restart initiated' };
  }

  async regenerateQR() {
    try {
      await this.clearSession();
      setTimeout(() => {
        this.init();
      }, 3000);
      return { success: true, message: 'QR regeneration initiated' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  getStatus() {
    return {
      isReady: this.isReady,
      isConnected: this.isReady,
      hasQR: !!this.currentQR,
      timestamp: new Date().toISOString(),
      initializationAttempts: this.initializationAttempts,
      lastActivity: this.lastActivity,
      isInitializing: this.isInitializing
    };
  }

  getCurrentQR() {
    return this.currentQR;
  }

  onStatusUpdate(callback) {
    this.statusListeners.push(callback);
  }

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

  // Cleanup on destruction
  destroy() {
    this.stopHealthChecks();
    if (this.client) {
      this.client.destroy();
    }
  }
}

module.exports = new WhatsAppService();