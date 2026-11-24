const {
  registerUser,
  loginUser,
  refreshAuthToken,
  logoutUser,
  resetPassword: resetPasswordService
} = require("../services/auth.service");

// Register
const register = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    const user = await registerUser({
      email,
      password,
      role
    });

    return res.status(201).json({
      success: true,
      message: "Account created successfully. Please verify your email.",
      data: {
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          emailVerified: user.emailVerified
        }
      }
    });

  } catch (error) {
    console.error("Register Error:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await loginUser({
      email,
      password
    });

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      data: result
    });

  } catch (error) {
    console.error("Login Error:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Refresh Token
const refreshTokenController = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    const result = await refreshAuthToken(refreshToken);

    return res.status(200).json({
      success: true,
      message: "Token refreshed successfully.",
      data: result
    });
  } catch (error) {
    console.error("Refresh Token Error:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Logout
const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    await logoutUser(refreshToken);

    return res.status(200).json({
      success: true,
      message: "Logged out successfully."
    });
  } catch (error) {
    console.error("Logout Error:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Reset Password
const resetPasswordController = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    await resetPasswordService({
      resetToken,
      newPassword
    });

    return res.status(200).json({
      success: true,
      message: "Password reset successfully."
    });

  } catch (error) {
    console.error("Reset Password Error:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Get current user (protected verification endpoint)
const getMe = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      message: "User profile retrieved successfully.",
      data: {
        user: {
          id: req.user._id,
          email: req.user.email,
          role: req.user.role,
          emailVerified: req.user.emailVerified,
          isActive: req.user.isActive,
          createdAt: req.user.createdAt
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error."
    });
  }
};

module.exports = {
  register,
  login,
  refreshTokenController,
  logout,
  resetPasswordController,
  getMe
};
