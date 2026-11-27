const mongoose = require("mongoose");

const OFFER_STATUSES = [
  "sent",
  "accepted",
  "rejected",
  "withdrawn",
  "locked"
];

const offerSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PatientRequest",
      required: true,
      index: true
    },
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
    price: {
      type: Number,
      required: true,
      min: 0
    },
    message: {
      type: String,
      trim: true,
      default: null
    },
    availableAt: {
      type: Date,
      required: true
    },
    durationMinutes: {
      type: Number,
      required: true,
      min: 1
    },
    status: {
      type: String,
      enum: OFFER_STATUSES,
      default: "sent",
      index: true
    },
    withdrawnAt: {
      type: Date,
      default: null
    },
    acceptedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

offerSchema.index({ requestId: 1, providerId: 1 }, { unique: true });
offerSchema.index({ providerUserId: 1, createdAt: -1 });

const Offer = mongoose.model("Offer", offerSchema, "Offers");

module.exports = {
  Offer,
  OFFER_STATUSES
};
