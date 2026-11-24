const mongoose = require("mongoose");
const { ServiceRequest, REQUEST_STATUSES } = require("../models/ServiceRequest");
const { Service } = require("../models/Service");
const ProviderProfile = require("../models/ProviderProfile");
const PatientProfile = require("../models/PatientProfile");
const { ServiceAuditLog } = require("../models/ServiceAuditLog");
const { ExceptionalCancellationRequest } = require("../models/ExceptionalCancellationRequest");
const { validatePatientBookingEligibility } = require("./service.service");

/**
 * Patient: Create Service Request (Booking)
 * Security rules:
 * - Patient must be verified under platform policy.
 * - Service must be published, not suspended/rejected.
 * - Provider must be currently approved.
 * - Patient cannot book their own service (if user has dual roles or same user).
 * - Price & title snapshots taken directly from DB (never client-supplied).
 * - Scheduled date must be in the future.
 * - Prevent conflicting concurrent duplicate bookings for same patient & service within 1 hour.
 */
const createServiceRequest = async (userId, bookingData) => {
  const { profile: patientProfile } = await validatePatientBookingEligibility(userId);

  const { serviceId, scheduledAt, address, patientNotes } = bookingData;

  if (!serviceId || !scheduledAt || !address || !address.governorate || !address.city || !address.street) {
    const error = new Error("Missing required booking fields (serviceId, scheduledAt, complete address).");
    error.statusCode = 400;
    throw error;
  }

  const bookingDate = new Date(scheduledAt);
  if (isNaN(bookingDate.getTime()) || bookingDate <= new Date()) {
    const error = new Error("Scheduled date and time must be a valid future timestamp.");
    error.statusCode = 400;
    throw error;
  }

  const service = await Service.findById(serviceId).populate("providerId");
  if (!service) {
    const error = new Error("Service not found.");
    error.statusCode = 404;
    throw error;
  }

  if (
    service.publicationStatus !== "published" ||
    service.moderationStatus === "rejected" ||
    service.moderationStatus === "suspended"
  ) {
    const error = new Error("This service is currently unavailable for booking.");
    error.statusCode = 400;
    throw error;
  }

  const provider = service.providerId;
  if (!provider || !provider.isApproved) {
    const error = new Error("The provider is not currently authorized to accept service requests.");
    error.statusCode = 400;
    throw error;
  }

  // Prevent self-booking
  if (provider.userId.toString() === userId.toString()) {
    const error = new Error("Conflict: You cannot book your own service.");
    error.statusCode = 400;
    throw error;
  }

  // Check service area match if service specifies areas
  if (service.serviceAreas && service.serviceAreas.length > 0) {
    const areaMatch = service.serviceAreas.some(
      (a) =>
        a.governorate.toLowerCase() === address.governorate.trim().toLowerCase() &&
        (!a.city || a.city.toLowerCase() === address.city.trim().toLowerCase())
    );
    if (!areaMatch) {
      const error = new Error(
        `Service is not available in requested area (${address.governorate}, ${address.city}).`
      );
      error.statusCode = 400;
      throw error;
    }
  }

  // Prevent duplicate conflicting booking for the same patient and service at the same scheduled time window (+- 30 mins)
  const windowStart = new Date(bookingDate.getTime() - 30 * 60 * 1000);
  const windowEnd = new Date(bookingDate.getTime() + 30 * 60 * 1000);

  const existingRequest = await ServiceRequest.findOne({
    patientId: patientProfile._id,
    serviceId: service._id,
    scheduledAt: { $gte: windowStart, $lte: windowEnd },
    status: { $in: ["pending", "accepted", "confirmed"] }
  });

  if (existingRequest) {
    const error = new Error(
      "You already have an active or pending request for this service around the requested time."
    );
    error.statusCode = 409;
    throw error;
  }

  // Atomic creation with snapshots
  const newRequest = await ServiceRequest.create({
    patientId: patientProfile._id,
    patientUserId: userId,
    providerId: provider._id,
    providerUserId: provider.userId,
    serviceId: service._id,
    scheduledAt: bookingDate,
    address,
    patientNotes: patientNotes || null,
    priceSnapshot: service.price,
    currencySnapshot: service.currency || "EGP",
    serviceTitleSnapshot: service.title,
    serviceDurationMinutesSnapshot: service.durationMinutes,
    status: "pending"
  });

  await ServiceAuditLog.create({
    targetType: "service_request",
    targetId: newRequest._id,
    action: "request_created",
    actorType: "patient",
    actorId: userId.toString(),
    previousStatus: null,
    newStatus: "pending",
    reason: "Patient booked service request",
    changes: {
      serviceId: service._id,
      scheduledAt: bookingDate,
      priceSnapshot: service.price
    }
  });

  return newRequest;
};

