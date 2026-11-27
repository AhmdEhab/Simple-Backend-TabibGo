const mongoose = require("mongoose");
const { Booking } = require("../models/Booking");
const { Service } = require("../models/Service");
const ProviderProfile = require("../models/ProviderProfile");
const PatientProfile = require("../models/PatientProfile");
const Rating = require("../models/Rating");
const TimeProposal = require("../models/TimeProposal");
const { PatientRequest } = require("../models/PatientRequest");
const { getOrCreateProviderBalance, deductCommission } = require("./balance.service");
const { sendNotification } = require("./notification.service");

/**
 * Check if a scheduled timestamp falls inside a provider's availability slots
 */
const isInsideProviderAvailability = (availability, scheduledDate) => {
  if (!availability || !Array.isArray(availability) || availability.length === 0) {
    return true; // No strict availability configured -> open
  }

  const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayName = DAYS[scheduledDate.getDay()];

  const daySlots = availability.filter((slot) => slot.day && slot.day.toLowerCase() === dayName);
  if (daySlots.length === 0) return false;

  const hours = scheduledDate.getHours();
  const minutes = scheduledDate.getMinutes();
  const scheduledMins = hours * 60 + minutes;

  return daySlots.some((slot) => {
    if (!slot.startTime || !slot.endTime) return true;
    const [startH, startM] = slot.startTime.split(":").map(Number);
    const [endH, endM] = slot.endTime.split(":").map(Number);
    const startMins = startH * 60 + (startM || 0);
    const endMins = endH * 60 + (endM || 0);
    return scheduledMins >= startMins && scheduledMins <= endMins;
  });
};

/**
 * Check provider schedule overlap for a time window [start, start + durationMinutes]
 */
const checkProviderOverlap = async (providerId, startTime, durationMinutes, excludeBookingId = null) => {
  const windowStart = new Date(startTime);
  const windowEnd = new Date(windowStart.getTime() + durationMinutes * 60 * 1000);

  const query = {
    providerId,
    status: { $in: ["pending_provider", "confirmed", "upcoming", "in_progress"] },
    $expr: {
      $and: [
        { $lt: ["$scheduledAt", windowEnd] },
        {
          $gt: [
            { $add: ["$scheduledAt", { $multiply: ["$durationMinutes", 60 * 1000] }] },
            windowStart
          ]
        }
      ]
    }
  };

  if (excludeBookingId) {
    query._id = { $ne: excludeBookingId };
  }

  const conflictingBooking = await Booking.findOne(query);
  return !!conflictingBooking;
};

/**
 * Patient: Create Booking
 */
