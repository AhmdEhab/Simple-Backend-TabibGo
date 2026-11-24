const dns = require("dns");
const mongoose = require("mongoose");

// Ensure robust public DNS resolution for Atlas SRV lookup
try {
  dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
} catch (e) {
  // Ignore if restricted
}

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: "TabibiGo-Users"
    });

    console.log("MongoDB Connected Successfully!");
  } catch (error) {
    console.error("MongoDB Connection Failed:");
    console.error(error.message);
    process.exit(1);
  }
};

module.exports = connectDB;