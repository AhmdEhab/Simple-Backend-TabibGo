const mongoose = require("mongoose");

const SERVICE_AUDIT_ACTIONS = [
  "service_created",
  "service_published",
  "service_updated",
  "service_hidden",
  "service_archived",
  "service_moderation_approved",
  "service_moderation_rejected",
  "service_suspended",
  "service_restored",
  "service_re_moderation_triggered",
  "request_created",
  "request_accepted",
  "request_rejected",
  "request_cancelled",
  "request_confirmed",
  "request_in_progress",
  "request_completed",
  "exceptional_cancellation_requested",
  "exceptional_cancellation_approved",
  "exceptional_cancellation_rejected"
];

const serviceAuditLogSchema = new mongoose.Schema(
  {
    targetType: {
      type: String,
      enum: ["service", "service_request"],
      required: true,
      index: true
    },

    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },

    action: {
      type: String,
      enum: SERVICE_AUDIT_ACTIONS,
      required: true,
      index: true
    },

    actorType: {
      type: String,
      enum: ["provider", "patient", "admin", "system"],
      required: true
    },

    actorId: {
      type: String, // User ID or Admin ID
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

    reason: {
      type: String,
      trim: true,
      default: null
    },

    changes: {
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

serviceAuditLogSchema.index({ targetId: 1, timestamp: -1 });

// Immutability enforcement at schema level
serviceAuditLogSchema.pre(
  [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete"
  ],
  function () {
    throw new Error(
      "Security Violation: ServiceAuditLog records are strictly immutable and cannot be updated or deleted."
    );
  }
);

serviceAuditLogSchema.pre("remove", function () {
  throw new Error(
    "Security Violation: ServiceAuditLog records are strictly immutable and cannot be deleted."
  );
});

const ServiceAuditLog = mongoose.model(
  "ServiceAuditLog",
  serviceAuditLogSchema,
  "Service_Audit_Logs"
);

module.exports = {
  ServiceAuditLog,
  SERVICE_AUDIT_ACTIONS
};
