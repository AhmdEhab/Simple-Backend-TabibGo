const mongoose = require("mongoose");

const EXCEPTIONAL_CANCELLATION_STATUSES = [
  "pending_review",
  "approved",
  "rejected"
];

const exceptionalCancellationRequestSchema = new mongoose.Schema(
  {
    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceRequest",
      required: true,
      index: true
    },

    requesterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    requesterRole: {
      type: String,
      enum: ["patient", "provider"],
      required: true
    },

    reason: {
      type: String,
      required: true,
      trim: true
    },

    supportingDetails: {
      type: String,
      trim: true,
      default: null
    },

    status: {
      type: String,
      enum: EXCEPTIONAL_CANCELLATION_STATUSES,
      default: "pending_review",
      index: true
    },

    requestBookingStatusAtSubmission: {
      type: String,
      required: true
    },

    // Review details populated when an Admin decides
    decidedByAdminId: {
      type: String,
      default: null
    },

    adminDecisionReason: {
      type: String,
      trim: true,
      default: null
    },

    decidedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Indexes
// Compound index to guarantee uniqueness of active pending request per booking and requester
exceptionalCancellationRequestSchema.index(
  { serviceRequestId: 1, requesterId: 1, status: 1 }
);

const ExceptionalCancellationRequest = mongoose.model(
  "ExceptionalCancellationRequest",
  exceptionalCancellationRequestSchema,
  "Exceptional_Cancellation_Requests"
);

module.exports = {
  ExceptionalCancellationRequest,
  EXCEPTIONAL_CANCELLATION_STATUSES
};
