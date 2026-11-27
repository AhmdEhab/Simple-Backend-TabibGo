const express = require("express");
const router = express.Router();
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");
const {
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
} = require("../controllers/provider.controller");

// All provider endpoints require authenticated provider
router.use(authenticate, authorizeRoles("provider"));

// 1. Onboarding & Profile (Section 7)
router.get("/profile", getProviderProfile);
router.patch("/profile", updateProviderProfile);
router.get("/application", getProviderApplication);
router.put("/application", saveProviderApplicationDraft);
router.post("/application/submit", submitProviderApplication);
router.get("/documents", listProviderDocuments);
router.post("/documents", addProviderDocument);
router.delete("/documents/:id", removeProviderDocument);
router.get("/assessments", listProviderAssessments);

// 2. Services Management (Section 8)
router.get("/services/available", listAvailableCatalogServices);
router.post("/service-requests", requestServiceAccess);
router.get("/services", listProviderServices);
router.patch("/services/:id", editProviderService);
router.post("/services/:id/publish", publishProviderService);
router.post("/services/:id/unpublish", unpublishProviderService);

// 3. Bookings (Section 9)
router.get("/bookings", listProviderBookings);
router.patch("/bookings/:id/accept", acceptProviderBooking);
router.patch("/bookings/:id/reject", rejectProviderBooking);
router.patch("/bookings/:id/start", startProviderBooking);
router.patch("/bookings/:id/complete", completeProviderBooking);
router.patch("/bookings/:id/cancel", cancelProviderBooking);
router.post("/bookings/:id/propose-time", proposeProviderBookingTime);

// 4. Requests & Offers (Section 10)
router.get("/requests", listOpenMarketplaceRequests);
router.get("/requests/:id", getMarketplaceRequestDetail);
router.post("/requests/:id/offers", sendOffer);
router.get("/offers", listOwnOffers);
router.patch("/offers/:id/withdraw", withdrawOffer);

// 5. Balance & Commission (Section 12)
router.get("/balance", getProviderBalance);
router.get("/ledger", getProviderLedger);
router.post("/top-up-notices", createTopUpNotice);

module.exports = router;
