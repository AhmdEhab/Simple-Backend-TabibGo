
const User = require("../models/User");
const crypto = require("crypto");
const OTPCode = require("../models/OTPCode");
const {
  generateAccessToken,
  generateRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken
} = require("./token.service");

// Register User
const registerUser = async ({ email, password, role }) => {
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    const error = new Error("Email is already registered.");
    error.statusCode = 409;
    throw error;
  }

  const user = await User.create({
    email,
    password,
    role,
    emailVerified: false
  });

  return user;
};

// Login User
const loginUser = async ({ email, password }) => {
  // 1. Find user and include password
  const user = await User.findOne({ email }).select("+password");

  if (!user) {
    const error = new Error("Invalid email or password.");
    error.statusCode = 401;
    throw error;
  }

  // 2. Check email verification
  if (!user.emailVerified) {
    const error = new Error("Please verify your email first.");
    error.statusCode = 403;
    throw error;
  }

  // 3. Check account status
  if (!user.isActive) {
    const error = new Error("Your account is inactive.");
    error.statusCode = 403;
    throw error;
  }

  // 4. Compare password
  const isPasswordMatch = await user.comparePassword(password);

  if (!isPasswordMatch) {
    const error = new Error("Invalid email or password.");
    error.statusCode = 401;
    throw error;
  }

  // 5. Generate Access & Refresh tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = await generateRefreshToken(user);

  return {
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified
    },
    tokens: {
      accessToken,
      refreshToken
    }
  };
};

const refreshAuthToken = async (refreshToken) => {
  return rotateRefreshToken(refreshToken);
};

const logoutUser = async (refreshToken) => {
  return revokeRefreshToken(refreshToken);
};

const resetPassword = async ({ resetToken, newPassword }) => {
  // 1. Hash the received reset token
  const resetTokenHash = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  const now = new Date();

  // 2. Find and consume the reset token
  const otpRecord = await OTPCode.findOneAndUpdate(
    {
      resetTokenHash,
      resetTokenExpiresAt: { $gt: now },
      resetCompletedAt: null
    },
    {
      $set: {
        resetCompletedAt: now
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!otpRecord) {
    const error = new Error("Invalid or expired reset token.");
    error.statusCode = 400;
    throw error;
  }

  // 3. Find the user
  const user = await User.findOne({
    email: otpRecord.email
  });

  if (!user) {
    const error = new Error("User not found.");
    error.statusCode = 404;
    throw error;
  }

  // 4. Update password
  user.password = newPassword;
  await user.save();

  return true;
};

module.exports = {
  registerUser,
  loginUser,
  refreshAuthToken,
  logoutUser,
  resetPassword
};
