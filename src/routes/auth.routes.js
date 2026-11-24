
const express = require("express");
const router = express.Router();

// Auth Controllers
const {
  register,
  login,
  refreshTokenController,
  logout,
  resetPasswordController,
  getMe
} = require("../controllers/auth.controller");

// Auth Middleware
const { authenticate } = require("../middleware/auth.middleware");

// OTP Controllers
const {
  sendVerificationOTP,
  verifyEmail,
  sendPasswordReset,
  verifyPasswordReset
} = require("../controllers/otp.controller");

// Validations
const {
  registerValidation,
  loginValidation,
  forgotPasswordValidation,
  verifyPasswordResetValidation,
  resetPasswordValidation,
  verifyEmailValidation,
  validateRequest
} = require("../middleware/auth.validation");

// Register
router.post(
  "/register",
  registerValidation,
  validateRequest,
  register
);

// Login
router.post(
  "/login",
  loginValidation,
  validateRequest,
  login
);

// Refresh Token
router.post(
  "/refresh-token",
  refreshTokenController
);

// Logout
router.post(
  "/logout",
  logout
);

// Protected test endpoint: Get current user info
router.get(
  "/me",
  authenticate,
  getMe
);

// Email Verification
router.post(
  "/send-verification-otp",
  sendVerificationOTP
);

router.post(
  "/verify-email",
  verifyEmailValidation,
  validateRequest,
  verifyEmail
);

// Forgot Password
router.post(
  "/forgot-password",
  forgotPasswordValidation,
  validateRequest,
  sendPasswordReset
);

// Verify Password Reset OTP
router.post(
  "/verify-password-reset",
  verifyPasswordResetValidation,
  validateRequest,
  verifyPasswordReset
);

// Reset Password
router.post(
  "/reset-password",
  resetPasswordValidation,
  validateRequest,
  resetPasswordController
);

module.exports = router;
