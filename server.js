// server.js
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');

dotenv.config();

// Initialize Express app first
const app = express();
app.use(cors());
app.use(express.json());

// Basic health check route
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    message: 'ISP OS Backend is running'
  });
});

// Connect to MongoDB with better error handling
connectDB().then(() => {
  console.log('✅ MongoDB connection established');
}).catch(error => {
  console.error('❌ MongoDB connection failed:', error);
  process.exit(1);
});

// Import routes after DB connection
app.use('/api/customers', require('./routes/customerRoutes'));
app.use('/api/bills', require('./routes/billRoutes'));
app.use('/api/billstatuses', require('./routes/billStatusRoutes'));
app.use('/api/packages', require('./routes/packageRoutes'));
app.use('/api/counters', require('./routes/counterRoutes'));
app.use('/api/whatsapp', require('./routes/whatsappRoutes'));

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('🚨 Server Error:', error);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});