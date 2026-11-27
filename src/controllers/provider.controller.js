const ProviderProfile = require("../models/ProviderProfile");
const ProviderApplication = require("../models/ProviderApplication");
const { UserDocument } = require("../models/UserDocument");
const ServiceCatalog = require("../models/ServiceCatalog");
const ServiceAccess = require("../models/ServiceAccess");
const { Service } = require("../models/Service");
const { Booking } = require("../models/Booking");
const { ServiceRequest } = require("../models/ServiceRequest");
const TopUpNotice = require("../models/TopUpNotice");
const Ledger = require("../models/Ledger");
const bookingService = require("../services/booking.service");
const requestService = require("../services/request.service");
const { getOrCreateProviderBalance } = require("../services/balance.service");

// ==========================================
// 1. ONBOARDING & PROFILE (Section 7)
// ==========================================

const getProviderProfile = async (req, res, next) => {
  try {
    let profile = await ProviderProfile.findOne({ userId: req.user.id }).populate("professionId", "name description");
    if (!profile) {
      profile = await ProviderProfile.create({
        userId: req.user.id,
        fullName: req.user.email.split("@")[0]
      });
    }

    res.status(200).json({
      success: true,
      data: profile
    });
  } catch (error) {
    next(error);
  }
};

const updateProviderProfile = async (req, res, next) => {
  try {
    let profile = await ProviderProfile.findOne({ userId: req.user.id });
    if (!profile) {
      profile = await ProviderProfile.create({
        userId: req.user.id,
        fullName: req.body.fullName || req.user.email.split("@")[0]
      });
    }

    const {
      fullName,
      photoUrl,
      bio,
      yearsOfExperience,
      education,
      certifications,
      serviceArea,
      availability,
      baseLocation,
      professionId
    } = req.body;

    // Rule: professionId is locked after the first service request or booking
    if (professionId && profile.professionId && professionId.toString() !== profile.professionId.toString()) {
      const hasBookings = await Booking.exists({ providerUserId: req.user.id });
      const hasOldRequests = await ServiceRequest.exists({ providerUserId: req.user.id });
      if (hasBookings || hasOldRequests) {
        return res.status(400).json({
          success: false,
          code: "PROFESSION_LOCKED",
          message: "professionId is permanently locked after the first service booking or request."
        });
      }
      profile.professionId = professionId;
    } else if (professionId && !profile.professionId) {
      profile.professionId = professionId;
    }

    if (fullName !== undefined) profile.fullName = fullName.trim();
    if (photoUrl !== undefined) profile.photoUrl = photoUrl;
    if (bio !== undefined) profile.bio = bio;
    if (yearsOfExperience !== undefined) profile.yearsOfExperience = Number(yearsOfExperience);
    if (education !== undefined) profile.education = education;
    if (certifications !== undefined) profile.certifications = certifications;
    if (serviceArea !== undefined) profile.serviceArea = serviceArea;
    if (availability !== undefined) profile.availability = availability;
    if (baseLocation && baseLocation.type === "Point" && Array.isArray(baseLocation.coordinates)) {
      profile.baseLocation = baseLocation;
    }

    await profile.save();

    res.status(200).json({
      success: true,
      message: "Provider profile updated successfully.",
      data: profile
    });
  } catch (error) {
    next(error);
  }
};

