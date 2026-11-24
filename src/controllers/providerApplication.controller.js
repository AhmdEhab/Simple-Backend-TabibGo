const {
  createProviderApplication,
  getMyApplication
} = require("../services/providerApplication.service");

const createApplication = async (req, res) => {
  try {
    const {
      licenseNumber,
      licenseExpiry
    } = req.body;

    // 1. Validate required fields
    if (!licenseNumber || !licenseExpiry) {
      return res.status(400).json({
        success: false,
        message: "License number and expiry date are required."
      });
    }

    // 2. Validate expiry date format
    const expiryDate = new Date(licenseExpiry);

    if (Number.isNaN(expiryDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid license expiry date."
      });
    }

    // 3. Call service with authenticated user's ID
    const application = await createProviderApplication({
      userId: req.user._id,
      licenseNumber: licenseNumber.trim(),
      licenseExpiry: expiryDate
    });

    // 4. Send response
    return res.status(201).json({
      success: true,
      message: "Provider application submitted successfully.",
      data: {
        application
      }
    });

  } catch (error) {
    console.error("Create Application Error:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error.",
      details: error.details || undefined
    });
  }
};

const getApplicationStatus = async (req, res) => {
  try {
    const result = await getMyApplication(req.user._id);

    return res.status(200).json({
      success: true,
      message: "Application status retrieved successfully.",
      data: result
    });
  } catch (error) {
    console.error("Get Application Error:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

module.exports = {
  createApplication,
  getApplicationStatus
};
