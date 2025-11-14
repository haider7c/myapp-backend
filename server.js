const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Enhanced health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    service: 'ISP OS Backend',
    version: '1.0.0'
  });
});

// Connect to MongoDB with retry logic
const connectWithRetry = async () => {
  try {
    await connectDB();
    console.log('✅ MongoDB connection established');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    console.log('🔄 Retrying in 5 seconds...');
    setTimeout(connectWithRetry, 5000);
  }
};

connectWithRetry();

// Import routes
app.use('/api/customers', require('./routes/customerRoutes'));
app.use('/api/bills', require('./routes/billRoutes'));
app.use('/api/billstatuses', require('./routes/billStatusRoutes'));
app.use('/api/packages', require('./routes/packageRoutes'));
app.use('/api/counters', require('./routes/counterRoutes'));
app.use('/api/whatsapp', require('./routes/whatsappRoutes'));

// Enhanced error handling middleware
app.use((error, req, res, next) => {
  console.error('🚨 Server Error:', error);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl
  });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown with cleanup
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  // Cleanup WhatsApp service
  const whatsappService = require('./services/whatsappService');
  whatsappService.destroy();
  
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  
  // Cleanup WhatsApp service
  const whatsappService = require('./services/whatsappService');
  whatsappService.destroy();
  
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('🆘 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🆘 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});