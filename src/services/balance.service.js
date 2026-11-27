const ProviderBalance = require("../models/ProviderBalance");
const Ledger = require("../models/Ledger");
const TopUpNotice = require("../models/TopUpNotice");
const ProviderProfile = require("../models/ProviderProfile");

/**
 * Get or initialize ProviderBalance
 */
const getOrCreateProviderBalance = async (providerUserId) => {
  const profile = await ProviderProfile.findOne({ userId: providerUserId });
  if (!profile) {
    const error = new Error("Provider profile not found.");
    error.statusCode = 404;
    throw error;
  }

  let balanceDoc = await ProviderBalance.findOne({ providerId: profile._id });
  if (!balanceDoc) {
    balanceDoc = await ProviderBalance.create({
      providerId: profile._id,
      providerUserId,
      balance: profile.balance || 0,
      commissionRate: 0.15,
      isPaused: (profile.balance || 0) <= 0
    });
  }

  // Sync isPaused flag
  const isPaused = balanceDoc.balance <= 0;
  if (balanceDoc.isPaused !== isPaused) {
    balanceDoc.isPaused = isPaused;
    await balanceDoc.save();
  }

  return { balanceDoc, profile };
};

/**
 * Deduct commission on completed booking and create ledger entry
 */
const deductCommission = async ({ providerId, amount, bookingId, note = null }, session = null) => {
  const opts = session ? { session } : {};
  let balanceDoc = await ProviderBalance.findOne({ providerId }).setOptions(opts);
  if (!balanceDoc) {
    const profile = await ProviderProfile.findById(providerId).setOptions(opts);
    balanceDoc = new ProviderBalance({
      providerId,
      providerUserId: profile ? profile.userId : null,
      balance: profile ? profile.balance || 0 : 0,
      commissionRate: 0.15
    });
  }

  balanceDoc.balance = Math.round((balanceDoc.balance - amount) * 100) / 100;
  balanceDoc.isPaused = balanceDoc.balance <= 0;
  balanceDoc.lastUpdatedAt = new Date();
  await balanceDoc.save(opts);

  // Sync ProviderProfile secondary balance
  await ProviderProfile.findByIdAndUpdate(
    providerId,
    { $set: { balance: balanceDoc.balance } },
    opts
  );

  // Write immutable ledger entry
  const [ledgerEntry] = await Ledger.create(
    [
      {
        providerId,
        type: "commission_deducted",
        amount: -amount,
        balanceAfter: balanceDoc.balance,
        referenceType: "booking",
        referenceId: bookingId,
        note: note || `Commission deducted for booking #${bookingId}`
      }
    ],
    opts
  );

  return { balanceDoc, ledgerEntry };
};

/**
 * Apply topup to provider balance
 */
const applyTopUp = async ({ providerId, amount, topUpNoticeId, adminNote = null }, session = null) => {
  const opts = session ? { session } : {};
  let balanceDoc = await ProviderBalance.findOne({ providerId }).setOptions(opts);
  if (!balanceDoc) {
    const profile = await ProviderProfile.findById(providerId).setOptions(opts);
    balanceDoc = new ProviderBalance({
      providerId,
      providerUserId: profile ? profile.userId : null,
      balance: 0,
      commissionRate: 0.15
    });
  }

  balanceDoc.balance = Math.round((balanceDoc.balance + amount) * 100) / 100;
  balanceDoc.isPaused = balanceDoc.balance <= 0;
  balanceDoc.lastUpdatedAt = new Date();
  await balanceDoc.save(opts);

  await ProviderProfile.findByIdAndUpdate(
    providerId,
    { $set: { balance: balanceDoc.balance } },
    opts
  );

  const [ledgerEntry] = await Ledger.create(
    [
      {
        providerId,
        type: "topup_applied",
        amount,
        balanceAfter: balanceDoc.balance,
        referenceType: "topup_notice",
        referenceId: topUpNoticeId,
        note: adminNote || `Top-up matched #${topUpNoticeId}`
      }
    ],
    opts
  );

  return { balanceDoc, ledgerEntry };
};

module.exports = {
  getOrCreateProviderBalance,
  deductCommission,
  applyTopUp
};
