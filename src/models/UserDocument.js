const mongoose = require("mongoose");
const { ALL_DOCUMENT_TYPES } = require("../config/documentRequirements");

const DOCUMENT_TYPES = ALL_DOCUMENT_TYPES;
const DOCUMENT_STATUSES = ["pending_review", "approved", "rejected"];

const userDocumentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    documentType: {
      type: String,
      required: true,
      enum: DOCUMENT_TYPES,
      index: true
    },

    originalFileName: {
      type: String,
      required: true,
      trim: true
    },

    storedFileName: {
      type: String,
      required: true,
      trim: true
    },

    mimeType: {
      type: String,
      required: true,
      trim: true
    },

    fileSize: {
      type: Number,
      required: true,
      min: 0
    },

    storageKey: {
      type: String,
      required: true,
      trim: true
    },

    status: {
      type: String,
      enum: DOCUMENT_STATUSES,
      default: "pending_review",
      index: true
    },

    rejectionReason: {
      type: String,
      trim: true,
      default: null
    },

    // Indicates whether this document is the active/current record in review
    isActiveVersion: {
      type: Boolean,
      default: true,
      index: true
    },

    // Version number for this documentType under this user
    version: {
      type: Number,
      default: 1
    },

    // Pointer to previous superseded document record if replaced
    previousDocumentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserDocument",
      default: null
    },

    uploadedAt: {
      type: Date,
      default: Date.now
    },

    reviewedAt: {
      type: Date,
      default: null
    },

    reviewedBy: {
      type: String, // Admin identifier or service reference
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Indexes:
// 1. Efficient lookup of active documents per user
userDocumentSchema.index({ userId: 1, documentType: 1, isActiveVersion: 1 });
// 2. Timeline lookup
userDocumentSchema.index({ userId: 1, uploadedAt: -1 });

const UserDocument = mongoose.model("UserDocument", userDocumentSchema, "User_Documents");

module.exports = {
  UserDocument,
  DOCUMENT_TYPES,
  DOCUMENT_STATUSES
};