/**
 * Check if booking is eligible for normal cancellation (> 60 minutes before scheduled start)
 */
const NORMAL_CANCELLATION_MIN_MINUTES = 60;

/**
 * Normal Cancellation:
 * Both Patients and Providers can cancel a booking normally only when:
 * - At least 60 minutes remain before scheduled session start.
 * - Reason is required.
 * - Booking has not reached 'in_progress', 'completed', 'cancelled', or 'rejected'.
 */
const cancelServiceRequest = async (userId, requestId, reason, role = null) => {
  if (!reason || !reason.trim()) {
    const error = new Error("Cancellation reason is required.");
    error.statusCode = 400;
    throw error;
  }

  // Find request ensuring user is either the patient or the provider
  const request = await ServiceRequest.findById(requestId);

  if (!request) {
    const error = new Error("Service request not found.");
    error.statusCode = 404;
    throw error;
  }

  const isPatient = request.patientUserId.toString() === userId.toString();
  const isProvider = request.providerUserId.toString() === userId.toString();

  if (!isPatient && !isProvider) {
    const error = new Error("Access denied: You do not own this service request.");
    error.statusCode = 403;
    throw error;
  }

  const cancellingRole = isPatient ? "patient" : "provider";
  if (role && role !== cancellingRole) {
    const error = new Error("Role mismatch for cancellation.");
    error.statusCode = 403;
    throw error;
  }

  // Terminal state check
  if (["cancelled", "rejected", "completed"].includes(request.status)) {
    const error = new Error(`Cannot cancel a request that is already ${request.status}.`);
    error.statusCode = 400;
    throw error;
  }

  // Normal cancellation is not allowed after in_progress
  if (request.status === "in_progress") {
    const error = new Error(
      "Normal cancellation is not allowed once service is in progress. Please submit an exceptional cancellation request for support review."
    );
    error.statusCode = 400;
    throw error;
  }

  // Enforce >= 60 minutes rule
  const now = new Date();
  const scheduledTime = new Date(request.scheduledAt);
  const minutesUntilSession = (scheduledTime.getTime() - now.getTime()) / (60 * 1000);

  if (minutesUntilSession < NORMAL_CANCELLATION_MIN_MINUTES) {
    const error = new Error(
      `Normal cancellation is rejected: Less than 60 minutes remain before the scheduled session (remaining: ${Math.max(
        0,
        Math.floor(minutesUntilSession)
      )} minutes). You may submit an exceptional cancellation request.`
    );
    error.statusCode = 400;
    throw error;
  }

  const prevStatus = request.status;
  request.status = "cancelled";
  request.cancelledBy = cancellingRole;
  request.cancellationReason = reason.trim();
  request.cancelledAt = new Date();

  await request.save();

  await ServiceAuditLog.create({
    targetType: "service_request",
    targetId: request._id,
    action: "request_cancelled",
    actorType: cancellingRole,
    actorId: userId.toString(),
    previousStatus: prevStatus,
    newStatus: "cancelled",
    reason: request.cancellationReason
  });

  return request;
};

/**
 * Submit Exceptional Cancellation Request (Patient or Provider)
 * Used when < 60 minutes remain, or when service has started (in_progress)
 */
