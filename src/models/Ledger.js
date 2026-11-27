const mongoose = require("mongoose");

const ledgerSchema = new mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProviderProfile",
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ["commission_deducted", "topup_applied", "adjustment", "payout"],
      required: true,
      index: true
    },
    amount: {
      type: Number,
      required: true
    },
    balanceAfter: {
      type: Number,
      required: true
    },
    referenceType: {
      type: String,
      enum: ["booking", "topup_notice", "admin_adjustment"],
      default: null
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },
    note: {
      type: String,
      trim: true,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Append-only guarantee: block updates and deletes
ledgerSchema.pre("updateOne", function () {
  throw new Error("Ledger entries are strictly immutable (updates prohibited).");
});
ledgerSchema.pre("updateMany", function () {
  throw new Error("Ledger entries are strictly immutable (updates prohibited).");
});
ledgerSchema.pre("findOneAndUpdate", function () {
  throw new Error("Ledger entries are strictly immutable (updates prohibited).");
});
ledgerSchema.pre("deleteOne", function () {
  throw new Error("Ledger entries are strictly immutable (deletions prohibited).");
});
ledgerSchema.pre("deleteMany", function () {
  throw new Error("Ledger entries are strictly immutable (deletions prohibited).");
});
ledgerSchema.pre("findOneAndDelete", function () {
  throw new Error("Ledger entries are strictly immutable (deletions prohibited).");
});

ledgerSchema.index({ providerId: 1, createdAt: -1 });

const Ledger = mongoose.model("Ledger", ledgerSchema, "Ledger_Entries");

module.exports = Ledger;
