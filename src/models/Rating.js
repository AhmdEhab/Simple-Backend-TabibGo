const mongoose = require("mongoose");

const ratingSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true,
      index: true
    },
    patientUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    providerProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProviderProfile",
      required: true,
      index: true
    },
    stars: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    comment: {
      type: String,
      trim: true,
      default: null
    }
  },
  {
    timestamps: true
  }
);

ratingSchema.index({ providerProfileId: 1, createdAt: -1 });

const Rating = mongoose.model("Rating", ratingSchema, "Ratings");

module.exports = Rating;
