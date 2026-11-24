const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const RefreshToken = require("../models/RefreshToken");

const getAccessTokenSecret = () => process.env.JWT_ACCESS_SECRET || "default_access_secret_change_in_production";
const getRefreshTokenSecret = () => process.env.JWT_REFRESH_SECRET || "default_refresh_secret_change_in_production";
const getAccessTokenExpiry = () => process.env.JWT_ACCESS_EXPIRY || "15m";
const getRefreshTokenExpiry = () => process.env.JWT_REFRESH_EXPIRY || "7d";

// Parse duration string like '7d', '15m', '24h' to milliseconds
const parseDurationMs = (durationStr) => {
  if (typeof durationStr === "number") return durationStr;
  const match = String(durationStr).trim().match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days
  const val = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s": return val * 1000;
    case "m": return val * 60 * 1000;
    case "h": return val * 60 * 60 * 1000;
    case "d": return val * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
};

const hashToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

/**
 * Generate Access Token (JWT)
 */
const generateAccessToken = (user) => {
  const payload = {
    userId: user._id.toString(),
    role: user.role,
    email: user.email
  };

  return jwt.sign(payload, getAccessTokenSecret(), {
    expiresIn: getAccessTokenExpiry()
  });
};

/**
 * Generate Refresh Token (random string) and save record in RefreshToken collection
 */
const generateRefreshToken = async (user) => {
  const rawToken = crypto.randomBytes(40).toString("hex");
  const tokenHash = hashToken(rawToken);

  const durationMs = parseDurationMs(getRefreshTokenExpiry());
  const expiresAt = new Date(Date.now() + durationMs);

  await RefreshToken.create({
    userId: user._id,
    tokenHash,
    expiresAt
  });

  return rawToken;
};

/**
 * Verify Access Token
 */
const verifyAccessToken = (token) => {
  return jwt.verify(token, getAccessTokenSecret());
};

/**
 * Rotate Refresh Token:
 * Validates the raw refresh token, revokes it, and issues a new access token & new refresh token
 */
const rotateRefreshToken = async (rawRefreshToken) => {
  if (!rawRefreshToken) {
    const error = new Error("Refresh token is required.");
    error.statusCode = 400;
    throw error;
  }

  const tokenHash = hashToken(rawRefreshToken);
  const now = new Date();

  // Find token by hash, not revoked and not expired
  const tokenRecord = await RefreshToken.findOne({
    tokenHash,
    revokedAt: null,
    expiresAt: { $gt: now }
  }).populate("userId");

  if (!tokenRecord || !tokenRecord.userId) {
    const error = new Error("Invalid or expired refresh token.");
    error.statusCode = 401;
    throw error;
  }

  const user = tokenRecord.userId;

  if (!user.isActive) {
    const error = new Error("Your account is inactive.");
    error.statusCode = 403;
    throw error;
  }

  // Revoke current token (rotation)
  tokenRecord.revokedAt = now;
  await tokenRecord.save();

  // Issue new access and refresh tokens
  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = await generateRefreshToken(user);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified
    }
  };
};

/**
 * Revoke Refresh Token on logout
 */
const revokeRefreshToken = async (rawRefreshToken) => {
  if (!rawRefreshToken) {
    return false;
  }

  const tokenHash = hashToken(rawRefreshToken);
  const now = new Date();

  await RefreshToken.findOneAndUpdate(
    {
      tokenHash,
      revokedAt: null
    },
    {
      $set: { revokedAt: now }
    }
  );

  return true;
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  rotateRefreshToken,
  revokeRefreshToken,
  hashToken
};
