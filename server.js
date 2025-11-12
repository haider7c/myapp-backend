const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');

dotenv.config();
connectDB();

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/customers', require('./routes/customerRoutes'));
app.use('/api/bills', require('./routes/billRoutes'));
app.use('/api/billstatuses', require('./routes/billStatusRoutes'));
app.use('/api/packages', require('./routes/packageRoutes'));
app.use('/api/manualbills', require('./routes/manualBillRoutes'));
app.use('/api/counters', require('./routes/counterRoutes'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
