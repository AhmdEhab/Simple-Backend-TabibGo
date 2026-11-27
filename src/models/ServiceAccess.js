const mongoose = require("mongoose");

const serviceAccessSchema = new mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProviderProfile",
      required: true,
      index: true
    },
    providerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    catalogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceCatalog",
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ["not_requested", "requested", "in_assessment", "approved", "rejected", "revoked"],
      default: "requested",
      index: true
    },
    decisionReason: {
      type: String,
      trim: true,
      default: null
    },
    revokeReason: {
      type: String,
      trim: true,
      default: null
    },
    rejectionCooldownUntil: {
      type: Date,
      default: null
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

serviceAccessSchema.index({ providerId: 1, catalogId: 1 }, { unique: true });

const ServiceAccess = mongoose.model(
  "ServiceAccess",
  serviceAccessSchema,
  "Service_Access"
);

module.exports = ServiceAccess;
