const {
  upsertPatientProfile,
  upsertProviderProfile,
  getProfileByUserId,
  updateProfile,
  getActiveProfessions
} = require("../services/profile.service");

// Complete Patient Profile
const completePatientProfile = async (req, res) => {
  try {
    if (req.user.role !== "patient") {
      return res.status(403).json({
        success: false,
        message: "Only patients can complete a patient profile."
      });
    }

    const profile = await upsertPatientProfile(req.user._id, req.body);

    return res.status(200).json({
      success: true,
      message: "Patient profile saved successfully.",
      data: { profile }
    });
  } catch (error) {
    console.error("Patient Profile Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Complete Provider Profile
const completeProviderProfile = async (req, res) => {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({
        success: false,
        message: "Only providers can complete a provider profile."
      });
    }

    const profile = await upsertProviderProfile(req.user._id, req.body);

    return res.status(200).json({
      success: true,
      message: "Provider profile saved successfully.",
      data: { profile }
    });
  } catch (error) {
    console.error("Provider Profile Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Get My Profile
const getMyProfile = async (req, res) => {
  try {
    const data = await getProfileByUserId(req.user);

    if (!data.profile) {
      return res.status(404).json({
        success: false,
        message: "Profile not found. Please complete your profile first.",
        data
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile retrieved successfully.",
      data
    });
  } catch (error) {
    console.error("Get Profile Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Update My Profile
const updateMyProfile = async (req, res) => {
  try {
    const profile = await updateProfile(req.user, req.body);

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: { profile }
    });
  } catch (error) {
    console.error("Update Profile Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Get Available Professions
const listProfessions = async (req, res) => {
  try {
    const professions = await getActiveProfessions();

    return res.status(200).json({
      success: true,
      message: "Professions retrieved successfully.",
      data: { professions }
    });
  } catch (error) {
    console.error("List Professions Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error."
    });
  }
};

module.exports = {
  completePatientProfile,
  completeProviderProfile,
  getMyProfile,
  updateMyProfile,
  listProfessions
};
