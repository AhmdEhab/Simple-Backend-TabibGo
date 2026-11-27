const express = require("express");
const router = express.Router();
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");
const {
  createBooking,
  getMyBookings,
  getBooking,
  cancelPatientBooking,
  rateBooking,
  answerTimeProposal
} = require("../controllers/booking.controller");

// Patient booking endpoints require authenticated patient
router.use(authenticate, authorizeRoles("patient"));

router.post("/", createBooking);
router.get("/", getMyBookings);
router.get("/:id", getBooking);
router.patch("/:id/cancel", cancelPatientBooking);
router.post("/:id/rating", rateBooking);
router.patch("/:id/time-proposal", answerTimeProposal);

module.exports = router;
