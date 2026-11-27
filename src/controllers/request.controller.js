const requestService = require("../services/request.service");

/**
 * POST /api/requests
 * Patient posts a service request
 */
const postRequest = async (req, res, next) => {
  try {
    const request = await requestService.createPatientRequest(req.user.id, req.body);
    res.status(201).json({
      success: true,
      message: "Service request posted successfully.",
      data: request
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/requests
 * Patient lists own requests
 */
const getMyRequests = async (req, res, next) => {
  try {
    const result = await requestService.getPatientRequests(req.user.id, req.query);
    res.status(200).json({
      success: true,
      data: result.requests,
      pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/requests/:id
 * Patient gets request detail with its offers
 */
const getRequestWithOffers = async (req, res, next) => {
  try {
    const result = await requestService.getPatientRequestDetails(req.user.id, req.params.id);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/requests/:id/cancel
 * Patient cancels request
 */
const cancelRequest = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const request = await requestService.cancelPatientRequest(req.user.id, req.params.id, reason);
    res.status(200).json({
      success: true,
      message: "Request cancelled successfully.",
      data: request
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/requests/:id/offers/:offerId/accept
 * Patient accepts an offer
 */
const acceptRequestOffer = async (req, res, next) => {
  try {
    const result = await requestService.acceptOffer(req.user.id, req.params.id, req.params.offerId);
    res.status(200).json({
      success: true,
      message: "Offer accepted and booking confirmed successfully.",
      data: result
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  postRequest,
  getMyRequests,
  getRequestWithOffers,
  cancelRequest,
  acceptRequestOffer
};
