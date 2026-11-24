const User = require("../models/User");
const { verifyAccessToken } = require("../services/token.service");

/**
 * Authentication Middleware:
 * Extracts Bearer token from Authorization header, validates JWT,
 * verifies user existence and status, and attaches req.user.
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication token missing or invalid format."
      });
    }

    const token = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "Authentication token expired. Please refresh your token."
        });
      }
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token."
      });
    }

    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User account no longer exists."
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "User account is inactive."
      });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email address."
      });
    }

    // Attach trusted user object and convenience fields
    req.user = user;
    req.userId = user._id;
    req.userRole = user.role;

    next();
  } catch (error) {
    console.error("Auth Middleware Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error during authentication."
    });
  }
};

/**
 * Role-Based Authorization Middleware:
 * Ensures the authenticated user has one of the allowed roles.
 * Usage: authorizeRoles("provider") or authorizeRoles("patient", "provider")
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access forbidden: insufficient permissions."
      });
    }
    next();
  };
};

module.exports = {
  authenticate,
  authorizeRoles
};
