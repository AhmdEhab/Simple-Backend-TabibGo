const mongoose = require("mongoose");
const User = require("../models/User");
const ProviderProfile = require("../models/ProviderProfile");
const PatientProfile = require("../models/PatientProfile");
const Profession = require("../models/Profession");
const ProviderApplication = require("../models/ProviderApplication");
const { ProviderVerification } = require("../models/ProviderVerification");
const { UserDocument } = require("../models/UserDocument");
const { PATIENT_DOCUMENTS_CONFIG } = require("../config/documentRequirements");
const { Service } = require("../models/Service");
const ServiceCategory = require("../models/ServiceCategory");
const { ServiceAuditLog } = require("../models/ServiceAuditLog");

/**
 * Validate Provider Eligibility to Publish / Manage Services
 */
const validateProviderPublishingEligibility = async (userId) => {
  const user = await User.findById(userId);
  if (!user || !user.isActive || !user.emailVerified) {
    const error = new Error("User account is inactive or email is not verified.");
    error.statusCode = 403;
    throw error;
  }

  if (user.role !== "provider") {
    const error = new Error("Only healthcare providers can manage services.");
    error.statusCode = 403;
    throw error;
  }

  const profile = await ProviderProfile.findOne({ userId });
  if (!profile || !profile.fullName || !profile.professionId) {
    const error = new Error("Provider profile is incomplete.");
    error.statusCode = 400;
    throw error;
  }

  if (!profile.isApproved) {
    const error = new Error("Provider account is not approved by TabibiGo administration.");
    error.statusCode = 403;
    throw error;
  }

  // Check ProviderApplication status
  const application = await ProviderApplication.findOne({
    providerId: profile._id,
    status: "approved"
  });

  if (!application) {
    const error = new Error("No approved provider application found.");
    error.statusCode = 403;
    throw error;
  }

  // Check ProviderVerification stages
  const verification = await ProviderVerification.findOne({ providerId: profile._id });
  if (!verification || verification.overallStatus !== "verified") {
    const error = new Error("Provider verification stages are incomplete or not verified.");
    error.statusCode = 403;
    throw error;
  }

  const STAGES = [
    "identityVerification",
    "licenseVerification",
    "experienceVerification",
    "skillsAssessment"
  ];
  for (const s of STAGES) {
    if (!verification[s] || verification[s].status !== "verified") {
      const error = new Error(`Provider verification stage '${s}' is not verified.`);
      error.statusCode = 403;
      throw error;
    }
  }

  return { user, profile, application, verification };
};

/**
 * Validate Patient Eligibility to Create Service Requests
 */
const validatePatientBookingEligibility = async (userId) => {
  const user = await User.findById(userId);
  if (!user || !user.isActive || !user.emailVerified) {
    const error = new Error("Patient account is inactive or email is not verified.");
    error.statusCode = 403;
    throw error;
  }

  if (user.role !== "patient") {
    const error = new Error("Only patients can book services.");
    error.statusCode = 403;
    throw error;
  }

  const profile = await PatientProfile.findOne({ userId });
  if (!profile || !profile.fullName) {
    const error = new Error("Patient profile is incomplete.");
    error.statusCode = 400;
    throw error;
  }

  // Check required patient identity documents under platform policy
  const requiredPatientRules = PATIENT_DOCUMENTS_CONFIG.filter((r) => r.required);
  const activeDocs = await UserDocument.find({
    userId,
    isActiveVersion: true
  });

  const docMap = new Map();
  activeDocs.forEach((d) => docMap.set(d.documentType, d));

  const unapprovedDocs = [];
  for (const rule of requiredPatientRules) {
    const doc = docMap.get(rule.type);
    if (!doc || doc.status !== "approved") {
      unapprovedDocs.push({
        type: rule.type,
        label: rule.label,
        status: doc ? doc.status : "missing"
      });
    }
  }

  if (unapprovedDocs.length > 0) {
    const error = new Error(
      `Patient verification requirements incomplete: ${unapprovedDocs
        .map((d) => `${d.label} (${d.status})`)
        .join(", ")}`
    );
    error.statusCode = 403;
    throw error;
  }

  return { user, profile };
};

/**
 * Automatically hide or suspend all active services for a provider whose verification is revoked
 */
const syncProviderServiceStatusOnRevocation = async (providerId, reason, actorId = "system") => {
  const activeServices = await Service.find({
    providerId,
    publicationStatus: "published"
  });

  for (const service of activeServices) {
    const prevStatus = service.publicationStatus;
    service.publicationStatus = "hidden";
    await service.save();

    await ServiceAuditLog.create({
      targetType: "service",
      targetId: service._id,
      action: "service_hidden",
      actorType: "system",
      actorId,
      previousStatus: prevStatus,
      newStatus: "hidden",
      reason: `Automatic service deactivation due to provider verification change: ${reason}`,
      changes: { providerId }
    });
  }
};

/**
 * Create or seed service categories
 */
