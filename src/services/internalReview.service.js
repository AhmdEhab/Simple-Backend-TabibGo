const ProviderApplication = require("../models/ProviderApplication");
const ProviderProfile = require("../models/ProviderProfile");
const { ProviderVerification } = require("../models/ProviderVerification");
const { UserDocument } = require("../models/UserDocument");
const { DocumentAuditLog } = require("../models/DocumentAuditLog");
const { getProviderDocumentRules } = require("./document.service");
const fs = require("fs");
const path = require("path");

/**
 * Validate that all configured mandatory verification conditions are met before application approval:
 * 1. All 4 verification stages must have status: "verified".
 * 2. All mandatory documents for the provider's profession must have an active version in "approved" status.
 * 3. No active document for the provider can be in "rejected" status.
 * 4. A previous approved document cannot satisfy the requirement if the latest active version is rejected or pending.
 */
const validateProviderApprovalPrerequisites = async (provider) => {
  const userId = provider.userId;
  const verification = await getOrCreateProviderVerification(provider._id, userId);

  // 1. Stage checks
  const requiredStages = [
    { key: "identityVerification", label: "Identity Verification" },
    { key: "licenseVerification", label: "Professional License Verification" },
    { key: "experienceVerification", label: "Experience Verification" },
    { key: "skillsAssessment", label: "Skills Assessment" }
  ];

  const unverifiedStages = [];
  for (const stage of requiredStages) {
    if (!verification[stage.key] || verification[stage.key].status !== "verified") {
      unverifiedStages.push(`${stage.label} (current status: '${verification[stage.key]?.status || "not_started"}')`);
    }
  }

  // 2. Active document checks
  const rules = await getProviderDocumentRules(userId);
  const mandatoryRules = rules.filter((r) => r.required);

  const activeDocs = await UserDocument.find({
    userId,
    isActiveVersion: true
  });

  const activeDocMap = new Map();
  activeDocs.forEach((d) => {
    if (!activeDocMap.has(d.documentType)) {
      activeDocMap.set(d.documentType, []);
    }
    activeDocMap.get(d.documentType).push(d);
  });

  const unapprovedMandatoryDocs = [];
  const activeRejectedDocs = [];

  for (const rule of mandatoryRules) {
    let docs = activeDocMap.get(rule.type) || [];
    if (docs.length === 0 && rule.legacyType) {
      docs = activeDocMap.get(rule.legacyType) || [];
    }

    if (docs.length === 0) {
      unapprovedMandatoryDocs.push(`${rule.label} (Missing active document)`);
    } else {
      const hasApproved = docs.some((d) => d.status === "approved");
      if (!hasApproved) {
        unapprovedMandatoryDocs.push(`${rule.label} (Active version status: '${docs[0].status}')`);
      }
    }
  }

  // Check if any active document is rejected
  activeDocs.forEach((d) => {
    if (d.status === "rejected") {
      activeRejectedDocs.push(`${d.documentType} (Rejection reason: ${d.rejectionReason || "None"})`);
    }
  });

  const errors = [];
  if (unverifiedStages.length > 0) {
    errors.push(`Incomplete verification stages: [${unverifiedStages.join("; ")}]`);
  }
  if (unapprovedMandatoryDocs.length > 0) {
    errors.push(`Unapproved mandatory documents: [${unapprovedMandatoryDocs.join("; ")}]`);
  }
  if (activeRejectedDocs.length > 0) {
    errors.push(`Active documents currently in rejected status: [${activeRejectedDocs.join("; ")}]`);
  }

  return {
    isEligible: errors.length === 0,
    errors
  };
};

/**
 * Get or initialize ProviderVerification record
 */
const getOrCreateProviderVerification = async (providerId, userId) => {
  let verification = await ProviderVerification.findOne({ providerId });
  if (!verification) {
    verification = await ProviderVerification.create({
      providerId,
      userId,
      overallStatus: "in_progress"
    });
  }
  return verification;
};

/**
 * List pending provider applications for Admin Review
 */
