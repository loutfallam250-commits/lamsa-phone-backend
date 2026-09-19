const mongoose = require("mongoose");

let isConnected = false;
let pendingConnection = null;

const connectDB = async () => {
  // If already connected and healthy, return immediately
  if (isConnected && mongoose.connection.readyState === 1) return;
  
  // If connection is in progress, wait for it
  if (pendingConnection) return pendingConnection;
  
  // Set mongoose options to avoid deprecation warnings and optimize for serverless
  mongoose.set('strictQuery', false);
  
  pendingConnection = (async () => {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        maxIdleTimeMS: 30000,
        // Optimize for serverless - close idle connections faster
        heartbeatFrequencyMS: 10000,
      });
      isConnected = true;
      console.log("MongoDB connected");
    } catch (err) {
      isConnected = false;
      console.error("MongoDB connection error:", err.message);
      throw err;
    } finally {
      pendingConnection = null;
    }
  })();
  
  return pendingConnection;
};

// Handle connection events for better monitoring
mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.log('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  isConnected = false;
  console.error('MongoDB connection error:', err);
});

module.exports = connectDB;
