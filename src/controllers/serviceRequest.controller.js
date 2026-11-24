const serviceRequestService = require("../services/serviceRequest.service");

/**
 * POST /api/service-requests
 * Patient creates a new service booking request
 */
const createRequest = async (req, res, next) => {
  try {
    const request = await serviceRequestService.createServiceRequest(req.user.id, req.body);
    res.status(201).json({
      success: true,
      message: "Service request created successfully.",
      data: request
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/service-requests/my-requests
 * Patient views own service requests
 */
const getMyPatientRequests = async (req, res, next) => {
  try {
    const result = await serviceRequestService.getPatientRequests(req.user.id, req.query);
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
 * GET /api/service-requests/provider-requests
 * Provider views received service requests
 */
const getMyProviderRequests = async (req, res, next) => {
  try {
    const result = await serviceRequestService.getProviderRequests(req.user.id, req.query);
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
 * GET /api/service-requests/:id
 * Retrieve single request details
 */
const getRequestDetails = async (req, res, next) => {
  try {
    const request = await serviceRequestService.getRequestDetails(req.user.id, req.params.id);
    res.status(200).json({
      success: true,
      data: request
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/service-requests/:id/cancel
 * Patient or Provider cancels request (Normal cancellation, >= 60 mins before session)
 */
const cancelRequest = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const request = await serviceRequestService.cancelServiceRequest(
      req.user.id,
      req.params.id,
      reason,
      req.user.role
    );
    res.status(200).json({
      success: true,
      message: "Service request cancelled successfully.",
      data: request
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/service-requests/:id/exceptional-cancel
 * Patient or Provider requests exceptional cancellation (Support / Admin intervention)
 */
const requestExceptionalCancel = async (req, res, next) => {
  try {
    const { reason, supportingDetails } = req.body;
    const exceptionalRequest = await serviceRequestService.requestExceptionalCancellation(
      req.user.id,
      req.params.id,
      { reason, supportingDetails },
      req.user.role
    );
    res.status(201).json({
      success: true,
      message: "Exceptional cancellation request submitted for administrative review.",
      data: exceptionalRequest
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/service-requests/:id/respond
 * Provider accepts or rejects request
 */
const respondToRequest = async (req, res, next) => {
  try {
    const { action, reason } = req.body;
    const request = await serviceRequestService.respondToServiceRequest(
      req.user.id,
      req.params.id,
      action,
      reason
    );
    res.status(200).json({
      success: true,
      message: `Service request ${request.status} successfully.`,
      data: request
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/service-requests/:id/status
 * Provider updates execution progress (confirmed, in_progress, completed)
 */
const updateExecutionStatus = async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const request = await serviceRequestService.updateRequestExecutionStatus(
      req.user.id,
      req.params.id,
      status,
      notes
    );
    res.status(200).json({
      success: true,
      message: `Service request updated to '${status}'.`,
      data: request
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createRequest,
  getMyPatientRequests,
  getMyProviderRequests,
  getRequestDetails,
  cancelRequest,
  requestExceptionalCancel,
  respondToRequest,
  updateExecutionStatus
};
