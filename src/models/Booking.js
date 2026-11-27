const mongoose = require("mongoose");

const BOOKING_STATUSES = [
  "pending_provider",
  "confirmed",
  "upcoming",
  "in_progress",
  "completed",
  "provider_rejected",
  "cancelled"
];

const bookingSchema = new mongoose.Schema(
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
    catalogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceCatalog",
      default: null
    },
    scheduledAt: {
      type: Date,
      required: true,
      index: true
    },
    durationMinutes: {
      type: Number,
      required: true,
      min: 1
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
    // Financial and rate snapshots
    priceSnapshot: {
      type: Number,
      required: true,
      min: 0
    },
    currencySnapshot: {
      type: String,
      default: "EGP",
      trim: true
    },
    commissionRateSnapshot: {
      type: Number,
      default: null // Copied from ProviderBalance on provider accept
    },
    commissionAmountSnapshot: {
      type: Number,
      default: null
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid_cash"],
      default: "unpaid"
    },
    status: {
      type: String,
      enum: BOOKING_STATUSES,
      default: "pending_provider",
      index: true
    },
    bookingType: {
      type: String,
      enum: ["direct", "from_offer"],
      default: "direct"
    },
    offerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Offer",
      default: null
    },
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PatientRequest",
      default: null
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: null
    },
    cancelledBy: {
      type: String,
      enum: ["patient", "provider", "admin", "system", null],
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
    },
    ratingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rating",
      default: null
    },
    timeProposalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TimeProposal",
      default: null
    }
  },
  {
    timestamps: true
  }
);

bookingSchema.index({ providerId: 1, scheduledAt: 1, status: 1 });
bookingSchema.index({ patientUserId: 1, createdAt: -1 });
bookingSchema.index({ providerUserId: 1, createdAt: -1 });

const Booking = mongoose.model("Booking", bookingSchema, "Bookings");

module.exports = {
  Booking,
  BOOKING_STATUSES
};
