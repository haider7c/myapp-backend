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
    
    this.ensureSessionDirectory();
    
    // Start with delay for server stability
    setTimeout(() => {
      this.init();
    }, 8000);
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
    if (this.initializationAttempts >= this.maxInitializationAttempts) {
      console.log('ℹ️  Max initialization attempts reached');
      return;
    }

    this.initializationAttempts++;
    console.log(`🔄 Initializing WhatsApp (attempt ${this.initializationAttempts})`);

    try {
      // Clean up previous client
      if (this.client) {
        try {
          await this.client.destroy();
        } catch (error) {
          console.log('⚠️  Cleaning previous client:', error.message);
        }
      }

      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: "render-client",
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
            '--disable-extensions'
          ],
          timeout: 60000
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        }
      });

      this.setupEventHandlers();
      await this.client.initialize();
      
    } catch (error) {
      console.error('❌ WhatsApp initialization failed:', error.message);
      this.handleInitError(error);
    }
  }

  setupEventHandlers() {
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
      this.notifyStatusUpdate();
    });

    this.client.on('authenticated', () => {
      console.log('✅ WhatsApp authenticated');
    });

    this.client.on('auth_failure', (msg) => {
      console.error('❌ WhatsApp auth failure:', msg);
      this.isReady = false;
      this.handleAuthFailure();
    });

    this.client.on('disconnected', (reason) => {
      console.log('❌ WhatsApp disconnected:', reason);
      this.isReady = false;
      this.handleDisconnection();
    });
  }

  handleInitError(error) {
    const delay = Math.min(30000, this.initializationAttempts * 10000);
    console.log(`⏳ Retrying in ${delay/1000} seconds...`);
    
    setTimeout(() => {
      this.init();
    }, delay);
  }

  handleAuthFailure() {
    setTimeout(() => {
      this.clearSession();
    }, 5000);
  }

  handleDisconnection() {
    const delay = 10000;
    console.log(`⏳ Attempting reconnect in ${delay/1000} seconds...`);
    
    setTimeout(() => {
      this.init();
    }, delay);
  }

  getStatus() {
    return {
      isReady: this.isReady,
      isConnected: this.isReady,
      hasQR: !!this.currentQR,
      timestamp: new Date().toISOString(),
      initializationAttempts: this.initializationAttempts
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

  async sendMessage(phone, message) {
    if (!this.isReady) {
      throw new Error('WhatsApp not ready. Please scan QR code.');
    }

    try {
      const formattedPhone = this.formatPhoneNumber(phone);
      const response = await this.client.sendMessage(formattedPhone, message);
      return { success: true, messageId: response.id._serialized };
    } catch (error) {
      return { success: false, error: error.message };
    }
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

  async clearSession() {
    try {
      if (this.client) {
        await this.client.destroy();
      }
      
      const sessionDir = path.join(this.sessionPath, 'render-client');
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
      
      this.isReady = false;
      this.currentQR = null;
      this.initializationAttempts = 0;
      this.notifyStatusUpdate();
      
      return { success: true, message: 'Session cleared' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async restartService() {
    await this.clearSession();
    setTimeout(() => {
      this.init();
    }, 5000);
    return { success: true, message: 'Restarting service' };
  }
}

module.exports = new WhatsAppService();