const getCategories = async (professionId) => {
  const query = { isActive: true };
  if (professionId) {
    query.professionId = professionId;
  }
  return ServiceCategory.find(query).populate("professionId", "name").sort({ name: 1 });
};

/**
 * Provider: Create and instantly publish service
 */
const createService = async (userId, serviceData) => {
  const { profile } = await validateProviderPublishingEligibility(userId);

  const {
    professionId,
    categoryId,
    title,
    description,
    price,
    currency = "EGP",
    durationMinutes,
    serviceAreas,
    serviceImage,
    publishImmediately = true
  } = serviceData;

  // Enforce profession compatibility
  if (professionId && professionId.toString() !== profile.professionId.toString()) {
    const error = new Error(
      "Profession mismatch: You can only publish services matching your verified profession."
    );
    error.statusCode = 400;
    throw error;
  }

  // Validate category if provided
  if (categoryId) {
    const category = await ServiceCategory.findOne({
      _id: categoryId,
      professionId: profile.professionId,
      isActive: true
    });
    if (!category) {
      const error = new Error("Invalid or inactive category selected for your profession.");
      error.statusCode = 400;
      throw error;
    }
  }

  const publicationStatus = publishImmediately ? "published" : "draft";
  const moderationStatus = "pending_review";

  const service = await Service.create({
    providerId: profile._id,
    professionId: profile.professionId,
    categoryId: categoryId || null,
    title,
    description,
    price,
    currency,
    durationMinutes,
    serviceAreas: Array.isArray(serviceAreas) ? serviceAreas : [],
    serviceImage: serviceImage || null,
    publicationStatus,
    moderationStatus,
    publishedAt: publishImmediately ? new Date() : null,
    version: 1
  });

  await ServiceAuditLog.create({
    targetType: "service",
    targetId: service._id,
    action: publishImmediately ? "service_published" : "service_created",
    actorType: "provider",
    actorId: userId.toString(),
    previousStatus: null,
    newStatus: publicationStatus,
    reason: publishImmediately
      ? "Provider published service with instant availability (pending admin moderation)"
      : "Provider saved draft service",
    changes: {
      title,
      price,
      durationMinutes,
      professionId: profile.professionId
    }
  });

  return service;
};

/**
 * Provider: Update Service
 * Checks material vs minor changes.
 * Material changes (title, description, duration, serviceAreas, category) reset moderationStatus to pending_review.
 * Price alone does NOT reset moderation if description/scope did not change.
 */
const updateService = async (userId, serviceId, updateData) => {
  const { profile } = await validateProviderPublishingEligibility(userId);

  const service = await Service.findOne({
    _id: serviceId,
    providerId: profile._id
  });

  if (!service) {
    const error = new Error("Service not found or you are not authorized to edit it.");
    error.statusCode = 404;
    throw error;
  }

  // Check if service was suspended or archived
  if (service.moderationStatus === "suspended") {
    const error = new Error(
      "This service has been suspended by administration and cannot be edited. Contact support."
    );
    error.statusCode = 403;
    throw error;
  }

  const {
    title,
    description,
    price,
    currency,
    durationMinutes,
    serviceAreas,
    serviceImage,
    categoryId,
    publicationStatus
  } = updateData;

  const previousState = {
    title: service.title,
    description: service.description,
    price: service.price,
    durationMinutes: service.durationMinutes,
    publicationStatus: service.publicationStatus,
    moderationStatus: service.moderationStatus
  };

  let isMaterialChange = false;
  const changes = {};

  if (title !== undefined && title.trim() !== service.title) {
    service.title = title.trim();
    isMaterialChange = true;
    changes.title = { from: previousState.title, to: service.title };
  }

  if (description !== undefined && description.trim() !== service.description) {
    service.description = description.trim();
    isMaterialChange = true;
    changes.description = { from: previousState.description, to: service.description };
  }

  if (durationMinutes !== undefined && durationMinutes !== service.durationMinutes) {
    service.durationMinutes = durationMinutes;
    isMaterialChange = true;
    changes.durationMinutes = { from: previousState.durationMinutes, to: durationMinutes };
  }

  if (serviceAreas !== undefined) {
    service.serviceAreas = serviceAreas;
    isMaterialChange = true;
    changes.serviceAreas = serviceAreas;
  }

  if (categoryId !== undefined) {
    if (categoryId) {
      const cat = await ServiceCategory.findOne({
        _id: categoryId,
        professionId: profile.professionId,
        isActive: true
      });
      if (!cat) {
        const error = new Error("Invalid or inactive category selected.");
        error.statusCode = 400;
        throw error;
      }
    }
    service.categoryId = categoryId || null;
    isMaterialChange = true;
  }

  // Minor changes (e.g. price adjustment, image)
  if (price !== undefined && price !== service.price) {
    service.price = price;
    changes.price = { from: previousState.price, to: price };
  }

  if (currency !== undefined) {
    service.currency = currency;
  }

  if (serviceImage !== undefined) {
    service.serviceImage = serviceImage;
  }

  if (publicationStatus !== undefined) {
    const allowed = ["draft", "published", "hidden"];
    if (!allowed.includes(publicationStatus)) {
      const error = new Error(`Invalid publication status: ${publicationStatus}`);
      error.statusCode = 400;
      throw error;
    }
    const oldPub = service.publicationStatus;
    service.publicationStatus = publicationStatus;
    if (publicationStatus === "published" && !service.publishedAt) {
      service.publishedAt = new Date();
    }
    if (oldPub !== publicationStatus) {
      changes.publicationStatus = { from: oldPub, to: publicationStatus };
    }
  }

  if (isMaterialChange) {
    service.version = (service.version || 1) + 1;
    // Material clinical/scope changes reset moderation to pending_review
    service.moderationStatus = "pending_review";
  }

  await service.save();

  let auditAction = isMaterialChange ? "service_re_moderation_triggered" : "service_updated";
  if (changes.publicationStatus) {
    if (changes.publicationStatus.to === "hidden") auditAction = "service_hidden";
    else if (changes.publicationStatus.to === "published") auditAction = "service_published";
  }

  await ServiceAuditLog.create({
    targetType: "service",
    targetId: service._id,
    action: auditAction,
    actorType: "provider",
    actorId: userId.toString(),
    previousStatus: previousState.moderationStatus,
    newStatus: service.moderationStatus,
    reason: isMaterialChange
      ? "Material service changes submitted; re-moderation triggered"
      : (changes.publicationStatus ? `Provider set publication status to ${publicationStatus}` : "Service minor details updated"),
    changes
  });

  return service;
};

