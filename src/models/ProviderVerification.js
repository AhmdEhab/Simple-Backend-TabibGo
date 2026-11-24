const mongoose = require("mongoose");

const VERIFICATION_STAGE_STATUSES = [
  "not_started",
  "pending",
  "under_review",
  "verified",
  "rejected",
  "requires_action"
];

const stageDetailsSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: VERIFICATION_STAGE_STATUSES,
      default: "not_started"
    },
    reviewNotes: {
      type: String,
      trim: true,
      default: null
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: null
    },
    reviewedBy: {
      type: String, // Admin ID or system identifier
      default: null
    },
    reviewedAt: {
      type: Date,
      default: null
    },
    verificationMethod: {
      type: String, // e.g. "manual_document_review", "online_syndicate_registry_check", "in_person_interview"
      trim: true,
      default: null
    },
    supportingDocumentIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserDocument"
    }]
  },
  { _id: false }
);

const providerVerificationSchema = new mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProviderProfile",
      required: true,
      unique: true,
      index: true
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true
    },

    // 1. Identity Verification
    identityVerification: {
      type: stageDetailsSchema,
      default: () => ({ status: "not_started" })
    },

    // 2. Professional License Verification
    licenseVerification: {
      type: stageDetailsSchema,
      default: () => ({ status: "not_started" })
    },

    // 3. Experience Verification
    experienceVerification: {
      type: stageDetailsSchema,
      default: () => ({ status: "not_started" })
    },

    // 4. Skills Assessment
    skillsAssessment: {
      type: stageDetailsSchema,
      default: () => ({ status: "not_started" })
    },

    overallStatus: {
      type: String,
      enum: ["unverified", "in_progress", "verified", "rejected"],
      default: "unverified",
      index: true
    }
  },
  {
    timestamps: true
  }
);

const ProviderVerification = mongoose.model(
  "ProviderVerification",
  providerVerificationSchema,
  "Provider_Verifications"
);

module.exports = {
  ProviderVerification,
  VERIFICATION_STAGE_STATUSES
};
