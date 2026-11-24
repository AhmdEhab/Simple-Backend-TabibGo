const mongoose = require("mongoose");

const AUDIT_ACTIONS = [
  "document_uploaded",
  "document_replaced",
  "document_approved",
  "document_rejected",
  "verification_stage_updated",
  "application_submitted",
  "application_approved",
  "application_rejected",
  "application_interview_scheduled"
];

const documentAuditLogSchema = new mongoose.Schema(
  {
    targetType: {
      type: String,
      enum: ["document", "verification_stage", "application"],
      required: true,
      index: true
    },

    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    action: {
      type: String,
      enum: AUDIT_ACTIONS,
      required: true,
      index: true
    },

    previousStatus: {
      type: String,
      default: null
    },

    newStatus: {
      type: String,
      default: null
    },

    actorType: {
      type: String,
      enum: ["user", "admin", "system"],
      required: true
    },

    actorId: {
      type: String,
      required: true
    },

    reason: {
      type: String,
      trim: true,
      default: null
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: false
  }
);

documentAuditLogSchema.index({ userId: 1, timestamp: -1 });

// Enforce append-only immutability at Mongoose schema level
// Reject any updates, replacements, or deletions on audit log records
documentAuditLogSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"], function () {
  throw new Error("Security Violation: DocumentAuditLog records are strictly immutable and cannot be updated or deleted.");
});

documentAuditLogSchema.pre("remove", function () {
  throw new Error("Security Violation: DocumentAuditLog records are strictly immutable and cannot be deleted.");
});

const DocumentAuditLog = mongoose.model(
  "DocumentAuditLog",
  documentAuditLogSchema,
  "Document_Audit_Logs"
);

module.exports = {
  DocumentAuditLog,
  AUDIT_ACTIONS
};
