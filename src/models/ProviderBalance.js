const mongoose = require("mongoose");

const providerBalanceSchema = new mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProviderProfile",
      required: true,
      unique: true,
      index: true
    },
    providerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    balance: {
      type: Number,
      default: 0
    },
    currency: {
      type: String,
      default: "EGP"
    },
    commissionRate: {
      type: Number,
      default: 0.15, // 15% default platform commission
      min: 0,
      max: 1
    },
    isPaused: {
      type: Boolean,
      default: false
    },
    lastUpdatedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

const ProviderBalance = mongoose.model(
  "ProviderBalance",
  providerBalanceSchema,
  "Provider_Balances"
);

module.exports = ProviderBalance;
