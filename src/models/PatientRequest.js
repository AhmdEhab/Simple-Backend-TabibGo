const mongoose = require("mongoose");

const REQUEST_MARKETPLACE_STATUSES = [
  "open",
  "assigned",
  "cancelled",
  "expired"
];

const patientRequestSchema = new mongoose.Schema(
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
    catalogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceCatalog",
      required: true,
      index: true
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    address: {
      governorate: { type: String, required: true, trim: true },
      city: { type: String, required: true, trim: true },
      street: { type: String, required: true, trim: true },
      buildingNumber: { type: String, trim: true },
      apartmentNumber: { type: String, trim: true },
      locationNotes: { type: String, trim: true }
    },
    coordinates: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point"
      },
      coordinates: {
        type: [Number], // [lng, lat]
        default: undefined
      }
    },
    preferredTime: {
      from: { type: Date, required: true },
      to: { type: Date, default: null }
    },
    budget: {
      type: Number,
      min: 0,
      default: null
    },
    status: {
      type: String,
      enum: REQUEST_MARKETPLACE_STATUSES,
      default: "open",
      index: true
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true
    },
    cancellationReason: {
      type: String,
      trim: true,
      default: null
    },
    assignedOfferId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Offer",
      default: null
    },
    assignedBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null
    }
  },
  {
    timestamps: true
  }
);

patientRequestSchema.index({ status: 1, expiresAt: 1, "address.governorate": 1 });
patientRequestSchema.index({ coordinates: "2dsphere" }, { sparse: true });

const PatientRequest = mongoose.model("PatientRequest", patientRequestSchema, "Patient_Requests");

module.exports = {
  PatientRequest,
  REQUEST_MARKETPLACE_STATUSES
};
