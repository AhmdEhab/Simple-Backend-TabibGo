const express = require("express");
const router = express.Router();
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");
const {
  createRequest,
  getMyPatientRequests,
  getMyProviderRequests,
  getRequestDetails,
  cancelRequest,
  requestExceptionalCancel,
  respondToRequest,
  updateExecutionStatus
} = require("../controllers/serviceRequest.controller");


router.use(authenticate);

// Patient endpoints
router.post("/", authorizeRoles("patient"), createRequest);
router.get("/my-requests", authorizeRoles("patient"), getMyPatientRequests);
router.post("/:id/cancel", cancelRequest); // Patient or Provider normal cancellation
router.post("/:id/exceptional-cancel", requestExceptionalCancel); // Patient or Provider exceptional cancellation

// Provider endpoints
router.get("/provider-requests", authorizeRoles("provider"), getMyProviderRequests);
router.post("/:id/respond", authorizeRoles("provider"), respondToRequest);
router.patch("/:id/status", authorizeRoles("provider"), updateExecutionStatus);

// Common detail endpoint (validated per user)
router.get("/:id", getRequestDetails);

module.exports = router;