/**
 * Provider: Get Own Services
 */
const getProviderServices = async (userId, queryParams = {}) => {
  const profile = await ProviderProfile.findOne({ userId });
  if (!profile) {
    const error = new Error("Provider profile not found.");
    error.statusCode = 404;
    throw error;
  }

  const { page = 1, limit = 20, status } = queryParams;
  const filter = { providerId: profile._id };
  if (status) {
    filter.publicationStatus = status;
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const services = await Service.find(filter)
    .populate("professionId", "name")
    .populate("categoryId", "name")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  const total = await Service.countDocuments(filter);

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
 * Public / Patient Discovery: Search & Browse Published Services
 * Only shows services that are:
 * - publicationStatus: "published"
 * - moderationStatus: NOT in ["rejected", "suspended"]
 * - Provider must be currently approved and active
 */
const discoverServices = async (queryParams = {}) => {
  const {
    professionId,
    categoryId,
    governorate,
    city,
    search,
    minPrice,
    maxPrice,
    page = 1,
    limit = 20
  } = queryParams;

  const filter = {
    publicationStatus: "published",
    moderationStatus: { $nin: ["rejected", "suspended"] }
  };

  if (professionId) {
    filter.professionId = professionId;
  }

  if (categoryId) {
    filter.categoryId = categoryId;
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.price = {};
    if (minPrice !== undefined) filter.price.$gte = Number(minPrice);
    if (maxPrice !== undefined) filter.price.$lte = Number(maxPrice);
  }

  if (governorate || city) {
    filter.serviceAreas = {
      $elemMatch: {
        ...(governorate && { governorate: new RegExp(`^${governorate}$`, "i") }),
        ...(city && { city: new RegExp(`^${city}$`, "i") })
      }
    };
  }

  if (search) {
    filter.$or = [
      { title: new RegExp(search, "i") },
      { description: new RegExp(search, "i") }
    ];
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

  // Fetch candidate services
  const services = await Service.find(filter)
    .populate("professionId", "name description")
    .populate("categoryId", "name")
    .populate({
      path: "providerId",
      select: "fullName photoUrl bio yearsOfExperience ratingAvg ratingCount serviceArea isApproved userId",
      populate: { path: "userId", select: "isActive" }
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  // Double-check provider approval status in memory to guarantee no unapproved provider service leaks
  const verifiedServices = services.filter((s) => {
    const prov = s.providerId;
    return prov && prov.isApproved && prov.userId && prov.userId.isActive;
  });

  const total = await Service.countDocuments(filter);

  return {
    services: verifiedServices,
    pagination: {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / parseInt(limit, 10))
    }
  };
};

/**
 * Get Service Details by ID (Patient & Public View)
 */
const getServiceDetails = async (serviceId) => {
  const service = await Service.findById(serviceId)
    .populate("professionId", "name description")
    .populate("categoryId", "name")
    .populate({
      path: "providerId",
      select: "fullName photoUrl bio yearsOfExperience ratingAvg ratingCount serviceArea isApproved"
    });

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
    const error = new Error("Service is currently unavailable.");
    error.statusCode = 404;
    throw error;
  }

  if (!service.providerId || !service.providerId.isApproved) {
    const error = new Error("The provider for this service is not currently active.");
    error.statusCode = 404;
    throw error;
  }

  return service;
};

module.exports = {
  validateProviderPublishingEligibility,
  validatePatientBookingEligibility,
  syncProviderServiceStatusOnRevocation,
  getCategories,
  createService,
  updateService,
  getProviderServices,
  discoverServices,
  getServiceDetails
};
