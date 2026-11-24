const express = require("express");
const router = express.Router();
const { verifyInternalService } = require("../middleware/internalAuth.middleware");
const {
  listApplications,
  getApplication,
  getDocumentInfo,
  downloadDocument,
  submitDocumentReview,
  submitStageVerification,
  submitApplicationDecision,
  getAuditHistory,
  listServices,
  getService,
  submitServiceReview,
  submitServiceSuspension,
  submitServiceRestoration,
  getServiceAuditHistory,
  listExceptionalCancellations,
  getExceptionalCancellation,
  submitExceptionalCancellationDecision
} = require("../controllers/internalReview.controller");

// All internal routes are strictly protected by service-to-service authentication
router.use(verifyInternalService);

// 1. Applications List
router.get("/applications", listApplications);

// 2. Application Full Details
router.get("/applications/:applicationId", getApplication);

// 3. Document Metadata for Reviewer
router.get("/documents/:documentId", getDocumentInfo);

// 4. Secure Private Document Download for Reviewer
router.get("/documents/:documentId/download", downloadDocument);

// 5. Approve or Reject an Individual Document
router.patch("/documents/:documentId/review", submitDocumentReview);

// 6. Record Verification Stage Decision
router.patch("/providers/:providerId/verification/:stageName", submitStageVerification);

// 7. Decide Provider Application (Approve / Reject / Interview / Under Review)
router.patch("/applications/:applicationId/decide", submitApplicationDecision);

// 8. Retrieve Complete Provider Audit & Review History
router.get("/providers/:providerId/history", getAuditHistory);

// --- 9. Service Management & Moderation Endpoints ---
// GET /api/internal/reviews/services
router.get("/services", listServices);

// GET /api/internal/reviews/services/:id
router.get("/services/:id", getService);

// PATCH /api/internal/reviews/services/:id/review
router.patch("/services/:id/review", submitServiceReview);

// PATCH /api/internal/reviews/services/:id/suspend
router.patch("/services/:id/suspend", submitServiceSuspension);

// PATCH /api/internal/reviews/services/:id/restore
router.patch("/services/:id/restore", submitServiceRestoration);

// GET /api/internal/reviews/services/:id/history
router.get("/services/:id/history", getServiceAuditHistory);

// --- 10. Exceptional Cancellation Requests & Support Endpoints ---
// GET /api/internal/reviews/exceptional-cancellations
router.get("/exceptional-cancellations", listExceptionalCancellations);

// GET /api/internal/reviews/exceptional-cancellations/:id
router.get("/exceptional-cancellations/:id", getExceptionalCancellation);

// PATCH /api/internal/reviews/exceptional-cancellations/:id/decide
router.patch("/exceptional-cancellations/:id/decide", submitExceptionalCancellationDecision);

module.exports = router;