const getProviderApplication = async (req, res, next) => {
  try {
    const profile = await ProviderProfile.findOne({ userId: req.user.id });
    if (!profile) {
      const error = new Error("Provider profile not found.");
      error.statusCode = 404;
      throw error;
    }

    let application = await ProviderApplication.findOne({ providerId: profile._id });
    if (!application) {
      application = await ProviderApplication.create({
        providerId: profile._id,
        licenseNumber: "DRAFT_PENDING",
        licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        status: "draft"
      });
    }

    const documents = await UserDocument.find({ userId: req.user.id, isActiveVersion: true });

    // Missing items calculation
    const missingItems = [];
    if (!profile.fullName) missingItems.push("profile.fullName");
    if (!profile.professionId) missingItems.push("profile.professionId");
    if (!application.licenseNumber || application.licenseNumber === "DRAFT_PENDING") missingItems.push("licenseNumber");
    if (!application.licenseExpiry || new Date(application.licenseExpiry) <= new Date()) missingItems.push("licenseExpiry");

    const hasLicenseDoc = documents.some((d) => d.documentType.includes("license") && d.status !== "rejected");
    const hasNationalId = documents.some((d) => d.documentType.includes("national_id") && d.status !== "rejected");
    if (!hasLicenseDoc) missingItems.push("document:practice_license");
    if (!hasNationalId) missingItems.push("document:national_id");

    res.status(200).json({
      success: true,
      data: {
        application,
        missingItems,
        decisionReason: application.decisionReason,
        documents: documents.map((d) => ({
          id: d._id,
          documentType: d.documentType,
          status: d.status,
          rejectionReason: d.rejectionReason,
          fileUrl: d.fileUrl || `/api/documents/${d._id}/download`
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};

const saveProviderApplicationDraft = async (req, res, next) => {
  try {
    const { licenseNumber, licenseExpiry } = req.body;
    const profile = await ProviderProfile.findOne({ userId: req.user.id });
    if (!profile) {
      const error = new Error("Provider profile not found.");
      error.statusCode = 404;
      throw error;
    }

    let application = await ProviderApplication.findOne({ providerId: profile._id });
    if (!application) {
      application = new ProviderApplication({ providerId: profile._id });
    }

    if (!["draft", "rejected"].includes(application.status)) {
      const error = new Error(`Cannot modify application while status is '${application.status}'.`);
      error.statusCode = 400;
      throw error;
    }

    // First save of a rejected application resets it to draft
    if (application.status === "rejected") {
      application.status = "draft";
      application.decisionReason = null;
    }

    if (licenseNumber !== undefined) application.licenseNumber = licenseNumber.trim();
    if (licenseExpiry !== undefined) application.licenseExpiry = new Date(licenseExpiry);

    await application.save();

    res.status(200).json({
      success: true,
      message: "Application draft saved successfully.",
      data: application
    });
  } catch (error) {
    next(error);
  }
};

const submitProviderApplication = async (req, res, next) => {
  try {
    const profile = await ProviderProfile.findOne({ userId: req.user.id });
    if (!profile || !profile.fullName || !profile.professionId) {
      return res.status(400).json({
        success: false,
        code: "PROFILE_INCOMPLETE",
        message: "fullName and professionId on profile are required before submission."
      });
    }

    const application = await ProviderApplication.findOne({ providerId: profile._id });
    if (!application || application.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Application must exist and be in draft status to submit."
      });
    }

    if (!application.licenseNumber || application.licenseNumber === "DRAFT_PENDING") {
      return res.status(400).json({
        success: false,
        message: "Valid licenseNumber is required."
      });
    }

    if (!application.licenseExpiry || new Date(application.licenseExpiry) <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "licenseExpiry must be a future date."
      });
    }

    const docs = await UserDocument.find({ userId: req.user.id, isActiveVersion: true });
    const hasLicense = docs.some((d) => d.documentType.includes("license") && d.status !== "rejected");
    const hasId = docs.some((d) => d.documentType.includes("national_id") && d.status !== "rejected");

    if (!hasLicense || !hasId) {
      return res.status(400).json({
        success: false,
        code: "DOCUMENTS_MISSING",
        message: "Valid practice license and national ID documents are required."
      });
    }

    application.status = "submitted";
    application.submittedAt = new Date();
    await application.save();

    res.status(200).json({
      success: true,
      message: "Provider application submitted successfully for administrative review.",
      data: application
    });
  } catch (error) {
    next(error);
  }
};

const listProviderDocuments = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

    const documents = await UserDocument.find({ userId: req.user.id, isActiveVersion: true })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10));

    const total = await UserDocument.countDocuments({ userId: req.user.id, isActiveVersion: true });

    res.status(200).json({
      success: true,
      data: documents,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        pages: Math.ceil(total / parseInt(limit, 10))
      }
    });
  } catch (error) {
    next(error);
  }
};

const addProviderDocument = async (req, res, next) => {
  try {
    const profile = await ProviderProfile.findOne({ userId: req.user.id });
    const application = await ProviderApplication.findOne({ providerId: profile ? profile._id : null });

    if (application && application.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Documents can only be added while your application is in draft status."
      });
    }

    const { documentType, fileUrl, fileName } = req.body;
    if (!documentType || !fileUrl) {
      const error = new Error("documentType and fileUrl are required.");
      error.statusCode = 400;
      throw error;
    }

    // Set previous active documents of same type to inactive
    await UserDocument.updateMany(
      { userId: req.user.id, documentType, isActiveVersion: true },
      { $set: { isActiveVersion: false } }
    );

    const doc = await UserDocument.create({
      userId: req.user.id,
      documentType,
      originalFileName: fileName || documentType,
      storedFileName: fileUrl.split("/").pop() || "upload",
      mimeType: "application/octet-stream",
      fileSize: 0,
      fileUrl,
      storageKey: fileUrl,
      status: "pending_review",
      isActiveVersion: true
    });

    res.status(201).json({
      success: true,
      message: "Document added successfully.",
      data: doc
    });
  } catch (error) {
    next(error);
  }
};

