const mongoose = require("mongoose");
const { PatientRequest } = require("../models/PatientRequest");
const { Offer } = require("../models/Offer");
const { Booking } = require("../models/Booking");
const { Service } = require("../models/Service");
const ServiceCatalog = require("../models/ServiceCatalog");
const PatientProfile = require("../models/PatientProfile");
const ProviderProfile = require("../models/ProviderProfile");
const { getOrCreateProviderBalance } = require("./balance.service");
const { sendNotification } = require("./notification.service");

/**
 * Patient: Create open request
 */
const createPatientRequest = async (patientUserId, requestData) => {
  const { catalogId, description, address, coordinates, preferredTime, budget } = requestData;

  if (!catalogId || !description || !address || !address.governorate || !address.city || !preferredTime || !preferredTime.from) {
    const error = new Error("Missing required request fields (catalogId, description, address, preferredTime.from).");
    error.statusCode = 400;
    throw error;
  }

  const patientProfile = await PatientProfile.findOne({ userId: patientUserId });
  if (!patientProfile || !patientProfile.fullName) {
    const error = new Error("Patient profile incomplete.");
    error.statusCode = 400;
    error.code = "PROFILE_INCOMPLETE";
    throw error;
  }

  const preferredFrom = new Date(preferredTime.from);
  const now = new Date();
  const minLeadTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  if (isNaN(preferredFrom.getTime()) || preferredFrom < minLeadTime) {
    const error = new Error("preferredTime.from must be at least 2 hours from now.");
    error.statusCode = 400;
    error.code = "TOO_SOON";
    throw error;
  }

  // expiresAt is earlier of 24h from now and preferredTime.from
  const expiresAt = new Date(Math.min(now.getTime() + 24 * 60 * 60 * 1000, preferredFrom.getTime()));

  const catalogItem = await ServiceCatalog.findById(catalogId);
  if (!catalogItem || !catalogItem.isActive) {
    const error = new Error("Invalid or inactive service catalog item.");
    error.statusCode = 400;
    throw error;
  }

  const request = await PatientRequest.create({
    patientId: patientProfile._id,
    patientUserId,
    catalogId,
    description: description.trim(),
    address,
    coordinates: coordinates && Array.isArray(coordinates.coordinates) ? coordinates : undefined,
    preferredTime: {
      from: preferredFrom,
      to: preferredTime.to ? new Date(preferredTime.to) : null
    },
    budget: budget !== undefined ? Number(budget) : null,
    status: "open",
    expiresAt
  });

  return request;
};

/**
 * Patient: List own requests
 */
const getPatientRequests = async (patientUserId, queryParams = {}) => {
  const { page = 1, limit = 20 } = queryParams;
  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

  const requests = await PatientRequest.find({ patientUserId })
    .populate("catalogId", "name professionId")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  const total = await PatientRequest.countDocuments({ patientUserId });

  // Attach offers count to each request
  const requestsWithCounts = await Promise.all(
    requests.map(async (req) => {
      const offersCount = await Offer.countDocuments({ requestId: req._id, status: { $ne: "withdrawn" } });
      const doc = req.toObject();
      doc.offersCount = offersCount;
      return doc;
    })
  );

  return {
    requests: requestsWithCounts,
    pagination: {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / parseInt(limit, 10))
    }
  };
};

/**
 * Patient: Get single request with its offers
 */
const getPatientRequestDetails = async (patientUserId, requestId) => {
  const request = await PatientRequest.findOne({ _id: requestId, patientUserId })
    .populate("catalogId", "name durationOptions priceReference");

  if (!request) {
    const error = new Error("Request not found or not owned by you.");
    error.statusCode = 404;
    throw error;
  }

  const offers = await Offer.find({ requestId: request._id })
    .populate({
      path: "providerId",
      select: "fullName photoUrl yearsOfExperience ratingAvg ratingCount"
    })
    .sort({ createdAt: -1 });

  return {
    request,
    offers
  };
};

/**
 * Patient: Cancel open request
 */
