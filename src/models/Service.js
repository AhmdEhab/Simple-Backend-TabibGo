const mongoose = require("mongoose");

const PUBLICATION_STATUSES = ["draft", "published", "hidden", "archived"];
const MODERATION_STATUSES = [
  "pending_review",
  "under_review",
  "approved",
  "rejected",
  "suspended"
];

const serviceSchema = new mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProviderProfile",
      required: true,
      index: true
    },

    professionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Profession",
      required: true,
      index: true
    },

    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceCategory",
      default: null,
      index: true
    },

    catalogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceCatalog",
      default: null,
      index: true
    },

    title: {
      type: String,
      required: true,
      trim: true
    },

    description: {
      type: String,
      required: true,
      trim: true
    },

    price: {
      type: Number,
      required: true,
      min: 0
    },

    currency: {
      type: String,
      default: "EGP",
      trim: true,
      uppercase: true
    },

    durationMinutes: {
      type: Number,
      required: true,
      min: 1
    },

    serviceAreas: [
      {
        governorate: { type: String, trim: true, required: true },
        city: { type: String, trim: true, required: true }
      }
    ],

    serviceImage: {
      type: String,
      default: null,
      trim: true
    },

    publicationStatus: {
      type: String,
      enum: PUBLICATION_STATUSES,
      default: "draft",
      index: true
    },

    moderationStatus: {
      type: String,
      enum: MODERATION_STATUSES,
      default: "pending_review",
      index: true
    },

    reviewedBy: {
      type: String, // Admin identifier
      default: null
    },

    reviewedAt: {
      type: Date,
      default: null
    },

    rejectionReason: {
      type: String,
      trim: true,
      default: null
    },

    suspensionReason: {
      type: String,
      trim: true,
      default: null
    },

    publishedAt: {
      type: Date,
      default: null
    },

    version: {
      type: Number,
      default: 1
    }
  },
  {
    timestamps: true
  }
);

// Indexes for fast discovery queries
serviceSchema.index({ publicationStatus: 1, moderationStatus: 1, professionId: 1 });
serviceSchema.index({ providerId: 1, publicationStatus: 1 });

const Service = mongoose.model("Service", serviceSchema, "Services");

module.exports = {
  Service,
  PUBLICATION_STATUSES,
  MODERATION_STATUSES
};
