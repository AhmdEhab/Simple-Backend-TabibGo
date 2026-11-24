const ProviderProfile = require("../models/ProviderProfile");
const ProviderApplication = require("../models/ProviderApplication");
const { ProviderVerification } = require("../models/ProviderVerification");
const { UserDocument } = require("../models/UserDocument");
const { DocumentAuditLog } = require("../models/DocumentAuditLog");
const { getProviderDocumentRules } = require("./document.service");

/**
 * Validate Provider Application Eligibility & Documents
 * - Supports multiple documents of same type (e.g. experience certificates)
 * - Accepts documents in 'pending_review' status
 * - Rejects if mandatory document is missing or in 'rejected' status
 */
const validateProviderApplicationReadiness = async (userId, providerProfileId) => {
  const rules = await getProviderDocumentRules(userId);
  const requiredRules = rules.filter((r) => r.required);

  // Fetch only active versions of user documents
  const userDocs = await UserDocument.find({
    userId,
    isActiveVersion: true
  });

  const docMap = new Map();
  userDocs.forEach((d) => {
    if (!docMap.has(d.documentType)) {
      docMap.set(d.documentType, []);
    }
    docMap.get(d.documentType).push(d);
  });

  const missingDocs = [];
  const rejectedDocs = [];
  const pendingDocs = [];

  for (const rule of requiredRules) {
    let docs = docMap.get(rule.type) || [];
    if (docs.length === 0 && rule.legacyType) {
      docs = docMap.get(rule.legacyType) || [];
    }

    if (docs.length === 0) {
      missingDocs.push({
        type: rule.type,
        label: rule.label,
        category: rule.category,
        authority: rule.authority
      });
    } else {
      // Check if any active document of this required type is rejected
      const rejected = docs.find((d) => d.status === "rejected");
      if (rejected) {
        rejectedDocs.push({
          type: rule.type,
          label: rule.label,
          reason: rejected.rejectionReason
        });
      }

      const pending = docs.filter((d) => d.status === "pending_review");
      if (pending.length > 0) {
        pendingDocs.push({
          type: rule.type,
          label: rule.label,
          count: pending.length
        });
      }
    }
  }

  return {
    isReady: missingDocs.length === 0 && rejectedDocs.length === 0,
    missingDocs,
    rejectedDocs,
    pendingDocs
  };
};

/**
 * Create or Submit a Provider Application
 */
const createProviderApplication = async ({
  userId,
  licenseNumber,
  licenseExpiry
}) => {
  const provider = await ProviderProfile.findOne({ userId });

  if (!provider) {
    const error = new Error("Provider profile not found. Please complete your profile first.");
    error.statusCode = 404;
    throw error;
  }

  if (provider.isApproved) {
    const error = new Error("This provider is already approved.");
    error.statusCode = 409;
    throw error;
  }

  // Prevent duplicate active applications
  const existingApplication = await ProviderApplication.findOne({
    providerId: provider._id,
    status: {
      $in: [
        "draft",
        "submitted",
        "under_review",
        "interview_required",
        "approved"
      ]
    }
  });

  if (existingApplication) {
    const error = new Error(
      "You already have an active or approved application."
    );
    error.statusCode = 409;
    throw error;
  }

  // Validate documents readiness (accepts pending, blocks missing or rejected)
  const docReadiness = await validateProviderApplicationReadiness(userId, provider._id);

  if (!docReadiness.isReady) {
    let msg = "Cannot submit application:";
    if (docReadiness.missingDocs.length > 0) {
      const missingLabels = docReadiness.missingDocs.map((d) => `${d.label} (${d.type})`).join(", ");
      msg += ` Missing required documents: [${missingLabels}].`;
    }
    if (docReadiness.rejectedDocs.length > 0) {
      const rejectedLabels = docReadiness.rejectedDocs.map((d) => d.label).join(", ");
      msg += ` Rejected documents must be replaced: [${rejectedLabels}].`;
    }
    const error = new Error(msg);
    error.statusCode = 400;
    error.details = docReadiness;
    throw error;
  }

  // Create application record
  const application = await ProviderApplication.create({
    providerId: provider._id,
    licenseNumber,
    licenseExpiry,
    status: "submitted",
    submittedAt: new Date()
  });

  // Initialize or update ProviderVerification record
  await ProviderVerification.findOneAndUpdate(
    { providerId: provider._id },
    {
      $setOnInsert: {
        providerId: provider._id,
        userId,
        overallStatus: "in_progress"
      }
    },
    { upsert: true, returnDocument: "after" }
  );

  // Audit log application submission
  await DocumentAuditLog.create({
    targetType: "application",
    targetId: application._id,
    userId,
    action: "application_submitted",
    previousStatus: null,
    newStatus: "submitted",
    actorType: "user",
    actorId: userId.toString(),
    metadata: {
      licenseNumber,
      licenseExpiry
    }
  });

  return application;
};

/**
 * Get current application status and verification stages for authenticated provider
 */
const getMyApplication = async (userId) => {
  const provider = await ProviderProfile.findOne({ userId });
  if (!provider) {
    const error = new Error("Provider profile not found.");
    error.statusCode = 404;
    throw error;
  }

  const application = await ProviderApplication.findOne({
    providerId: provider._id
  }).sort({ createdAt: -1 });

  const verification = await ProviderVerification.findOne({
    providerId: provider._id
  });

  return {
    provider,
    application,
    verification: verification ? {
      overallStatus: verification.overallStatus,
      identityVerification: verification.identityVerification,
      licenseVerification: verification.licenseVerification,
      experienceVerification: verification.experienceVerification,
      skillsAssessment: verification.skillsAssessment
    } : null
  };
};

module.exports = {
  createProviderApplication,
  validateProviderApplicationReadiness,
  getMyApplication
};
