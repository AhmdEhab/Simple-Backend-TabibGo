const express = require("express");
const cors = require("cors");
const path = require("path");

require("dotenv").config();

const connectDB = require("./config/database");
const authRoutes = require("./routes/auth.routes");
const profileRoutes = require("./routes/profile.routes");
const documentRoutes = require("./routes/document.routes");
const providerApplicationRoutes = require("./routes/providerApplication.routes");
const internalReviewRoutes = require("./routes/internalReview.routes");
const serviceRoutes = require("./routes/service.routes");
const serviceRequestRoutes = require("./routes/serviceRequest.routes");
const uploadRoutes = require("./routes/upload.routes");
const patientRoutes = require("./routes/patient.routes");
const providerRoutes = require("./routes/provider.routes");
const catalogRoutes = require("./routes/catalog.routes");
const bookingRoutes = require("./routes/booking.routes");
const requestRoutes = require("./routes/request.routes");
const notificationRoutes = require("./routes/notification.routes");
const publicProviderRoutes = require("./routes/publicProvider.routes");
const { seedInitialProfessions } = require("./services/profile.service");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "../storage/documents")));

// Existing Routes (preserved for full backward compatibility)
app.use("/api/auth", authRoutes);
app.use("/api/profiles", profileRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/provider-applications", providerApplicationRoutes);
app.use("/api/internal/reviews", internalReviewRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/service-requests", serviceRequestRoutes);

// New Contract Routes
app.use("/api/uploads", uploadRoutes);
app.use("/api/patient", patientRoutes);
app.use("/api/provider", providerRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/requests", requestRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/providers", publicProviderRoutes);

// Health check / Test Route
app.get("/", (req, res) => {
  res.status(200).json({
    message: "TabibiGo Backend is Running!"
  });
});

// Central 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Resource not found."
  });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err);
  const status = err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: err.message || "Internal server error."
  });
});

const startServer = async () => {
  await connectDB();
  await seedInitialProfessions();

  const PORT = process.env.PORT || 5000;

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

// Export app for test suites
module.exports = { app, startServer };

// Auto-start when executed directly
if (require.main === module) {
  startServer();
}