const removeProviderDocument = async (req, res, next) => {
  try {
    const profile = await ProviderProfile.findOne({ userId: req.user.id });
    const application = await ProviderApplication.findOne({ providerId: profile ? profile._id : null });

    if (application && application.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Documents can only be removed while application is in draft status."
      });
    }

    const doc = await UserDocument.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!doc) {
      const error = new Error("Document not found.");
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      success: true,
      message: "Document removed successfully."
    });
  } catch (error) {
    next(error);
  }
};

const listProviderAssessments = async (req, res, next) => {
  try {
    const profile = await ProviderProfile.findOne({ userId: req.user.id });
    if (!profile) {
      const error = new Error("Provider profile not found.");
      error.statusCode = 404;
      throw error;
    }

    const accesses = await ServiceAccess.find({ providerId: profile._id })
      .populate("catalogId", "name professionId")
      .select("catalogId status decisionReason decidedAt");

    const assessments = accesses.map((acc) => ({
      serviceAccessId: acc._id,
      catalogItem: acc.catalogId,
      status: acc.status,
      decisionReason: acc.decisionReason,
      decidedAt: acc.decidedAt
    }));

    res.status(200).json({
      success: true,
      data: assessments
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 2. SERVICES MANAGEMENT (Section 8)
// ==========================================

const listAvailableCatalogServices = async (req, res, next) => {
  try {
    const profile = await ProviderProfile.findOne({ userId: req.user.id });
    if (!profile || !profile.professionId) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    const catalogItems = await ServiceCatalog.find({
      professionId: profile.professionId,
      isActive: true
    });

    const accesses = await ServiceAccess.find({ providerId: profile._id });
    const accessMap = new Map();
    accesses.forEach((a) => accessMap.set(a.catalogId.toString(), a));

    const result = catalogItems.map((item) => {
      const access = accessMap.get(item._id.toString());
      return {
        catalogId: item._id,
        name: item.name,
        description: item.description,
        durationOptions: item.durationOptions,
        priceReference: item.priceReference,
        accessStatus: access ? access.status : "not_requested",
        serviceAccessId: access ? access._id : null,
        decisionReason: access ? access.decisionReason : null,
        revokeReason: access ? access.revokeReason : null
      };
    });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

const requestServiceAccess = async (req, res, next) => {
  try {
    const { catalogIds } = req.body;
    if (!Array.isArray(catalogIds) || catalogIds.length === 0) {
      const error = new Error("catalogIds array is required.");
      error.statusCode = 400;
      throw error;
    }

    const profile = await ProviderProfile.findOne({ userId: req.user.id });
    if (!profile || !profile.isApproved) {
      const error = new Error("Approved provider account required.");
      error.statusCode = 403;
      throw error;
    }

    const now = new Date();
    const createdAccesses = [];

    for (const catId of catalogIds) {
      const catalogItem = await ServiceCatalog.findOne({
        _id: catId,
        professionId: profile.professionId,
        isActive: true
      });
      if (!catalogItem) continue;

      let access = await ServiceAccess.findOne({ providerId: profile._id, catalogId: catId });
      if (access) {
        if (["requested", "in_assessment", "approved"].includes(access.status)) {
          continue; // Duplicate request rejected
        }
        if (access.status === "rejected" && access.rejectionCooldownUntil && now < access.rejectionCooldownUntil) {
          continue; // Cooldown not yet expired
        }
        access.status = "requested";
        access.decisionReason = null;
        access.revokeReason = null;
        await access.save();
        createdAccesses.push(access);
      } else {
        access = await ServiceAccess.create({
          providerId: profile._id,
          providerUserId: req.user.id,
          catalogId: catId,
          status: "requested"
        });
        createdAccesses.push(access);
      }
    }

    res.status(201).json({
      success: true,
      message: `Requested access for ${createdAccesses.length} catalog items.`,
      data: createdAccesses
    });
  } catch (error) {
    next(error);
  }
};

const listProviderServices = async (req, res, next) => {
  try {
    const profile = await ProviderProfile.findOne({ userId: req.user.id });
    if (!profile) {
      return res.status(200).json({ success: true, data: [] });
    }

    const services = await Service.find({ providerId: profile._id })
      .populate("catalogId", "name durationOptions priceReference")
      .populate("professionId", "name")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: services
    });
  } catch (error) {
    next(error);
  }
};

const editProviderService = async (req, res, next) => {
  try {
    const profile = await ProviderProfile.findOne({ userId: req.user.id });
    const service = await Service.findOne({ _id: req.params.id, providerId: profile._id }).populate("catalogId");

    if (!service) {
      const error = new Error("Service not found or not owned by you.");
      error.statusCode = 404;
      throw error;
    }

    const { description, price, durationMinutes } = req.body;
    const cat = service.catalogId;

    if (durationMinutes !== undefined) {
      if (cat && cat.durationOptions && cat.durationOptions.length > 0 && !cat.durationOptions.includes(Number(durationMinutes))) {
        return res.status(400).json({
          success: false,
          message: `durationMinutes must be one of catalog options: ${cat.durationOptions.join(", ")}.`
        });
      }
      service.durationMinutes = Number(durationMinutes);
    }

    if (price !== undefined) {
      const numPrice = Number(price);
      if (cat && cat.priceReference && cat.priceReference.max && numPrice > cat.priceReference.max) {
        return res.status(400).json({
          success: false,
          message: `Price exceeds catalog maximum limit of ${cat.priceReference.max} EGP.`
        });
      }
      service.price = numPrice;
    }

    if (description !== undefined) {
      service.description = description.trim();
    }

    await service.save();

    res.status(200).json({
      success: true,
      message: "Service updated successfully.",
      data: service
    });
  } catch (error) {
    next(error);
  }
};

const publishProviderService = async (req, res, next) => {
  try {
    const profile = await ProviderProfile.findOne({ userId: req.user.id });
    const service = await Service.findOne({ _id: req.params.id, providerId: profile._id });

    if (!service) {
      const error = new Error("Service not found.");
      error.statusCode = 404;
      throw error;
    }

    if (!service.description || !service.price || !service.durationMinutes) {
      return res.status(400).json({
        success: false,
        message: "Description, duration, and price must be set before publishing."
      });
    }

    service.publicationStatus = "published";
    service.publishedAt = new Date();
    await service.save();

    res.status(200).json({
      success: true,
      message: "Service published successfully.",
      data: service
    });
  } catch (error) {
    next(error);
  }
};

const unpublishProviderService = async (req, res, next) => {
  try {
    const profile = await ProviderProfile.findOne({ userId: req.user.id });
    const service = await Service.findOne({ _id: req.params.id, providerId: profile._id });

    if (!service) {
      const error = new Error("Service not found.");
      error.statusCode = 404;
      throw error;
    }

    service.publicationStatus = "hidden";
    await service.save();

    res.status(200).json({
      success: true,
      message: "Service unpublished and hidden from browse.",
      data: service
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 3. BOOKINGS MANAGEMENT (Section 9)
// ==========================================

const listProviderBookings = async (req, res, next) => {
  try {
    const result = await bookingService.getProviderBookings(req.user.id, req.query);
    res.status(200).json({
      success: true,
      data: result.bookings,
      pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
};

const acceptProviderBooking = async (req, res, next) => {
  try {
    const booking = await bookingService.acceptBooking(req.user.id, req.params.id);
    res.status(200).json({
      success: true,
      message: "Booking accepted and confirmed.",
      data: booking
    });
  } catch (error) {
    next(error);
  }
};

const rejectProviderBooking = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const booking = await bookingService.rejectBooking(req.user.id, req.params.id, reason);
    res.status(200).json({
      success: true,
      message: "Booking rejected.",
      data: booking
    });
  } catch (error) {
    next(error);
  }
};

const startProviderBooking = async (req, res, next) => {
  try {
    const booking = await bookingService.startBooking(req.user.id, req.params.id);
    res.status(200).json({
      success: true,
      message: "Booking started.",
      data: booking
    });
  } catch (error) {
    next(error);
  }
};

const completeProviderBooking = async (req, res, next) => {
  try {
    const booking = await bookingService.completeBooking(req.user.id, req.params.id);
    res.status(200).json({
      success: true,
      message: "Booking completed and commission recorded.",
      data: booking
    });
  } catch (error) {
    next(error);
  }
};

const cancelProviderBooking = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const booking = await bookingService.cancelBooking(req.user.id, req.params.id, reason, "provider");
    res.status(200).json({
      success: true,
      message: "Booking cancelled.",
      data: booking
    });
  } catch (error) {
    next(error);
  }
};

const proposeProviderBookingTime = async (req, res, next) => {
  try {
    const { scheduledAt } = req.body;
    const proposal = await bookingService.proposeTime(req.user.id, req.params.id, scheduledAt);
    res.status(201).json({
      success: true,
      message: "New time proposed to patient.",
      data: proposal
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 4. REQUESTS & OFFERS (Section 10)
// ==========================================

const listOpenMarketplaceRequests = async (req, res, next) => {
  try {
    const result = await requestService.getOpenRequestsForProvider(req.user.id, req.query);
    res.status(200).json({
      success: true,
      data: result.requests,
      pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
};

const getMarketplaceRequestDetail = async (req, res, next) => {
  try {
    const result = await requestService.getProviderRequestDetail(req.user.id, req.params.id);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

const sendOffer = async (req, res, next) => {
  try {
    const offer = await requestService.sendProviderOffer(req.user.id, req.params.id, req.body);
    res.status(201).json({
      success: true,
      message: "Offer sent successfully to patient.",
      data: offer
    });
  } catch (error) {
    next(error);
  }
};

const listOwnOffers = async (req, res, next) => {
  try {
    const result = await requestService.getProviderOffers(req.user.id, req.query);
    res.status(200).json({
      success: true,
      data: result.offers,
      pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
};

const withdrawOffer = async (req, res, next) => {
  try {
    const offer = await requestService.withdrawProviderOffer(req.user.id, req.params.id);
    res.status(200).json({
      success: true,
      message: "Offer withdrawn successfully.",
      data: offer
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 5. BALANCE & COMMISSION (Section 12)
// ==========================================

const getProviderBalance = async (req, res, next) => {
  try {
    const { balanceDoc } = await getOrCreateProviderBalance(req.user.id);
    res.status(200).json({
      success: true,
      data: {
        balance: balanceDoc.balance,
        currency: balanceDoc.currency,
        commissionRate: balanceDoc.commissionRate,
        isPaused: balanceDoc.isPaused
      }
    });
  } catch (error) {
    next(error);
  }
};

const getProviderLedger = async (req, res, next) => {
  try {
    const profile = await ProviderProfile.findOne({ userId: req.user.id });
    if (!profile) {
      const error = new Error("Provider profile not found.");
      error.statusCode = 404;
      throw error;
    }

    const { page = 1, limit = 20, type } = req.query;
    const filter = { providerId: profile._id };
    if (type) filter.type = type;

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const entries = await Ledger.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10));

    const total = await Ledger.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: entries,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        pages: Math.ceil(total / parseInt(limit, 10))
      }
    });
  } catch (error) {
    next(error);
  }
};

const createTopUpNotice = async (req, res, next) => {
  try {
    const { transferReference, amount } = req.body;
    if (!transferReference || !amount) {
      const error = new Error("transferReference and amount are required.");
      error.statusCode = 400;
      throw error;
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount < 200) {
      return res.status(400).json({
        success: false,
        code: "TOPUP_BELOW_MINIMUM",
        message: "Top-up amount must be at least 200 EGP."
      });
    }

    const existing = await TopUpNotice.findOne({ transferReference: transferReference.trim() });
    if (existing) {
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_TRANSFER_REFERENCE",
        message: "A top-up notice with this transfer reference already exists."
      });
    }

    const profile = await ProviderProfile.findOne({ userId: req.user.id });
    if (!profile) {
      const error = new Error("Provider profile not found.");
      error.statusCode = 404;
      throw error;
    }

    const notice = await TopUpNotice.create({
      providerId: profile._id,
      providerUserId: req.user.id,
      transferReference: transferReference.trim(),
      amount: numAmount,
      status: "pending"
    });

    res.status(201).json({
      success: true,
      message: "Top-up notice submitted successfully. An administrator will verify the transfer.",
      data: notice
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  // Onboarding
  getProviderProfile,
  updateProviderProfile,
  getProviderApplication,
  saveProviderApplicationDraft,
  submitProviderApplication,
  listProviderDocuments,
  addProviderDocument,
  removeProviderDocument,
  listProviderAssessments,
  // Services
  listAvailableCatalogServices,
  requestServiceAccess,
  listProviderServices,
  editProviderService,
  publishProviderService,
  unpublishProviderService,
  // Bookings
  listProviderBookings,
  acceptProviderBooking,
  rejectProviderBooking,
  startProviderBooking,
  completeProviderBooking,
  cancelProviderBooking,
  proposeProviderBookingTime,
  // Requests & Offers
  listOpenMarketplaceRequests,
  getMarketplaceRequestDetail,
  sendOffer,
  listOwnOffers,
  withdrawOffer,
  // Balance
  getProviderBalance,
  getProviderLedger,
  createTopUpNotice
};
