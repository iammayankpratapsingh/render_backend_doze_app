const mongoose = require("mongoose");
require("dotenv").config();

const connectDB = async () => {
  try {
    // Remove deprecated options (not needed in Mongoose 6+)
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB Connected");
  } catch (error) {
    console.error("MongoDB Connection Failed:", error);
    console.error("Connection String:", process.env.MONGO_URI ? "Set (hidden)" : "NOT SET");
    console.error("Trying to connect to:", process.env.MONGO_URI?.match(/mongodb:\/\/([^:]+):(\d+)/)?.[0] || "Unknown");
    process.exit(1);
  }
};

module.exports = connectDB;
