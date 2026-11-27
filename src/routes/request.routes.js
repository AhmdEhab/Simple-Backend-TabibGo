const express = require("express");
const router = express.Router();
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");
const {
  postRequest,
  getMyRequests,
  getRequestWithOffers,
  cancelRequest,
  acceptRequestOffer
} = require("../controllers/request.controller");

// Patient request routes require authenticated patient
router.use(authenticate, authorizeRoles("patient"));

router.post("/", postRequest);
router.get("/", getMyRequests);
router.get("/:id", getRequestWithOffers);
router.patch("/:id/cancel", cancelRequest);
router.post("/:id/offers/:offerId/accept", acceptRequestOffer);

module.exports = router;