const getPendingApplications = async ({ page = 1, limit = 20, status } = {}) => {
  const query = {};
  if (status) {
    query.status = status;
  } else {
    query.status = { $in: ["submitted", "under_review", "interview_required"] };
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const applications = await ProviderApplication.find(query)
    .populate({
      path: "providerId",
      populate: { path: "professionId", select: "name description" }
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  const total = await ProviderApplication.countDocuments(query);

  return {
    applications,
    pagination: {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / parseInt(limit, 10))
    }
  };
};

/**
 * Get complete application details including profile, verification stages, and documents
 */
const getApplicationDetails = async (applicationId) => {
  const application = await ProviderApplication.findById(applicationId).populate({
    path: "providerId",
    populate: { path: "professionId", select: "name description" }
  });

  if (!application) {
    const error = new Error("Provider application not found.");
    error.statusCode = 404;
    throw error;
  }

  const provider = application.providerId;
  const verification = await getOrCreateProviderVerification(provider._id, provider.userId);

  // Fetch active documents
  const documents = await UserDocument.find({
    userId: provider.userId,
    isActiveVersion: true
  }).select("-storageKey");

  // Fetch review audit logs
  const auditLogs = await DocumentAuditLog.find({
    userId: provider.userId
  }).sort({ timestamp: -1 }).limit(50);

  return {
    application,
    provider,
    verification,
    documents,
    auditLogs
  };
};

/**
 * Get private document metadata for admin review
 */
const getProviderDocumentMetadata = async (documentId) => {
  const document = await UserDocument.findById(documentId);
  if (!document) {
    const error = new Error("Document not found.");
    error.statusCode = 404;
    throw error;
  }
  return document;
};

/**
 * Private secure file streaming for authorized Admin Reviewer
 */
const getDocumentFileForAdmin = async (documentId) => {
  const document = await UserDocument.findById(documentId);
  if (!document) {
    const error = new Error("Document not found.");
    error.statusCode = 404;
    throw error;
  }

  const resolvedPath = path.resolve(document.storageKey);
  if (!fs.existsSync(resolvedPath)) {
    const error = new Error("Physical document file missing from storage.");
    error.statusCode = 404;
    throw error;
  }

  return {
    filePath: resolvedPath,
    mimeType: document.mimeType,
    fileName: document.originalFileName
  };
};

/**
 * Review an individual document (Approve or Reject)
 */
const reviewDocument = async ({
  documentId,
  decision, // "approve" or "reject"
  reason,
  adminId
}) => {
  const document = await UserDocument.findById(documentId);
  if (!document) {
    const error = new Error("Document not found.");
    error.statusCode = 404;
    throw error;
  }

  const previousStatus = document.status;
  const newStatus = decision === "approve" ? "approved" : "rejected";

  document.status = newStatus;
  document.rejectionReason = decision === "reject" ? (reason || "Document rejected by reviewer.") : null;
  document.reviewedAt = new Date();
  document.reviewedBy = adminId;
  await document.save();

  // Audit log
  await DocumentAuditLog.create({
    targetType: "document",
    targetId: document._id,
    userId: document.userId,
    action: decision === "approve" ? "document_approved" : "document_rejected",
    previousStatus,
    newStatus,
    actorType: "admin",
    actorId: adminId,
    reason: document.rejectionReason,
    metadata: {
      documentType: document.documentType,
      fileName: document.originalFileName,
      version: document.version
    }
  });

  return document;
};

/**
 * Record a verification stage decision
 */
const updateVerificationStage = async ({
  providerId,
  stageName, // "identityVerification", "licenseVerification", "experienceVerification", "skillsAssessment"
  status, // "pending", "under_review", "verified", "rejected", "requires_action"
  reviewNotes,
  rejectionReason,
  verificationMethod,
  supportingDocumentIds = [],
  adminId
}) => {
  const validStages = [
    "identityVerification",
    "licenseVerification",
    "experienceVerification",
    "skillsAssessment"
  ];

  if (!validStages.includes(stageName)) {
    const error = new Error(`Invalid verification stage: '${stageName}'. Valid stages: ${validStages.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  const provider = await ProviderProfile.findById(providerId);
  if (!provider) {
    const error = new Error("Provider profile not found.");
    error.statusCode = 404;
    throw error;
  }

  const verification = await getOrCreateProviderVerification(providerId, provider.userId);
  const previousStatus = verification[stageName].status;

  verification[stageName] = {
    status,
    reviewNotes: reviewNotes || null,
    rejectionReason: rejectionReason || null,
    reviewedBy: adminId,
    reviewedAt: new Date(),
    verificationMethod: verificationMethod || "manual_review",
    supportingDocumentIds: supportingDocumentIds || []
  };

  // Evaluate overallStatus
  const stages = [
    verification.identityVerification.status,
    verification.licenseVerification.status,
    verification.experienceVerification.status,
    verification.skillsAssessment.status
  ];

  if (stages.every((s) => s === "verified")) {
    verification.overallStatus = "verified";
  } else if (stages.some((s) => s === "rejected")) {
    verification.overallStatus = "rejected";
  } else {
    verification.overallStatus = "in_progress";
  }

  await verification.save();

  // Audit log
  await DocumentAuditLog.create({
    targetType: "verification_stage",
    targetId: verification._id,
    userId: provider.userId,
    action: "verification_stage_updated",
    previousStatus,
    newStatus: status,
    actorType: "admin",
    actorId: adminId,
    reason: rejectionReason || reviewNotes,
    metadata: {
      stageName,
      verificationMethod,
      overallStatus: verification.overallStatus
    }
  });

  return verification;
};

/**
 * Decide Provider Application (Approve or Reject)
 */
const decideProviderApplication = async ({
  applicationId,
  decision, // "approve", "reject", "interview_required", "under_review"
  reason,
  adminId
}) => {
  const application = await ProviderApplication.findById(applicationId);
  if (!application) {
    const error = new Error("Provider application not found.");
    error.statusCode = 404;
    throw error;
  }

  const provider = await ProviderProfile.findById(application.providerId);
  if (!provider) {
    const error = new Error("Associated provider profile not found.");
    error.statusCode = 404;
    throw error;
  }

  const previousStatus = application.status;
  const now = new Date();

  if (decision === "approve") {
    // Enforce strict approval prerequisites
    const check = await validateProviderApprovalPrerequisites(provider);
    if (!check.isEligible) {
      const error = new Error(`Cannot approve provider application due to unmet prerequisites: ${check.errors.join(" | ")}`);
      error.statusCode = 400;
      error.details = check.errors;
      throw error;
    }

    const verification = await getOrCreateProviderVerification(provider._id, provider.userId);
    
    application.status = "approved";
    application.decidedAt = now;
    application.decidedByAdminId = adminId;
    application.decisionReason = reason || "Application approved by admin committee.";
    await application.save();

    provider.isApproved = true;
    await provider.save();

    verification.overallStatus = "verified";
    await verification.save();

    await DocumentAuditLog.create({
      targetType: "application",
      targetId: application._id,
      userId: provider.userId,
      action: "application_approved",
      previousStatus,
      newStatus: "approved",
      actorType: "admin",
      actorId: adminId,
      reason: application.decisionReason
    });
  } else if (decision === "reject") {
    application.status = "rejected";
    application.decidedAt = now;
    application.decidedByAdminId = adminId;
    application.decisionReason = reason || "Application rejected.";
    await application.save();

    provider.isApproved = false;
    await provider.save();

    // Automatically hide/deactivate any published services for this provider
    const { syncProviderServiceStatusOnRevocation } = require("./service.service");
    await syncProviderServiceStatusOnRevocation(provider._id, "Application rejected by admin", adminId);

    await DocumentAuditLog.create({
      targetType: "application",
      targetId: application._id,
      userId: provider.userId,
      action: "application_rejected",
      previousStatus,
      newStatus: "rejected",
      actorType: "admin",
      actorId: adminId,
      reason: application.decisionReason
    });
  } else if (["interview_required", "under_review"].includes(decision)) {
    application.status = decision;
    application.decisionReason = reason || null;
    await application.save();

    await DocumentAuditLog.create({
      targetType: "application",
      targetId: application._id,
      userId: provider.userId,
      action: decision === "interview_required" ? "application_interview_scheduled" : "verification_stage_updated",
      previousStatus,
      newStatus: decision,
      actorType: "admin",
      actorId: adminId,
      reason
    });
  } else {
    const error = new Error(`Invalid decision: '${decision}'. Allowed: approve, reject, interview_required, under_review.`);
    error.statusCode = 400;
    throw error;
  }

  return {
    application,
    provider
  };
};

/**
 * Get review and audit history for a provider
 */
const getProviderAuditHistory = async (providerId) => {
  const provider = await ProviderProfile.findById(providerId);
  if (!provider) {
    const error = new Error("Provider profile not found.");
    error.statusCode = 404;
    throw error;
  }

  const logs = await DocumentAuditLog.find({ userId: provider.userId }).sort({ timestamp: -1 });
  const documents = await UserDocument.find({ userId: provider.userId }).sort({ uploadedAt: -1 });
  const applications = await ProviderApplication.find({ providerId }).sort({ createdAt: -1 });

  return {
    provider,
    applications,
    documents,
    logs
  };
};

const { Service } = require("../models/Service");
const { ServiceAuditLog } = require("../models/ServiceAuditLog");

/**
 * Admin: List services for moderation
 */
const getServicesForAdmin = async ({ page = 1, limit = 20, moderationStatus, publicationStatus, professionId } = {}) => {
  const query = {};
  if (moderationStatus) query.moderationStatus = moderationStatus;
  if (publicationStatus) query.publicationStatus = publicationStatus;
  if (professionId) query.professionId = professionId;

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const services = await Service.find(query)
    .populate({
      path: "providerId",
      select: "fullName photoUrl yearsOfExperience isApproved professionId"
    })
    .populate("professionId", "name")
    .populate("categoryId", "name")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  const total = await Service.countDocuments(query);

  return {
    services,
    pagination: {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / parseInt(limit, 10))
    }
  };
};

/**
 * Admin: Get single service details
 */
const getServiceDetailsForAdmin = async (serviceId) => {
  const service = await Service.findById(serviceId)
    .populate({
      path: "providerId",
      populate: { path: "userId", select: "email role isActive emailVerified" }
    })
    .populate("professionId", "name description")
    .populate("categoryId", "name");

  if (!service) {
    const error = new Error("Service not found.");
    error.statusCode = 404;
    throw error;
  }

  return service;
};

/**
 * Admin: Moderate a Service (Approve or Reject)
 * - Approval: moderationStatus = approved (service remains published)
 * - Rejection: moderationStatus = rejected, publicationStatus = hidden
 */
const reviewService = async (serviceId, { decision, rejectionReason }, adminId = "admin_service") => {
  const service = await Service.findById(serviceId);
  if (!service) {
    const error = new Error("Service not found.");
    error.statusCode = 404;
    throw error;
  }

  if (!["approve", "reject"].includes(decision)) {
    const error = new Error("Invalid decision. Must be 'approve' or 'reject'.");
    error.statusCode = 400;
    throw error;
  }

  if (decision === "reject" && (!rejectionReason || !rejectionReason.trim())) {
    const error = new Error("Rejection reason is required when rejecting a service.");
    error.statusCode = 400;
    throw error;
  }

  const prevModeration = service.moderationStatus;
  const prevPublication = service.publicationStatus;

  service.reviewedBy = adminId;
  service.reviewedAt = new Date();

  if (decision === "approve") {
    service.moderationStatus = "approved";
    service.rejectionReason = null;
  } else {
    service.moderationStatus = "rejected";
    service.publicationStatus = "hidden"; // Automatically hide rejected service
    service.rejectionReason = rejectionReason.trim();
  }

  await service.save();

  await ServiceAuditLog.create({
    targetType: "service",
    targetId: service._id,
    action: decision === "approve" ? "service_moderation_approved" : "service_moderation_rejected",
    actorType: "admin",
    actorId: adminId,
    previousStatus: prevModeration,
    newStatus: service.moderationStatus,
    reason: decision === "reject" ? rejectionReason : "Approved by administrator",
    changes: {
      publicationStatus: { from: prevPublication, to: service.publicationStatus },
      moderationStatus: { from: prevModeration, to: service.moderationStatus }
    }
  });

  return service;
};

/**
 * Admin: Suspend a Service
 * Changes publicationStatus to hidden and moderationStatus to suspended
 */
const suspendService = async (serviceId, { suspensionReason }, adminId = "admin_service") => {
  const service = await Service.findById(serviceId);
  if (!service) {
    const error = new Error("Service not found.");
    error.statusCode = 404;
    throw error;
  }

  if (!suspensionReason || !suspensionReason.trim()) {
    const error = new Error("Suspension reason is required.");
    error.statusCode = 400;
    throw error;
  }

  const prevModeration = service.moderationStatus;
  const prevPublication = service.publicationStatus;

  service.moderationStatus = "suspended";
  service.publicationStatus = "hidden";
  service.suspensionReason = suspensionReason.trim();
  service.reviewedBy = adminId;
  service.reviewedAt = new Date();

  await service.save();

  await ServiceAuditLog.create({
    targetType: "service",
    targetId: service._id,
    action: "service_suspended",
    actorType: "admin",
    actorId: adminId,
    previousStatus: prevModeration,
    newStatus: "suspended",
    reason: suspensionReason.trim(),
    changes: {
      publicationStatus: { from: prevPublication, to: "hidden" },
      moderationStatus: { from: prevModeration, to: "suspended" }
    }
  });

  return service;
};

/**
 * Admin: Restore a suspended or rejected Service
 * Requirements:
 * - Only services with moderationStatus in ["suspended", "rejected"] can be restored.
 * - Provider must currently be active, approved, and verified.
 * - If the service was intentionally hidden (by provider) or archived, it must NOT be republished.
 * - Automatically finds last pre-suspension/pre-rejection publication intent:
 *   If provider had it in "draft", "hidden", or "archived", publicationStatus remains unchanged or set to "draft".
 *   Only republishes if the reason for hiding was solely admin suspension/rejection and provider had published it.
 */
const restoreService = async (serviceId, { restorationReason }, adminId = "admin_service") => {
  const service = await Service.findById(serviceId).populate("providerId");
  if (!service) {
    const error = new Error("Service not found.");
    error.statusCode = 404;
    throw error;
  }

  // 1. Check if eligible for restoration
  if (!["suspended", "rejected"].includes(service.moderationStatus)) {
    const error = new Error(
      `Service is not eligible for restoration. Current moderation status is '${service.moderationStatus}'. Only 'suspended' or 'rejected' services can be restored.`
    );
    error.statusCode = 400;
    throw error;
  }

  // 2. Validate provider eligibility
  const provider = service.providerId;
  if (!provider || !provider.isApproved) {
    const error = new Error(
      "Cannot restore service: Provider is not currently approved or their verification has been revoked."
    );
    error.statusCode = 400;
    throw error;
  }

  // 3. Inspect audit logs to see if provider had intentionally hidden or archived the service before admin action
  const logs = await ServiceAuditLog.find({
    targetType: "service",
    targetId: service._id
  }).sort({ timestamp: -1 });

  // Check if provider explicitly hid or archived it
  const providerIntentLog = logs.find(
    (l) => l.actorType === "provider" && ["service_hidden", "service_archived"].includes(l.action)
  );

  const prevModeration = service.moderationStatus;
  const prevPublication = service.publicationStatus;

  // Restore moderation to approved
  service.moderationStatus = "approved";
  service.rejectionReason = null;
  service.suspensionReason = null;
  service.reviewedBy = adminId;
  service.reviewedAt = new Date();

  // If provider had intentionally hidden/archived the service, keep it hidden/draft
  if (providerIntentLog || service.publicationStatus === "archived") {
    // Keep it hidden or draft; do not auto-publish
    if (service.publicationStatus === "archived") {
      service.publicationStatus = "archived";
    } else {
      service.publicationStatus = "hidden";
    }
  } else {
    // Was only hidden by admin moderation, so restore to published
    service.publicationStatus = "published";
  }

  await service.save();

  await ServiceAuditLog.create({
    targetType: "service",
    targetId: service._id,
    action: "service_restored",
    actorType: "admin",
    actorId: adminId,
    previousStatus: prevModeration,
    newStatus: "approved",
    reason: restorationReason ? restorationReason.trim() : "Service restored by administrator.",
    changes: {
      publicationStatus: { from: prevPublication, to: service.publicationStatus },
      moderationStatus: { from: prevModeration, to: "approved" }
    }
  });

  return service;
};

/**
 * Admin: Get Service Audit and Moderation History
 */
const getServiceHistory = async (serviceId) => {
  const service = await Service.findById(serviceId);
  if (!service) {
    const error = new Error("Service not found.");
    error.statusCode = 404;
    throw error;
  }

  const logs = await ServiceAuditLog.find({
    targetType: "service",
    targetId: service._id
  }).sort({ timestamp: -1 });

  return {
    service,
    logs
  };
};

const { ExceptionalCancellationRequest } = require("../models/ExceptionalCancellationRequest");
const { ServiceRequest } = require("../models/ServiceRequest");

/**
 * Admin: List Exceptional Cancellation Requests
 */
const getExceptionalCancellationRequests = async ({ page = 1, limit = 20, status } = {}) => {
  const query = {};
  if (status) {
    query.status = status;
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const requests = await ExceptionalCancellationRequest.find(query)
    .populate({
      path: "serviceRequestId",
      populate: [
        { path: "patientId", select: "fullName gender location" },
        { path: "providerId", select: "fullName photoUrl yearsOfExperience" },
        { path: "serviceId", select: "title price durationMinutes" }
      ]
    })
    .populate("requesterId", "email role")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  const total = await ExceptionalCancellationRequest.countDocuments(query);

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
 * Admin: Get Single Exceptional Cancellation Request
 */
const getExceptionalCancellationRequestDetails = async (requestId) => {
  const request = await ExceptionalCancellationRequest.findById(requestId)
    .populate({
      path: "serviceRequestId",
      populate: [
        { path: "patientId", select: "fullName gender location healthInfo" },
        { path: "providerId", select: "fullName photoUrl yearsOfExperience ratingAvg" },
        { path: "serviceId" }
      ]
    })
    .populate("requesterId", "email role");

  if (!request) {
    const error = new Error("Exceptional cancellation request not found.");
    error.statusCode = 404;
    throw error;
  }

  return request;
};

/**
 * Admin: Decide on Exceptional Cancellation Request (Approve or Reject)
 * Handled with race condition safety:
 * - Request must currently be pending_review.
 * - If approved:
 *   - ServiceRequest must NOT have already reached terminal status ('cancelled', 'completed', 'rejected').
 *   - If ServiceRequest is 'completed', reject approval: cannot silently mark completed session as cancelled.
 *   - Cancels the booking with cancelledBy = "admin" and notes the admin reason.
 *   - Updates ExceptionalCancellationRequest status to 'approved'.
 *   - Emits immutable audit logs for both request and booking.
 * - If rejected:
 *   - Booking remains unchanged.
 *   - ExceptionalCancellationRequest status updated to 'rejected' with admin rejection reason.
 *   - Emits audit log.
 */
const decideExceptionalCancellation = async (
  requestId,
  { decision, decisionReason },
  adminId = "admin_service"
) => {
  if (!decision || !["approve", "reject"].includes(decision)) {
    const error = new Error("Invalid decision. Must be 'approve' or 'reject'.");
    error.statusCode = 400;
    throw error;
  }

  if (!decisionReason || !decisionReason.trim()) {
    const error = new Error("Decision reason is required.");
    error.statusCode = 400;
    throw error;
  }

  const exceptionalReq = await ExceptionalCancellationRequest.findById(requestId);
  if (!exceptionalReq) {
    const error = new Error("Exceptional cancellation request not found.");
    error.statusCode = 404;
    throw error;
  }

  if (exceptionalReq.status !== "pending_review") {
    const error = new Error(
      `Cannot decide on request: It has already been decided with status '${exceptionalReq.status}'.`
    );
    error.statusCode = 409;
    throw error;
  }

  const booking = await ServiceRequest.findById(exceptionalReq.serviceRequestId);
  if (!booking) {
    const error = new Error("Associated service booking was not found.");
    error.statusCode = 404;
    throw error;
  }

  const prevStatus = exceptionalReq.status;
  const now = new Date();

  if (decision === "approve") {
    // Race condition & compatibility validation:
    if (booking.status === "completed") {
      const error = new Error(
        "Cannot approve cancellation: The service session has already been completed. Completed sessions cannot be cancelled."
      );
      error.statusCode = 409;
      throw error;
    }

    if (["cancelled", "rejected"].includes(booking.status)) {
      const error = new Error(
        `Cannot approve cancellation: The booking is already in terminal state '${booking.status}'.`
      );
      error.statusCode = 409;
      throw error;
    }

    // Cancel the booking
    const prevBookingStatus = booking.status;
    booking.status = "cancelled";
    booking.cancelledBy = "admin";
    booking.cancellationReason = `Admin approved exceptional cancellation (${exceptionalReq.requesterRole}): ${decisionReason.trim()}`;
    booking.cancelledAt = now;
    await booking.save();

    // Update exceptional request
    exceptionalReq.status = "approved";
    exceptionalReq.decidedByAdminId = adminId;
    exceptionalReq.adminDecisionReason = decisionReason.trim();
    exceptionalReq.decidedAt = now;
    await exceptionalReq.save();

    // Audit logs
    await ServiceAuditLog.create({
      targetType: "service_request",
      targetId: booking._id,
      action: "request_cancelled",
      actorType: "admin",
      actorId: adminId,
      previousStatus: prevBookingStatus,
      newStatus: "cancelled",
      reason: booking.cancellationReason
    });

    await ServiceAuditLog.create({
      targetType: "service_request",
      targetId: booking._id,
      action: "exceptional_cancellation_approved",
      actorType: "admin",
      actorId: adminId,
      previousStatus: prevStatus,
      newStatus: "approved",
      reason: decisionReason.trim()
    });
  } else {
    // Reject decision: booking remains untouched
    exceptionalReq.status = "rejected";
    exceptionalReq.decidedByAdminId = adminId;
    exceptionalReq.adminDecisionReason = decisionReason.trim();
    exceptionalReq.decidedAt = now;
    await exceptionalReq.save();

    await ServiceAuditLog.create({
      targetType: "service_request",
      targetId: booking._id,
      action: "exceptional_cancellation_rejected",
      actorType: "admin",
      actorId: adminId,
      previousStatus: prevStatus,
      newStatus: "rejected",
      reason: decisionReason.trim()
    });
  }

  return {
    exceptionalRequest: exceptionalReq,
    booking
  };
};

module.exports = {
  getPendingApplications,
  getApplicationDetails,
  getProviderDocumentMetadata,
  getDocumentFileForAdmin,
  reviewDocument,
  updateVerificationStage,
  decideProviderApplication,
  getProviderAuditHistory,
  getServicesForAdmin,
  getServiceDetailsForAdmin,
  reviewService,
  suspendService,
  restoreService,
  getServiceHistory,
  getExceptionalCancellationRequests,
  getExceptionalCancellationRequestDetails,
  decideExceptionalCancellation
};