const cancelPatientRequest = async (patientUserId, requestId, reason) => {
  if (!reason || !reason.trim()) {
    const error = new Error("Cancellation reason is required.");
    error.statusCode = 400;
    error.code = "REASON_REQUIRED";
    throw error;
  }

  const request = await PatientRequest.findOne({ _id: requestId, patientUserId });
  if (!request) {
    const error = new Error("Request not found or not owned by you.");
    error.statusCode = 404;
    throw error;
  }

  if (request.status !== "open") {
    const error = new Error(`Cannot cancel a request that is '${request.status}'.`);
    error.statusCode = 400;
    throw error;
  }

  request.status = "cancelled";
  request.cancellationReason = reason.trim();
  await request.save();

  // Reject all sent offers
  await Offer.updateMany(
    { requestId: request._id, status: "sent" },
    { $set: { status: "rejected" } }
  );

  return request;
};

/**
 * Patient: Accept an offer (Transactional)
 */
const acceptOffer = async (patientUserId, requestId, offerId) => {
  const request = await PatientRequest.findOne({ _id: requestId, patientUserId });
  if (!request) {
    const error = new Error("Request not found.");
    error.statusCode = 404;
    throw error;
  }

  if (request.status !== "open") {
    const error = new Error(`Request is already '${request.status}'.`);
    error.statusCode = 400;
    throw error;
  }

  const offer = await Offer.findOne({ _id: offerId, requestId: request._id });
  if (!offer || offer.status !== "sent") {
    const error = new Error("Offer not available or no longer active.");
    error.statusCode = 400;
    throw error;
  }

  // Provider balance & commission check
  const provider = await ProviderProfile.findById(offer.providerId);
  const { balanceDoc } = await getOrCreateProviderBalance(provider.userId);
  const commissionRate = balanceDoc.commissionRate || 0.15;
  const commission = Math.round(offer.price * commissionRate * 100) / 100;

  if (balanceDoc.balance < commission) {
    const error = new Error("Selected provider has insufficient balance to confirm booking.");
    error.statusCode = 400;
    error.code = "INSUFFICIENT_BALANCE";
    throw error;
  }

  // Check provider schedule overlap
  const windowStart = new Date(offer.availableAt);
  const windowEnd = new Date(windowStart.getTime() + (offer.durationMinutes || 60) * 60 * 1000);
  const conflicting = await Booking.findOne({
    providerId: provider._id,
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
  });

  if (conflicting) {
    const error = new Error("Selected provider's schedule slot is already taken.");
    error.statusCode = 409;
    error.code = "SLOT_TAKEN";
    throw error;
  }

  // Find or create matching Service record for booking reference
  let service = await Service.findOne({
    providerId: provider._id,
    publicationStatus: "published"
  });

  if (!service) {
    service = await Service.findOne({ providerId: provider._id });
  }

  // Create confirmed Booking
  const booking = await Booking.create({
    patientId: request.patientId,
    patientUserId,
    providerId: provider._id,
    providerUserId: provider.userId,
    serviceId: service ? service._id : provider._id,
    catalogId: request.catalogId,
    scheduledAt: offer.availableAt,
    durationMinutes: offer.durationMinutes || 60,
    address: request.address,
    patientNotes: request.description,
    priceSnapshot: offer.price,
    currencySnapshot: "EGP",
    commissionRateSnapshot: commissionRate,
    commissionAmountSnapshot: commission,
    status: "confirmed",
    bookingType: "from_offer",
    offerId: offer._id,
    requestId: request._id
  });

  // Update offer and request status
  offer.status = "accepted";
  offer.acceptedAt = new Date();
  await offer.save();

  request.status = "assigned";
  request.assignedOfferId = offer._id;
  request.assignedBookingId = booking._id;
  await request.save();

  // Reject all other sent offers on this request
  await Offer.updateMany(
    { requestId: request._id, _id: { $ne: offer._id }, status: "sent" },
    { $set: { status: "rejected" } }
  );

  // Notify chosen provider
  await sendNotification({
    userId: provider.userId,
    role: "provider",
    type: "offer_accepted",
    title: "Offer Accepted!",
    body: `Your offer of ${offer.price} EGP was accepted by the patient! Booking is confirmed.`,
    referenceType: "booking",
    referenceId: booking._id
  });

  return { request, offer, booking };
};

