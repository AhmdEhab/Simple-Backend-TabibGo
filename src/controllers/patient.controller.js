const PatientProfile = require("../models/PatientProfile");
const PatientVerification = require("../models/PatientVerification");
const User = require("../models/User");
const { UserDocument } = require("../models/UserDocument");
const { PATIENT_DOCUMENTS_CONFIG } = require("../config/documentRequirements");

/**
 * Calculate patient profile completeness and eligibility
 */
const evaluatePatientCompleteness = async (profile, userId) => {
  const missingFields = [];
  if (!profile.fullName || !profile.fullName.trim()) missingFields.push("fullName");
  if (!profile.dateOfBirth) missingFields.push("dateOfBirth");
  if (!profile.gender) missingFields.push("gender");
  if (!profile.location || !profile.location.governorate) missingFields.push("location.governorate");
  if (!profile.location || !profile.location.city) missingFields.push("location.city");

  const totalRequired = 5;
  const filledCount = totalRequired - missingFields.length;
  const completeness = Math.round((filledCount / totalRequired) * 100);

  // Identity verification check
  const isIdentityVerified = profile.identityStatus === "verified";

  // Check required documents (if any)
  const requiredPatientRules = PATIENT_DOCUMENTS_CONFIG.filter((r) => r.required);
  const activeDocs = await UserDocument.find({
    userId,
    isActiveVersion: true,
    status: "approved"
  });
  const approvedTypes = new Set(activeDocs.map((d) => d.documentType));
  const hasRequiredDocs = requiredPatientRules.every((r) => approvedTypes.has(r.type));

  const bookingEligible = missingFields.length === 0 && (isIdentityVerified || hasRequiredDocs);

  return {
    completeness,
    missingFields,
    identityStatus: profile.identityStatus || "none",
    bookingEligible
  };
};

/**
 * GET /api/patient/profile
 */
const getPatientProfile = async (req, res, next) => {
  try {
    let profile = await PatientProfile.findOne({ userId: req.user.id });

    // Auto-create initial profile if not yet created (contract rule)
    if (!profile) {
      profile = await PatientProfile.create({
        userId: req.user.id,
        fullName: req.user.email.split("@")[0]
      });
    }

    const evaluation = await evaluatePatientCompleteness(profile, req.user.id);

    res.status(200).json({
      success: true,
      data: {
        profile,
        ...evaluation
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/patient/profile
 * Partial update with age check and profile locking after identity verification
 */
const updatePatientProfile = async (req, res, next) => {
  try {
    const { fullName, dateOfBirth, gender, location, healthInfo } = req.body;
    let profile = await PatientProfile.findOne({ userId: req.user.id });

    if (!profile) {
      profile = await PatientProfile.create({
        userId: req.user.id,
        fullName: fullName || req.user.email.split("@")[0]
      });
    }

    // Rule: Profile locked after identity is verified (fullName and dateOfBirth cannot be changed)
    const isVerified = profile.identityStatus === "verified";
    if (isVerified) {
      if (fullName && fullName.trim() !== profile.fullName) {
        return res.status(400).json({
          success: false,
          code: "PROFILE_LOCKED",
          message: "Full name is locked and cannot be modified after identity verification."
        });
      }
      if (dateOfBirth && new Date(dateOfBirth).getTime() !== new Date(profile.dateOfBirth).getTime()) {
        return res.status(400).json({
          success: false,
          code: "PROFILE_LOCKED",
          message: "Date of birth is locked and cannot be modified after identity verification."
        });
      }
    }

    // Rule: dateOfBirth must make the patient 16 or older (UNDER_MINIMUM_AGE)
    if (dateOfBirth) {
      const dob = new Date(dateOfBirth);
      if (isNaN(dob.getTime())) {
        const error = new Error("Invalid dateOfBirth format.");
        error.statusCode = 400;
        throw error;
      }
      const now = new Date();
      let age = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
        age--;
      }
      if (age < 16) {
        return res.status(400).json({
          success: false,
          code: "UNDER_MINIMUM_AGE",
          message: "Patient must be at least 16 years of age."
        });
      }
      profile.dateOfBirth = dob;
    }

    if (fullName !== undefined && !isVerified) profile.fullName = fullName.trim();
    if (gender !== undefined) profile.gender = gender;
    if (location !== undefined) profile.location = { ...(profile.location || {}), ...location };
    if (healthInfo !== undefined) profile.healthInfo = healthInfo;

    await profile.save();

    const evaluation = await evaluatePatientCompleteness(profile, req.user.id);

    res.status(200).json({
      success: true,
      message: "Patient profile updated successfully.",
      data: {
        profile,
        ...evaluation
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/patient/verification
 * Return current status and past submissions
 */
const getPatientVerifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

    const submissions = await PatientVerification.find({ patientUserId: req.user.id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10));

    const total = await PatientVerification.countDocuments({ patientUserId: req.user.id });

    const profile = await PatientProfile.findOne({ userId: req.user.id });

    res.status(200).json({
      success: true,
      data: {
        currentStatus: profile ? profile.identityStatus : "none",
        submissions,
        pagination: {
          total,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          pages: Math.ceil(total / parseInt(limit, 10))
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/patient/verification
 * Submit identity verification (idDocumentUrl, selfieUrl)
 */
const submitPatientVerification = async (req, res, next) => {
  try {
    const { idDocumentUrl, selfieUrl } = req.body;
    if (!idDocumentUrl || !selfieUrl) {
      const error = new Error("Both idDocumentUrl and selfieUrl are required.");
      error.statusCode = 400;
      throw error;
    }

    const profile = await PatientProfile.findOne({ userId: req.user.id });
    if (!profile || !profile.fullName || !profile.dateOfBirth) {
      return res.status(400).json({
        success: false,
        code: "PROFILE_INCOMPLETE",
        message: "fullName and dateOfBirth must be completed on your profile before submitting verification."
      });
    }

    if (profile.identityStatus === "verified") {
      return res.status(400).json({
        success: false,
        code: "ALREADY_VERIFIED",
        message: "Your identity is already verified."
      });
    }

    const pending = await PatientVerification.findOne({
      patientUserId: req.user.id,
      status: "pending"
    });

    if (pending) {
      return res.status(409).json({
        success: false,
        code: "PENDING_EXISTS",
        message: "You already have a verification submission pending review."
      });
    }

    const submission = await PatientVerification.create({
      patientId: profile._id,
      patientUserId: req.user.id,
      idDocumentUrl: idDocumentUrl.trim(),
      selfieUrl: selfieUrl.trim(),
      status: "pending",
      submittedAt: new Date()
    });

    profile.identityStatus = "pending";
    await profile.save();

    res.status(201).json({
      success: true,
      message: "Identity verification submitted successfully.",
      data: submission
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPatientProfile,
  updatePatientProfile,
  getPatientVerifications,
  submitPatientVerification
};