const requestExceptionalCancellation = async (userId, requestId, { reason, supportingDetails }, userRole) => {
  if (!reason || !reason.trim()) {
    const error = new Error("Reason for exceptional cancellation request is required.");
    error.statusCode = 400;
    throw error;
  }

  const request = await ServiceRequest.findById(requestId);
  if (!request) {
    const error = new Error("Service request not found.");
    error.statusCode = 404;
    throw error;
  }

  const isPatient = request.patientUserId.toString() === userId.toString();
  const isProvider = request.providerUserId.toString() === userId.toString();

  if (!isPatient && !isProvider) {
    const error = new Error("Access denied: You do not own this service request.");
    error.statusCode = 403;
    throw error;
  }

  const actualRole = isPatient ? "patient" : "provider";

  // Terminal check: Completed or already cancelled requests cannot have new exceptional cancellation requests
  if (["completed", "cancelled", "rejected"].includes(request.status)) {
    const error = new Error(
      `Cannot submit an exceptional cancellation request for a booking that is already '${request.status}'.`
    );
    error.statusCode = 400;
    throw error;
  }

  // Prevent duplicate pending requests for the same booking and requester
  const existingPending = await ExceptionalCancellationRequest.findOne({
    serviceRequestId: request._id,
    requesterId: userId,
    status: "pending_review"
  });

  if (existingPending) {
    const error = new Error(
      "You already have a pending exceptional cancellation request for this booking."
    );
    error.statusCode = 409;
    throw error;
  }

  const exceptionalRequest = await ExceptionalCancellationRequest.create({
    serviceRequestId: request._id,
    requesterId: userId,
    requesterRole: actualRole,
    reason: reason.trim(),
    supportingDetails: supportingDetails ? supportingDetails.trim() : null,
    status: "pending_review",
    requestBookingStatusAtSubmission: request.status
  });

  await ServiceAuditLog.create({
    targetType: "service_request",
    targetId: request._id,
    action: "exceptional_cancellation_requested",
    actorType: actualRole,
    actorId: userId.toString(),
    previousStatus: request.status,
    newStatus: request.status, // Booking status unchanged at this stage
    reason: `Exceptional cancellation requested: ${reason.trim()}`
  });

  return exceptionalRequest;
};

/**
 * Provider: Respond to Service Request (Accept or Reject)
 */
const respondToServiceRequest = async (userId, requestId, action, reason) => {
  const request = await ServiceRequest.findOne({
    _id: requestId,
    providerUserId: userId
  });

  if (!request) {
    const error = new Error("Service request not found or not assigned to you.");
    error.statusCode = 404;
    throw error;
  }

  if (request.status !== "pending") {
    const error = new Error(`Cannot respond to a request that is in '${request.status}' status.`);
    error.statusCode = 400;
    throw error;
  }

  if (!["accept", "reject"].includes(action)) {
    const error = new Error("Invalid action. Must be 'accept' or 'reject'.");
    error.statusCode = 400;
    throw error;
  }

  const prevStatus = request.status;
  if (action === "accept") {
    request.status = "accepted";
    request.providerResponseAt = new Date();
  } else {
    request.status = "rejected";
    request.providerResponseAt = new Date();
    request.providerResponseReason = reason || "Declined by provider";
  }

  await request.save();

  await ServiceAuditLog.create({
    targetType: "service_request",
    targetId: request._id,
    action: action === "accept" ? "request_accepted" : "request_rejected",
    actorType: "provider",
    actorId: userId.toString(),
    previousStatus: prevStatus,
    newStatus: request.status,
    reason: reason || (action === "accept" ? "Accepted by provider" : "Rejected by provider")
  });

  return request;
};

/**
 * Provider: Update Request Execution Status
 * Allowed transitions:
 * - accepted -> confirmed
 * - confirmed -> in_progress
 * - in_progress -> completed
 */