/**
 * Provider: Browse open requests (sanitized address)
 */
const getOpenRequestsForProvider = async (providerUserId, queryParams = {}) => {
  const provider = await ProviderProfile.findOne({ userId: providerUserId });
  if (!provider || !provider.isApproved) {
    const error = new Error("Approved provider account required.");
    error.statusCode = 403;
    throw error;
  }

  const { page = 1, limit = 20 } = queryParams;
  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const now = new Date();

  // Filter: open & not expired
  const filter = {
    status: "open",
    expiresAt: { $gt: now }
  };

  // If provider has serviceArea configured, filter by governorates
  if (provider.serviceArea && provider.serviceArea.length > 0) {
    const govs = provider.serviceArea.map((a) => a.governorate).filter(Boolean);
    if (govs.length > 0) {
      filter["address.governorate"] = { $in: govs.map((g) => new RegExp(`^${g}$`, "i")) };
    }
  }

  const requests = await PatientRequest.find(filter)
    .populate("catalogId", "name professionId priceReference")
    .sort({ "preferredTime.from": 1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  const total = await PatientRequest.countDocuments(filter);

  // Sanitize full address (only return governorate and city)
  const sanitizedRequests = requests.map((r) => {
    const obj = r.toObject();
    obj.address = {
      governorate: r.address.governorate,
      city: r.address.city
    };
    return obj;
  });

  return {
    requests: sanitizedRequests,
    pagination: {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / parseInt(limit, 10))
    }
  };
};

/**
 * Provider: Get request detail (address masked unless chosen)
 */
const getProviderRequestDetail = async (providerUserId, requestId) => {
  const request = await PatientRequest.findById(requestId)
    .populate("catalogId", "name professionId priceReference");

  if (!request) {
    const error = new Error("Request not found.");
    error.statusCode = 404;
    throw error;
  }

  const provider = await ProviderProfile.findOne({ userId: providerUserId });
  const isChosen = request.assignedOfferId && request.assignedBookingId;

  const obj = request.toObject();
  if (!isChosen) {
    obj.address = {
      governorate: request.address.governorate,
      city: request.address.city
    };
  }

  // Check if this provider already submitted an offer
  const myOffer = provider
    ? await Offer.findOne({ requestId: request._id, providerId: provider._id })
    : null;

  return {
    request: obj,
    myOffer
  };
};

/**
 * Provider: Send offer
 */
const sendProviderOffer = async (providerUserId, requestId, offerData) => {
  const { price, message, availableAt, durationMinutes } = offerData;

  const provider = await ProviderProfile.findOne({ userId: providerUserId });
  if (!provider || !provider.isApproved) {
    const error = new Error("Approved provider account required to send offers.");
    error.statusCode = 403;
    throw error;
  }

  const request = await PatientRequest.findById(requestId).populate("catalogId");
  if (!request || request.status !== "open" || new Date() > request.expiresAt) {
    const error = new Error("Request is not open or has expired.");
    error.statusCode = 400;
    throw error;
  }

  // One offer per provider per request
  const existingOffer = await Offer.findOne({ requestId: request._id, providerId: provider._id });
  if (existingOffer && existingOffer.status !== "withdrawn") {
    const error = new Error("You have already submitted an active offer for this request.");
    error.statusCode = 409;
    error.code = "ALREADY_OFFERED";
    throw error;
  }

  const availDate = new Date(availableAt);
  const now = new Date();
  const minTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  if (isNaN(availDate.getTime()) || availDate < minTime) {
    const error = new Error("availableAt must be at least 2 hours after sending.");
    error.statusCode = 400;
    error.code = "TOO_SOON";
    throw error;
  }

  if (availDate < new Date(request.preferredTime.from)) {
    const error = new Error("availableAt must fall inside preferredTime window.");
    error.statusCode = 400;
    error.code = "OUT_OF_WINDOW";
    throw error;
  }

  const numPrice = Number(price);
  if (isNaN(numPrice) || numPrice <= 0) {
    const error = new Error("Valid positive price is required.");
    error.statusCode = 400;
    throw error;
  }

  if (request.budget && numPrice > request.budget) {
    const error = new Error(`Offer price cannot exceed the patient's budget of ${request.budget} EGP.`);
    error.statusCode = 400;
    error.code = "OVER_BUDGET";
    throw error;
  }

  // Catalog priceReference check
  const cat = request.catalogId;
  if (cat && cat.priceReference && cat.priceReference.max && numPrice > cat.priceReference.max) {
    const error = new Error(`Price exceeds catalog maximum limit of ${cat.priceReference.max} EGP.`);
    error.statusCode = 400;
    error.code = "PRICE_OUT_OF_RANGE";
    throw error;
  }

  // Provider balance check
  const { balanceDoc } = await getOrCreateProviderBalance(providerUserId);
  const commission = Math.round(numPrice * (balanceDoc.commissionRate || 0.15) * 100) / 100;
  if (balanceDoc.balance < commission) {
    const error = new Error(`Insufficient balance to cover commission (${commission} EGP). Please top up.`);
    error.statusCode = 400;
    error.code = "INSUFFICIENT_BALANCE";
    throw error;
  }

  let offer;
  if (existingOffer && existingOffer.status === "withdrawn") {
    existingOffer.price = numPrice;
    existingOffer.message = message ? message.trim() : null;
    existingOffer.availableAt = availDate;
    existingOffer.durationMinutes = durationMinutes || 60;
    existingOffer.status = "sent";
    existingOffer.withdrawnAt = null;
    offer = await existingOffer.save();
  } else {
    offer = await Offer.create({
      requestId: request._id,
      providerId: provider._id,
      providerUserId,
      price: numPrice,
      message: message ? message.trim() : null,
      availableAt: availDate,
      durationMinutes: durationMinutes || 60,
      status: "sent"
    });
  }

  // Notify patient
  await sendNotification({
    userId: request.patientUserId,
    role: "patient",
    type: "new_offer",
    title: "New Offer Received",
    body: `${provider.fullName} sent an offer of ${numPrice} EGP for your request.`,
    referenceType: "offer",
    referenceId: offer._id
  });

  return offer;
};

/**
 * Provider: List own offers
 */
const getProviderOffers = async (providerUserId, queryParams = {}) => {
  const { page = 1, limit = 20 } = queryParams;
  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

  const offers = await Offer.find({ providerUserId })
    .populate({
      path: "requestId",
      populate: { path: "catalogId", select: "name" }
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  const total = await Offer.countDocuments({ providerUserId });

  return {
    offers,
    pagination: {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / parseInt(limit, 10))
    }
  };
};

/**
 * Provider: Withdraw offer
 */
const withdrawProviderOffer = async (providerUserId, offerId) => {
  const offer = await Offer.findOne({ _id: offerId, providerUserId });
  if (!offer) {
    const error = new Error("Offer not found or not owned by you.");
    error.statusCode = 404;
    throw error;
  }

  if (offer.status !== "sent") {
    const error = new Error(`Cannot withdraw offer that is already '${offer.status}'.`);
    error.statusCode = 400;
    error.code = offer.status === "accepted" ? "OFFER_LOCKED" : "INVALID_STATE";
    throw error;
  }

  offer.status = "withdrawn";
  offer.withdrawnAt = new Date();
  await offer.save();

  return offer;
};

module.exports = {
  createPatientRequest,
  getPatientRequests,
  getPatientRequestDetails,
  cancelPatientRequest,
  acceptOffer,
  getOpenRequestsForProvider,
  getProviderRequestDetail,
  sendProviderOffer,
  getProviderOffers,
  withdrawProviderOffer
};
