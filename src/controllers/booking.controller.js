const bookingService = require("../services/booking.service");

/**
 * POST /api/bookings
 * Patient creates a booking
 */
const createBooking = async (req, res, next) => {
  try {
    const booking = await bookingService.createPatientBooking(req.user.id, req.body);
    res.status(201).json({
      success: true,
      message: "Booking created successfully.",
      data: booking
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/bookings
 * Patient lists own bookings
 */
const getMyBookings = async (req, res, next) => {
  try {
    const result = await bookingService.getPatientBookings(req.user.id, req.query);
    res.status(200).json({
      success: true,
      data: result.bookings,
      pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/bookings/:id
 * Patient booking detail
 */
const getBooking = async (req, res, next) => {
  try {
    const booking = await bookingService.getBookingDetails(req.user.id, req.params.id);
    res.status(200).json({
      success: true,
      data: booking
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/bookings/:id/cancel
 * Patient cancels booking
 */
const cancelPatientBooking = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const booking = await bookingService.cancelBooking(req.user.id, req.params.id, reason, "patient");
    res.status(200).json({
      success: true,
      message: "Booking cancelled successfully.",
      data: booking
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/bookings/:id/rating
 * Patient rates completed booking
 */
const rateBooking = async (req, res, next) => {
  try {
    const rating = await bookingService.rateBooking(req.user.id, req.params.id, req.body);
    res.status(201).json({
      success: true,
      message: "Rating submitted successfully.",
      data: rating
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/bookings/:id/time-proposal
 * Patient answers provider's time proposal
 */
const answerTimeProposal = async (req, res, next) => {
  try {
    const result = await bookingService.answerTimeProposal(req.user.id, req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: "Time proposal response recorded.",
      data: result
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createBooking,
  getMyBookings,
  getBooking,
  cancelPatientBooking,
  rateBooking,
  answerTimeProposal
};
