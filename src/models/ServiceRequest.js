const mongoose = require("mongoose");

const REQUEST_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "cancelled",
  "confirmed",
  "in_progress",
  "completed"
];

const serviceRequestSchema = new mongoose.Schema(
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

    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: true,
      index: true
    },

    scheduledAt: {
      type: Date,
      required: true
    },

    address: {
      governorate: { type: String, required: true, trim: true },
      city: { type: String, required: true, trim: true },
      street: { type: String, required: true, trim: true },
      buildingNumber: { type: String, trim: true },
      apartmentNumber: { type: String, trim: true },
      locationNotes: { type: String, trim: true }
    },

    patientNotes: {
      type: String,
      trim: true,
      default: null
    },

    // Financial & Service Snapshots (immutable once booked)
    priceSnapshot: {
      type: Number,
      required: true,
      min: 0
    },

    currencySnapshot: {
      type: String,
      default: "EGP",
      uppercase: true,
      trim: true
    },

    serviceTitleSnapshot: {
      type: String,
      required: true,
      trim: true
    },

    serviceDurationMinutesSnapshot: {
      type: Number,
      required: true
    },

    status: {
      type: String,
      enum: REQUEST_STATUSES,
      default: "pending",
      index: true
    },

    providerResponseAt: {
      type: Date,
      default: null
    },

    providerResponseReason: {
      type: String,
      trim: true,
      default: null
    },

    cancelledBy: {
      type: String,
      enum: ["patient", "provider", "admin", "system"],
      default: null
    },

    cancellationReason: {
      type: String,
      trim: true,
      default: null
    },

    cancelledAt: {
      type: Date,
      default: null
    },

    completedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

serviceRequestSchema.index({ patientId: 1, status: 1 });
serviceRequestSchema.index({ providerId: 1, status: 1 });
serviceRequestSchema.index({ serviceId: 1, scheduledAt: 1 });

const ServiceRequest = mongoose.model(
  "ServiceRequest",
  serviceRequestSchema,
  "Service_Requests"
);

module.exports = {
  ServiceRequest,
  REQUEST_STATUSES
};
