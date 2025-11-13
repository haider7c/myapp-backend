// services/whatsappService.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const Customer = require('../models/Customer');

class WhatsAppService {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.currentQR = null;
    this.init();
  }

  init() {
    try {
      console.log('🔄 Initializing WhatsApp client...');
      
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: "whatsapp-mobile-client"
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
            '--disable-gpu'
          ]
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        }
      });

      // QR Code Handler
      this.client.on('qr', (qr) => {
        console.log('📱 WhatsApp QR Code received');
        this.currentQR = qr;
        
        // Generate terminal QR
        qrcode.generate(qr, { small: true });
        console.log('Scan the QR code above with WhatsApp');
      });

      this.client.on('ready', () => {
        console.log('✅ WhatsApp client is ready!');
        this.isReady = true;
        this.currentQR = null;
      });

      this.client.on('authenticated', () => {
        console.log('✅ WhatsApp client authenticated!');
      });

      this.client.on('auth_failure', (msg) => {
        console.error('❌ WhatsApp authentication failed:', msg);
        this.isReady = false;
      });

      this.client.on('disconnected', (reason) => {
        console.log('❌ WhatsApp client disconnected:', reason);
        this.isReady = false;
        this.currentQR = null;
        
        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
          console.log('🔄 Attempting to reconnect WhatsApp...');
          this.destroyClient();
          this.init();
        }, 5000);
      });

      this.client.initialize().then(() => {
        console.log('✅ WhatsApp client initialization started');
      }).catch(error => {
        console.error('❌ WhatsApp client initialization failed:', error);
      });

    } catch (error) {
      console.error('❌ Failed to initialize WhatsApp client:', error);
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
      
      if (result.success) {
        console.log(`✅ Payment reminder sent to ${customer.customerName}`);
      } else {
        console.log(`❌ Failed to send payment reminder to ${customer.customerName}: ${result.error}`);
      }
      
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
      
      if (result.success) {
        console.log(`✅ Thank you message sent to ${customer.customerName}`);
      } else {
        console.log(`❌ Failed to send thank you message to ${customer.customerName}: ${result.error}`);
      }
      
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
      
      if (result.success) {
        console.log(`✅ Custom message sent to ${customer.customerName}`);
      } else {
        console.log(`❌ Failed to send custom message to ${customer.customerName}: ${result.error}`);
      }
      
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

  // Get status
  getStatus() {
    return {
      isReady: this.isReady,
      isConnected: this.isReady,
      hasQR: !!this.currentQR
    };
  }

  // Get current QR code
  getCurrentQR() {
    return this.currentQR;
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
      
      // Reinitialize after a short delay
      setTimeout(() => {
        this.init();
      }, 2000);
      
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
      } catch (error) {
        console.error('Error destroying client:', error);
      }
    }
  }
}

// Create singleton instance
const whatsappService = new WhatsAppService();
module.exports = whatsappService;