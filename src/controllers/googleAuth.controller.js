const jwt = require("jsonwebtoken");
const User = require("../models/User");
const PatientProfile = require("../models/PatientProfile");
const ProviderProfile = require("../models/ProviderProfile");
const { generateAccessToken, generateRefreshToken } = require("../services/token.service");

const PENDING_TOKEN_SECRET = process.env.JWT_PENDING_SECRET || process.env.JWT_ACCESS_SECRET || "default_pending_secret";

/**
 * Helper to decode and validate Google ID token payload
 */
const decodeGoogleToken = (idToken) => {
  if (!idToken) {
    const error = new Error("idToken is required.");
    error.statusCode = 400;
    throw error;
  }

  // Decode unverified or verified payload
  const decoded = jwt.decode(idToken);
  if (!decoded || !decoded.sub || !decoded.email) {
    const error = new Error("Invalid Google ID token structure.");
    error.statusCode = 400;
    throw error;
  }

  // App audience check if GOOGLE_CLIENT_ID configured
  const expectedAudience = process.env.GOOGLE_CLIENT_ID;
  if (expectedAudience && decoded.aud !== expectedAudience) {
    const error = new Error("Google token audience mismatch.");
    error.statusCode = 401;
    throw error;
  }

  if (decoded.email_verified !== true && decoded.email_verified !== "true") {
    const error = new Error("Google email must be verified.");
    error.statusCode = 403;
    throw error;
  }

  return {
    googleId: decoded.sub,
    email: decoded.email.toLowerCase().trim(),
    name: decoded.name || ""
  };
};

/**
 * POST /api/auth/google
 * Sign in or sign up with Google
 */
const googleSignIn = async (req, res, next) => {
  try {
    const { idToken, role } = req.body;
    const googlePayload = decodeGoogleToken(idToken);

    let user = await User.findOne({
      $or: [{ googleId: googlePayload.googleId }, { email: googlePayload.email }]
    });

    // 1. Existing user with verified email
    if (user) {
      if (!user.googleId) {
        user.googleId = googlePayload.googleId;
      }
      if (!user.emailVerified) {
        user.emailVerified = true;
      }
      await user.save();

      const accessToken = generateAccessToken(user);
      const refreshToken = await generateRefreshToken(user);

      return res.status(200).json({
        success: true,
        message: "Signed in with Google successfully.",
        data: {
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
        }
      });
    }

    // 2. New user registration: role is required
    if (!role) {
      return res.status(400).json({
        success: false,
        code: "ROLE_REQUIRED",
        message: "Role is required for new Google sign-up (patient or provider)."
      });
    }

    if (!["patient", "provider"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Must be 'patient' or 'provider'."
      });
    }

    // Create user immediately with verified Google email
    user = await User.create({
      email: googlePayload.email,
      googleId: googlePayload.googleId,
      role,
      emailVerified: true,
      isActive: true
    });

    // Automatically create corresponding initial profile
    if (role === "patient") {
      await PatientProfile.create({
        userId: user._id,
        fullName: googlePayload.name || "Google User"
      });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user);

    return res.status(201).json({
      success: true,
      message: "Google account registered and signed in successfully.",
      data: {
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
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  googleSignIn,
  PENDING_TOKEN_SECRET
};
