
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

// Google Auth Controller
const { googleSignIn } = require("../controllers/googleAuth.controller");

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

// Refresh Token (contract alias /refresh + legacy /refresh-token)
router.post(
  "/refresh-token",
  refreshTokenController
);
router.post(
  "/refresh",
  refreshTokenController
);

// Google Sign-In (Contract compliant)
router.post(
  "/google",
  googleSignIn
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

// Email Verification (contract alias /otp/request & /otp/verify + legacy)
router.post(
  "/send-verification-otp",
  sendVerificationOTP
);
router.post(
  "/otp/request",
  sendVerificationOTP
);

router.post(
  "/verify-email",
  verifyEmailValidation,
  validateRequest,
  verifyEmail
);
router.post(
  "/otp/verify",
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