const createPatientBooking = async (patientUserId, bookingData) => {
  const { serviceId, scheduledAt, address, patientNotes } = bookingData;
  if (!serviceId || !scheduledAt || !address || !address.governorate || !address.city || !address.street) {
    const error = new Error("Missing required fields (serviceId, scheduledAt, complete address).");
    error.statusCode = 400;
    throw error;
  }

  const bookingDate = new Date(scheduledAt);
  const now = new Date();
  const minLeadTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  if (isNaN(bookingDate.getTime()) || bookingDate < minLeadTime) {
    const error = new Error("scheduledAt must be at least 2 hours from now.");
    error.statusCode = 400;
    error.code = "TOO_SOON";
    throw error;
  }

  const patientProfile = await PatientProfile.findOne({ userId: patientUserId });
  if (!patientProfile || !patientProfile.fullName) {
    const error = new Error("Patient profile incomplete.");
    error.statusCode = 400;
    error.code = "PROFILE_INCOMPLETE";
    throw error;
  }

  const service = await Service.findById(serviceId).populate("providerId");
  if (!service || service.publicationStatus !== "published" || ["rejected", "suspended"].includes(service.moderationStatus)) {
    const error = new Error("Service is currently unavailable for booking.");
    error.statusCode = 400;
    throw error;
  }

  const provider = service.providerId;
  if (!provider || !provider.isApproved) {
    const error = new Error("Provider is not currently authorized to accept bookings.");
    error.statusCode = 400;
    throw error;
  }

  if (provider.userId.toString() === patientUserId.toString()) {
    const error = new Error("You cannot book your own service.");
    error.statusCode = 400;
    throw error;
  }

  // Check provider availability
  if (!isInsideProviderAvailability(provider.availability, bookingDate)) {
    const error = new Error("The requested time falls outside of the provider's active availability.");
    error.statusCode = 400;
    throw error;
  }

  // Check provider calendar overlap
  const duration = service.durationMinutes || 60;
  const hasOverlap = await checkProviderOverlap(provider._id, bookingDate, duration);
  if (hasOverlap) {
    const error = new Error("The provider already has an overlapping active booking at this time slot.");
    error.statusCode = 409;
    error.code = "SLOT_TAKEN";
    throw error;
  }

  const booking = await Booking.create({
    patientId: patientProfile._id,
    patientUserId,
    providerId: provider._id,
    providerUserId: provider.userId,
    serviceId: service._id,
    catalogId: service.catalogId || null,
    scheduledAt: bookingDate,
    durationMinutes: duration,
    address,
    patientNotes: patientNotes || null,
    priceSnapshot: service.price,
    currencySnapshot: service.currency || "EGP",
    status: "pending_provider",
    bookingType: "direct"
  });

  // Notify provider
  await sendNotification({
    userId: provider.userId,
    role: "provider",
    type: "new_booking_request",
    title: "New Booking Request",
    body: `You received a new booking request for ${service.title} on ${bookingDate.toLocaleDateString()}.`,
    referenceType: "booking",
    referenceId: booking._id
  });

  return booking;
};

/**
 * List patient's bookings
 */