const updateRequestExecutionStatus = async (userId, requestId, nextStatus, notes) => {
  const request = await ServiceRequest.findOne({
    _id: requestId,
    providerUserId: userId
  });

  if (!request) {
    const error = new Error("Service request not found or not assigned to you.");
    error.statusCode = 404;
    throw error;
  }

  const VALID_TRANSITIONS = {
    accepted: ["confirmed", "cancelled"],
    confirmed: ["in_progress", "cancelled"],
    in_progress: ["completed"]
  };

  const allowedNext = VALID_TRANSITIONS[request.status];
  if (!allowedNext || !allowedNext.includes(nextStatus)) {
    const error = new Error(
      `Invalid status transition: Cannot transition from '${request.status}' to '${nextStatus}'.`
    );
    error.statusCode = 400;
    throw error;
  }

  const prevStatus = request.status;
  request.status = nextStatus;

  if (nextStatus === "completed") {
    request.completedAt = new Date();
  }

  // If provider cancels via status update, delegate to normal cancel checks
  if (nextStatus === "cancelled") {
    return cancelServiceRequest(userId, requestId, notes || "Cancelled by provider", "provider");
  }

  await request.save();

  const ACTION_MAP = {
    confirmed: "request_confirmed",
    in_progress: "request_in_progress",
    completed: "request_completed",
    cancelled: "request_cancelled"
  };

  await ServiceAuditLog.create({
    targetType: "service_request",
    targetId: request._id,
    action: ACTION_MAP[nextStatus],
    actorType: "provider",
    actorId: userId.toString(),
    previousStatus: prevStatus,
    newStatus: nextStatus,
    reason: notes || `Provider moved request to ${nextStatus}`
  });

  return request;
};

/**
 * Patient: Get My Requests
 */
const getPatientRequests = async (userId, queryParams = {}) => {
  const { page = 1, limit = 20, status } = queryParams;
  const filter = { patientUserId: userId };
  if (status) filter.status = status;

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const requests = await ServiceRequest.find(filter)
    .populate({
      path: "providerId",
      select: "fullName photoUrl yearsOfExperience ratingAvg"
    })
    .populate({
      path: "serviceId",
      select: "title description price durationMinutes serviceAreas"
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  const total = await ServiceRequest.countDocuments(filter);

  return {
    requests,
    pagination: {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / parseInt(limit, 10))
    }
  };
};

/**
 * Provider: Get Received Requests
 */
const getProviderRequests = async (userId, queryParams = {}) => {
  const { page = 1, limit = 20, status } = queryParams;
  const filter = { providerUserId: userId };
  if (status) filter.status = status;

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const requests = await ServiceRequest.find(filter)
    .populate({
      path: "patientId",
      select: "fullName gender dateOfBirth location healthInfo"
    })
    .populate({
      path: "serviceId",
      select: "title description price durationMinutes"
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  const total = await ServiceRequest.countDocuments(filter);

  return {
    requests,
    pagination: {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / parseInt(limit, 10))
    }
  };
};

/**
 * Get Single Request Details (Role-checked)
 */
const getRequestDetails = async (userId, requestId) => {
  const request = await ServiceRequest.findById(requestId)
    .populate({
      path: "patientId",
      select: "fullName gender location healthInfo"
    })
    .populate({
      path: "providerId",
      select: "fullName photoUrl yearsOfExperience ratingAvg"
    })
    .populate("serviceId");

  if (!request) {
    const error = new Error("Service request not found.");
    error.statusCode = 404;
    throw error;
  }

  // Cross-user access protection
  if (
    request.patientUserId.toString() !== userId.toString() &&
    request.providerUserId.toString() !== userId.toString()
  ) {
    const error = new Error("Access denied: You do not own this service request.");
    error.statusCode = 403;
    throw error;
  }

  return request;
};

module.exports = {
  createServiceRequest,
  cancelServiceRequest,
  requestExceptionalCancellation,
  respondToServiceRequest,
  updateRequestExecutionStatus,
  getPatientRequests,
  getProviderRequests,
  getRequestDetails
};
