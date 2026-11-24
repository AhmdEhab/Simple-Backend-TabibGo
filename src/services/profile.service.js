const PatientProfile = require("../models/PatientProfile");
const ProviderProfile = require("../models/ProviderProfile");
const Profession = require("../models/Profession");
const User = require("../models/User");
const { ProviderVerification } = require("../models/ProviderVerification");
const { DocumentAuditLog } = require("../models/DocumentAuditLog");

/**
 * Seed initial active professions if not existing (e.g. Nurse, Physical Therapist)
 */
const seedInitialProfessions = async () => {
  const initialProfessions = [
    { name: "Nurse", description: "Registered or licensed nurse providing care", isActive: true },
    { name: "Physical Therapist", description: "Licensed physical therapy specialist", isActive: true }
  ];

  for (const prof of initialProfessions) {
    await Profession.findOneAndUpdate(
      { name: prof.name },
      { $setOnInsert: prof },
      { upsert: true, new: true }
    );
  }
};

/**
 * Get all active professions
 */
const getActiveProfessions = async () => {
  return Profession.find({ isActive: true }).select("_id name description");
};

/**
 * Create or complete Patient Profile
 */
const upsertPatientProfile = async (userId, profileData) => {
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error("User not found.");
    error.statusCode = 404;
    throw error;
  }

  if (user.role !== "patient") {
    const error = new Error("User role is not patient.");
    error.statusCode = 403;
    throw error;
  }

  const { fullName, dateOfBirth, gender, location, healthInfo } = profileData;
  const existingProfile = await PatientProfile.findOne({ userId });

  if (!existingProfile && (!fullName || typeof fullName !== "string" || !fullName.trim())) {
    const error = new Error("Full name is required.");
    error.statusCode = 400;
    throw error;
  }

  const updateFields = {};
  if (fullName) updateFields.fullName = fullName.trim();
  if (dateOfBirth) updateFields.dateOfBirth = new Date(dateOfBirth);
  if (gender) updateFields.gender = gender;
  if (location) updateFields.location = location;
  if (healthInfo) updateFields.healthInfo = healthInfo;

  const profile = await PatientProfile.findOneAndUpdate(
    { userId },
    {
      $set: updateFields,
      $setOnInsert: { userId, identityStatus: "none" }
    },
    { upsert: true, returnDocument: "after", runValidators: true }
  );

  return profile;
};

/**
 * Create or complete Provider Profile
 */
const upsertProviderProfile = async (userId, profileData) => {
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error("User not found.");
    error.statusCode = 404;
    throw error;
  }

  if (user.role !== "provider") {
    const error = new Error("User role is not provider.");
    error.statusCode = 403;
    throw error;
  }

  const {
    fullName,
    professionId,
    bio,
    yearsOfExperience,
    education,
    certifications,
    serviceArea,
    availability,
    baseLocation
  } = profileData;

  // Check if profile already exists
  const existingProfile = await ProviderProfile.findOne({ userId });

  // Security Check: If the provider is already approved, prevent silent unvetted modification of core credentials
  // Changing professionId or education requires administrative re-verification
  if (existingProfile && existingProfile.isApproved) {
    const isChangingProfession = professionId && existingProfile.professionId && professionId.toString() !== existingProfile.professionId.toString();
    const isChangingEducation = education && JSON.stringify(education) !== JSON.stringify(existingProfile.education);

    if (isChangingProfession || isChangingEducation) {
      // Automatically reset isApproved and flag verification stages for re-verification
      existingProfile.isApproved = false;
      await existingProfile.save();

      // Reset verification stages
      await ProviderVerification.findOneAndUpdate(
        { providerId: existingProfile._id },
        {
          $set: {
            overallStatus: "in_progress",
            "licenseVerification.status": "requires_action",
            "licenseVerification.reviewNotes": "Re-verification required: Provider updated core professional credentials/education."
          }
        }
      );

      // Audit log the status transition
      await DocumentAuditLog.create({
        targetType: "application",
        targetId: existingProfile._id,
        userId: user._id,
        action: "verification_stage_updated",
        previousStatus: "approved",
        newStatus: "requires_action",
        actorType: "system",
        actorId: "system_credential_monitor",
        reason: "Core professional credentials modified by provider; approval status revoked pending administrative re-verification."
      });
    }
  }

  // If new profile or updating professionId, validate profession
  let targetProfessionId = professionId || (existingProfile ? existingProfile.professionId : null);

  let professionDoc = null;
  if (targetProfessionId) {
    // Validate profession exists and is active
    professionDoc = await Profession.findOne({
      _id: targetProfessionId,
      isActive: true
    });

    if (!professionDoc) {
      const error = new Error("Invalid or inactive profession selected.");
      error.statusCode = 400;
      throw error;
    }
  } else if (!existingProfile) {
    const error = new Error("Profession ID is required.");
    error.statusCode = 400;
    throw error;
  }

  if (!existingProfile && (!fullName || typeof fullName !== "string" || !fullName.trim())) {
    const error = new Error("Full name is required.");
    error.statusCode = 400;
    throw error;
  }

  const updateFields = {};
  if (fullName) updateFields.fullName = fullName.trim();
  if (professionDoc) updateFields.professionId = professionDoc._id;
  if (bio !== undefined) updateFields.bio = bio;
  if (yearsOfExperience !== undefined) updateFields.yearsOfExperience = yearsOfExperience;
  if (education !== undefined) updateFields.education = education;
  if (certifications !== undefined) updateFields.certifications = certifications;
  if (serviceArea !== undefined) updateFields.serviceArea = serviceArea;
  if (availability !== undefined) updateFields.availability = availability;
  if (baseLocation && baseLocation.type === "Point" && Array.isArray(baseLocation.coordinates) && baseLocation.coordinates.length === 2) {
    updateFields.baseLocation = baseLocation;
  }

  const profile = await ProviderProfile.findOneAndUpdate(
    { userId },
    {
      $set: updateFields,
      $setOnInsert: { userId, isApproved: false }
    },
    { upsert: true, returnDocument: "after", runValidators: true }
  ).populate("professionId", "name description");

  return profile;
};

/**
 * Get profile for authenticated user
 */
const getProfileByUserId = async (user) => {
  if (user.role === "patient") {
    const profile = await PatientProfile.findOne({ userId: user._id });
    return {
      role: "patient",
      user: {
        id: user._id,
        email: user.email,
        emailVerified: user.emailVerified
      },
      profile
    };
  } else if (user.role === "provider") {
    const profile = await ProviderProfile.findOne({ userId: user._id }).populate("professionId", "name description");
    return {
      role: "provider",
      user: {
        id: user._id,
        email: user.email,
        emailVerified: user.emailVerified
      },
      profile
    };
  } else {
    const error = new Error("Unknown user role.");
    error.statusCode = 400;
    throw error;
  }
};

/**
 * Update current profile (handles both roles safely based on req.user)
 */
const updateProfile = async (user, profileData) => {
  if (user.role === "patient") {
    return upsertPatientProfile(user._id, profileData);
  } else if (user.role === "provider") {
    return upsertProviderProfile(user._id, profileData);
  } else {
    const error = new Error("Invalid user role.");
    error.statusCode = 400;
    throw error;
  }
};

module.exports = {
  seedInitialProfessions,
  getActiveProfessions,
  upsertPatientProfile,
  upsertProviderProfile,
  getProfileByUserId,
  updateProfile
};
