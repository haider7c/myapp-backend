const mongoose = require('mongoose');

const MAX_RETRIES = 5;
const INITIAL_DELAY_MS = 2000; // 2s, doubling each attempt: 2s, 4s, 8s, 16s, 32s

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Atlas's mongodb+srv:// connection strings resolve their host list via a
// DNS SRV lookup at connect time. That lookup occasionally fails
// transiently (e.g. ESERVFAIL) even when Atlas and the network are otherwise
// fine. A single failure used to be fatal (process.exit(1) immediately),
// forcing PM2 to restart the whole process and hope the next attempt got
// luckier DNS. Retrying the connection itself first is faster and avoids an
// unnecessary full process restart on every transient hiccup.
const connectDB = async () => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        // Previously left at the driver defaults (serverSelectionTimeoutMS:
        // 30000ms) -- every query issued while the connection was mid-drop
        // silently buffered and waited up to 30s before failing, which is
        // exactly what "backend is slow / data not fetching" looks like
        // from the app side. Failing faster surfaces a clear error instead
        // of a long hang, and a shorter heartbeat detects a drop sooner so
        // reconnection starts sooner too.
        serverSelectionTimeoutMS: 8000,
        socketTimeoutMS: 20000,
        heartbeatFrequencyMS: 5000,
      });
      console.log('✅ MongoDB connected');
      return;
    } catch (error) {
      console.error(
        `❌ MongoDB connection failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`,
      );

      if (attempt === MAX_RETRIES) {
        console.error('❌ MongoDB connection failed after all retries. Exiting.');
        process.exit(1);
      }

      const waitMs = INITIAL_DELAY_MS * 2 ** (attempt - 1);
      console.log(`   Retrying in ${waitMs / 1000}s...`);
      await delay(waitMs);
    }
  }
};

// Once connected, keep watching the connection so transient drops (not just
// a failed initial connect) are visible in the logs instead of silently
// causing buffered-query timeouts later on.
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected. Mongoose will attempt to reconnect automatically.');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err.message);
});

module.exports = connectDB;