const getPatientBookings = async (patientUserId, queryParams = {}) => {
  const { status, page = 1, limit = 20 } = queryParams;
  const filter = { patientUserId };
  if (status) filter.status = status;

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const bookings = await Booking.find(filter)
    .populate({
      path: "providerId",
      select: "fullName photoUrl yearsOfExperience ratingAvg"
    })
    .populate({
      path: "serviceId",
      select: "title description price durationMinutes"
    })
    .sort({ scheduledAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  const total = await Booking.countDocuments(filter);

  return {
    bookings,
    pagination: {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / parseInt(limit, 10))
    }
  };
};

/**
 * List provider's bookings
 */
const getProviderBookings = async (providerUserId, queryParams = {}) => {
  const { status, page = 1, limit = 20 } = queryParams;
  const filter = { providerUserId };
  if (status) filter.status = status;

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const bookings = await Booking.find(filter)
    .populate({
      path: "patientId",
      select: "fullName gender dateOfBirth location healthInfo"
    })
    .populate({
      path: "serviceId",
      select: "title description price durationMinutes"
    })
    .sort({ scheduledAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  const total = await Booking.countDocuments(filter);

  return {
    bookings,
    pagination: {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / parseInt(limit, 10))
    }
  };
};

/**
 * Get booking details with ownership check
 */
const getBookingDetails = async (userId, bookingId) => {
  const booking = await Booking.findById(bookingId)
    .populate({
      path: "patientId",
      select: "fullName gender dateOfBirth location healthInfo"
    })
    .populate({
      path: "providerId",
      select: "fullName photoUrl yearsOfExperience ratingAvg"
    })
    .populate("serviceId")
    .populate("ratingId")
    .populate("timeProposalId");

  if (!booking) {
    const error = new Error("Booking not found.");
    error.statusCode = 404;
    throw error;
  }

  if (
    booking.patientUserId.toString() !== userId.toString() &&
    booking.providerUserId.toString() !== userId.toString()
  ) {
    const error = new Error("Access denied: You do not own this booking.");
    error.statusCode = 403;
    throw error;
  }

  return booking;
};

/**
 * Cancel a booking (Patient or Provider)
 */
const cancelBooking = async (userId, bookingId, reason, actorRole) => {
  if (!reason || !reason.trim()) {
    const error = new Error("Cancellation reason is required.");
    error.statusCode = 400;
    throw error;
  }

  const booking = await Booking.findById(bookingId);
  if (!booking) {
    const error = new Error("Booking not found.");
    error.statusCode = 404;
    throw error;
  }

  const isPatient = booking.patientUserId.toString() === userId.toString();
  const isProvider = booking.providerUserId.toString() === userId.toString();
  if (!isPatient && !isProvider) {
    const error = new Error("Access denied: You do not own this booking.");
    error.statusCode = 403;
    throw error;
  }

  const ALLOWED_CANCEL_STATUSES = ["pending_provider", "confirmed", "upcoming"];
  if (!ALLOWED_CANCEL_STATUSES.includes(booking.status)) {
    const error = new Error(`Cannot cancel a booking in '${booking.status}' status.`);
    error.statusCode = 400;
    throw error;
  }

  booking.status = "cancelled";
  booking.cancelledBy = isPatient ? "patient" : "provider";
  booking.cancellationReason = reason.trim();
  booking.cancelledAt = new Date();
  await booking.save();

  // If booking was created from offer and >= 2h away, reopen request
  if (booking.bookingType === "from_offer" && booking.requestId) {
    const now = new Date();
    const scheduled = new Date(booking.scheduledAt);
    if ((scheduled.getTime() - now.getTime()) >= 2 * 60 * 60 * 1000) {
      await PatientRequest.findByIdAndUpdate(booking.requestId, {
        $set: { status: "open", assignedOfferId: null, assignedBookingId: null }
      });
    }
  }

  // Notify counterparty
  const recipientUserId = isPatient ? booking.providerUserId : booking.patientUserId;
  await sendNotification({
    userId: recipientUserId,
    role: isPatient ? "provider" : "patient",
    type: "booking_cancelled",
    title: "Booking Cancelled",
    body: `Booking on ${new Date(booking.scheduledAt).toLocaleDateString()} was cancelled: ${reason.trim()}`,
    referenceType: "booking",
    referenceId: booking._id
  });

  return booking;
};

/**
 * Provider: Accept Booking
 */
const acceptBooking = async (providerUserId, bookingId) => {
  const booking = await Booking.findOne({ _id: bookingId, providerUserId });
  if (!booking) {
    const error = new Error("Booking not found or not assigned to you.");
    error.statusCode = 404;
    throw error;
  }

  if (booking.status !== "pending_provider") {
    const error = new Error(`Cannot accept a booking with status '${booking.status}'.`);
    error.statusCode = 400;
    throw error;
  }

  // Re-check overlap with confirmed, upcoming, in_progress bookings
  const hasOverlap = await checkProviderOverlap(
    booking.providerId,
    booking.scheduledAt,
    booking.durationMinutes,
    booking._id
  );
  if (hasOverlap) {
    const error = new Error("Slot collision: You have an overlapping active booking at this time.");
    error.statusCode = 409;
    error.code = "SLOT_TAKEN";
    throw error;
  }

  // Balance & Commission check
  const { balanceDoc } = await getOrCreateProviderBalance(providerUserId);
  const commissionRate = balanceDoc.commissionRate || 0.15;
  const estimatedCommission = Math.round(booking.priceSnapshot * commissionRate * 100) / 100;

  if (balanceDoc.balance < estimatedCommission) {
    const error = new Error(
      `Insufficient balance (${balanceDoc.balance} EGP). At least ${estimatedCommission} EGP required for commission.`
    );
    error.statusCode = 400;
    error.code = "INSUFFICIENT_BALANCE";
    throw error;
  }

  booking.status = "confirmed";
  booking.commissionRateSnapshot = commissionRate;
  booking.commissionAmountSnapshot = estimatedCommission;
  await booking.save();

  // Notify patient
  await sendNotification({
    userId: booking.patientUserId,
    role: "patient",
    type: "booking_accepted",
    title: "Booking Confirmed",
    body: `Your booking for ${new Date(booking.scheduledAt).toLocaleDateString()} has been confirmed!`,
    referenceType: "booking",
    referenceId: booking._id
  });

  return booking;
};

/**
 * Provider: Reject Booking
 */
const rejectBooking = async (providerUserId, bookingId, reason) => {
  const booking = await Booking.findOne({ _id: bookingId, providerUserId });
  if (!booking) {
    const error = new Error("Booking not found or not assigned to you.");
    error.statusCode = 404;
    throw error;
  }

  if (booking.status !== "pending_provider") {
    const error = new Error(`Cannot reject a booking with status '${booking.status}'.`);
    error.statusCode = 400;
    throw error;
  }

  booking.status = "provider_rejected";
  booking.rejectionReason = reason ? reason.trim() : "Declined by provider";
  await booking.save();

  await sendNotification({
    userId: booking.patientUserId,
    role: "patient",
    type: "booking_rejected",
    title: "Booking Declined",
    body: `Your booking request was declined: ${booking.rejectionReason}`,
    referenceType: "booking",
    referenceId: booking._id
  });

  return booking;
};

/**
 * Provider: Start Booking
 */
const startBooking = async (providerUserId, bookingId) => {
  const booking = await Booking.findOne({ _id: bookingId, providerUserId });
  if (!booking) {
    const error = new Error("Booking not found or not assigned to you.");
    error.statusCode = 404;
    throw error;
  }

  if (!["confirmed", "upcoming"].includes(booking.status)) {
    const error = new Error(`Cannot start a booking in '${booking.status}' status.`);
    error.statusCode = 400;
    throw error;
  }

  booking.status = "in_progress";
  await booking.save();

  return booking;
};

/**
 * Provider: Complete Booking
 * Deducts commission in same transaction, writes ledger entry, marks paid_cash
 */
const completeBooking = async (providerUserId, bookingId) => {
  const booking = await Booking.findOne({ _id: bookingId, providerUserId });
  if (!booking) {
    const error = new Error("Booking not found or not assigned to you.");
    error.statusCode = 404;
    throw error;
  }

  if (booking.status !== "in_progress") {
    const error = new Error(`Cannot complete a booking in '${booking.status}' status.`);
    error.statusCode = 400;
    throw error;
  }

  booking.status = "completed";
  booking.paymentStatus = "paid_cash";
  booking.completedAt = new Date();

  const commissionToDeduct = booking.commissionAmountSnapshot || (booking.priceSnapshot * 0.15);
  await booking.save();

  // Deduct commission and write ledger entry
  await deductCommission({
    providerId: booking.providerId,
    amount: commissionToDeduct,
    bookingId: booking._id
  });

  await sendNotification({
    userId: booking.patientUserId,
    role: "patient",
    type: "booking_completed",
    title: "Service Completed",
    body: "Your healthcare service has been completed. Please rate your experience!",
    referenceType: "booking",
    referenceId: booking._id
  });

  return booking;
};

/**
 * Patient: Rate Booking
 */
const rateBooking = async (patientUserId, bookingId, { stars, comment }) => {
  const booking = await Booking.findOne({ _id: bookingId, patientUserId });
  if (!booking) {
    const error = new Error("Booking not found or not owned by you.");
    error.statusCode = 404;
    throw error;
  }

  if (booking.status !== "completed") {
    const error = new Error("You can only rate a booking that is completed.");
    error.statusCode = 400;
    throw error;
  }

  if (booking.ratingId) {
    const error = new Error("You have already rated this booking.");
    error.statusCode = 409;
    throw error;
  }

  const numStars = parseInt(stars, 10);
  if (isNaN(numStars) || numStars < 1 || numStars > 5) {
    const error = new Error("Stars must be an integer between 1 and 5.");
    error.statusCode = 400;
    throw error;
  }

  const rating = await Rating.create({
    bookingId: booking._id,
    patientUserId,
    providerProfileId: booking.providerId,
    stars: numStars,
    comment: comment ? comment.trim() : null
  });

  booking.ratingId = rating._id;
  await booking.save();

  // Update provider aggregated rating
  const ratings = await Rating.find({ providerProfileId: booking.providerId });
  const totalStars = ratings.reduce((sum, r) => sum + r.stars, 0);
  const avg = Math.round((totalStars / ratings.length) * 10) / 10;

  await ProviderProfile.findByIdAndUpdate(booking.providerId, {
    $set: { ratingAvg: avg, ratingCount: ratings.length }
  });

  return rating;
};

/**
 * Provider: Propose new time
 */
const proposeTime = async (providerUserId, bookingId, proposedScheduledAt) => {
  const booking = await Booking.findOne({ _id: bookingId, providerUserId });
  if (!booking) {
    const error = new Error("Booking not found or not assigned to you.");
    error.statusCode = 404;
    throw error;
  }

  if (!["pending_provider", "confirmed"].includes(booking.status)) {
    const error = new Error(`Cannot propose time for booking in '${booking.status}' status.`);
    error.statusCode = 400;
    throw error;
  }

  const newTime = new Date(proposedScheduledAt);
  const now = new Date();
  if (isNaN(newTime.getTime()) || newTime < new Date(now.getTime() + 2 * 60 * 60 * 1000)) {
    const error = new Error("Proposed time must be at least 2 hours from now.");
    error.statusCode = 400;
    throw error;
  }

  // Check overlap
  const hasOverlap = await checkProviderOverlap(booking.providerId, newTime, booking.durationMinutes, booking._id);
  if (hasOverlap) {
    const error = new Error("Slot collision: Proposed time overlaps another active booking.");
    error.statusCode = 409;
    throw error;
  }

  // Expires in 30 minutes or when original time arrives
  const expiresAt = new Date(Math.min(now.getTime() + 30 * 60 * 1000, new Date(booking.scheduledAt).getTime()));

  const proposal = await TimeProposal.create({
    bookingId: booking._id,
    proposerUserId: providerUserId,
    proposerRole: "provider",
    originalScheduledAt: booking.scheduledAt,
    proposedScheduledAt: newTime,
    status: "pending",
    expiresAt
  });

  booking.timeProposalId = proposal._id;
  await booking.save();

  await sendNotification({
    userId: booking.patientUserId,
    role: "patient",
    type: "time_proposal",
    title: "New Time Proposed",
    body: `The provider proposed a new time for your booking: ${newTime.toLocaleString()}.`,
    referenceType: "booking",
    referenceId: booking._id
  });

  return proposal;
};

/**
 * Patient: Answer time proposal
 */
const answerTimeProposal = async (patientUserId, bookingId, { action, reason }) => {
  const booking = await Booking.findOne({ _id: bookingId, patientUserId }).populate("timeProposalId");
  if (!booking || !booking.timeProposalId) {
    const error = new Error("No active time proposal found for this booking.");
    error.statusCode = 404;
    throw error;
  }

  const proposal = booking.timeProposalId;
  const now = new Date();

  if (proposal.status !== "pending" || now > proposal.expiresAt) {
    proposal.status = "expired";
    await proposal.save();
    const error = new Error("The time proposal has expired.");
    error.statusCode = 400;
    error.code = "PROPOSAL_EXPIRED";
    throw error;
  }

  if (!["accept", "decline", "cancel"].includes(action)) {
    const error = new Error("Invalid action. Must be 'accept', 'decline', or 'cancel'.");
    error.statusCode = 400;
    throw error;
  }

  if (action === "accept") {
    proposal.status = "accepted";
    proposal.decidedAt = now;
    booking.scheduledAt = proposal.proposedScheduledAt;
    booking.timeProposalId = null;
    await proposal.save();
    await booking.save();
  } else if (action === "decline") {
    proposal.status = "declined";
    proposal.decidedAt = now;
    booking.timeProposalId = null;
    await proposal.save();
    await booking.save();
  } else if (action === "cancel") {
    if (!reason || !reason.trim()) {
      const error = new Error("Cancellation reason required when cancelling via proposal.");
      error.statusCode = 400;
      throw error;
    }
    proposal.status = "cancelled";
    proposal.actionReason = reason.trim();
    proposal.decidedAt = now;
    await proposal.save();
    await cancelBooking(patientUserId, bookingId, reason, "patient");
  }

  return { booking, proposal };
};

module.exports = {
  createPatientBooking,
  getPatientBookings,
  getProviderBookings,
  getBookingDetails,
  cancelBooking,
  acceptBooking,
  rejectBooking,
  startBooking,
  completeBooking,
  rateBooking,
  proposeTime,
  answerTimeProposal
};
