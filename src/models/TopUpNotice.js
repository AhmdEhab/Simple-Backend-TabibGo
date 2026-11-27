const mongoose = require("mongoose");

const topUpNoticeSchema = new mongoose.Schema(
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
    transferReference: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    amount: {
      type: Number,
      required: true,
      min: 200 // Minimum top-up threshold per contract
    },
    status: {
      type: String,
      enum: ["pending", "matched", "rejected"],
      default: "pending",
      index: true
    },
    adminNote: {
      type: String,
      trim: true,
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

topUpNoticeSchema.index({ providerId: 1, createdAt: -1 });

const TopUpNotice = mongoose.model("TopUpNotice", topUpNoticeSchema, "Top_Up_Notices");

module.exports = TopUpNotice;
