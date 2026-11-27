const mongoose = require("mongoose");

const timeProposalSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true
    },
    proposerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    proposerRole: {
      type: String,
      enum: ["provider", "patient"],
      default: "provider"
    },
    originalScheduledAt: {
      type: Date,
      required: true
    },
    proposedScheduledAt: {
      type: Date,
      required: true
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "cancelled", "expired"],
      default: "pending",
      index: true
    },
    expiresAt: {
      type: Date,
      required: true
    },
    actionReason: {
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

timeProposalSchema.index({ bookingId: 1, createdAt: -1 });

const TimeProposal = mongoose.model("TimeProposal", timeProposalSchema, "Time_Proposals");

module.exports = TimeProposal;
