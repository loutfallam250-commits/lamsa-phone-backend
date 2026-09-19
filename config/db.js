const mongoose = require("mongoose");

let isConnected = false;
let pendingConnection = null;

const connectDB = async () => {
  if (isConnected && mongoose.connection.readyState === 1) return;
  if (pendingConnection) return pendingConnection;
  pendingConnection = (async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
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

module.exports = connectDB;
