const mongoose = require("mongoose");

const patientVerificationSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PatientProfile",
      required: true,
      index: true
    },
    patientUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    idDocumentUrl: {
      type: String,
      required: true,
      trim: true
    },
    selfieUrl: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
      index: true
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: null
    },
    submittedAt: {
      type: Date,
      default: Date.now
    },
    decidedAt: {
      type: Date,
      default: null
    },
    decidedByAdminId: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

patientVerificationSchema.index({ patientUserId: 1, createdAt: -1 });

const PatientVerification = mongoose.model(
  "PatientVerification",
  patientVerificationSchema,
  "Patient_Verifications"
);

module.exports = PatientVerification;
