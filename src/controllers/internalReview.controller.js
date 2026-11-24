const {
  getPendingApplications,
  getApplicationDetails,
  getProviderDocumentMetadata,
  getDocumentFileForAdmin,
  reviewDocument,
  updateVerificationStage,
  decideProviderApplication,
  getProviderAuditHistory,
  getServicesForAdmin,
  getServiceDetailsForAdmin,
  reviewService,
  suspendService,
  restoreService,
  getServiceHistory,
  getExceptionalCancellationRequests,
  getExceptionalCancellationRequestDetails,
  decideExceptionalCancellation
} = require("../services/internalReview.service");

// List pending applications
const listApplications = async (req, res) => {
  try {
    const { page, limit, status } = req.query;
    const result = await getPendingApplications({ page, limit, status });

    return res.status(200).json({
      success: true,
      message: "Pending applications retrieved successfully.",
      data: result
    });
  } catch (error) {
    console.error("List Applications Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Application details
const getApplication = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const result = await getApplicationDetails(applicationId);

    return res.status(200).json({
      success: true,
      message: "Application details retrieved successfully.",
      data: result
    });
  } catch (error) {
    console.error("Get Application Details Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Document metadata
const getDocumentInfo = async (req, res) => {
  try {
    const { documentId } = req.params;
    const document = await getProviderDocumentMetadata(documentId);

    return res.status(200).json({
      success: true,
      message: "Document metadata retrieved successfully.",
      data: { document }
    });
  } catch (error) {
    console.error("Get Doc Info Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Admin document file streaming
const downloadDocument = async (req, res) => {
  try {
    const { documentId } = req.params;
    const fileInfo = await getDocumentFileForAdmin(documentId);

    res.setHeader("Content-Type", fileInfo.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${fileInfo.fileName}"`);

    return res.sendFile(fileInfo.filePath);
  } catch (error) {
    console.error("Admin Download Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Review document
const submitDocumentReview = async (req, res) => {
  try {
    const { documentId } = req.params;
    const { decision, reason } = req.body;

    if (!decision || !["approve", "reject"].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: "Decision is required and must be 'approve' or 'reject'."
      });
    }

    const document = await reviewDocument({
      documentId,
      decision,
      reason,
      adminId: req.adminId
    });

    return res.status(200).json({
      success: true,
      message: `Document ${decision}d successfully.`,
      data: { document }
    });
  } catch (error) {
    console.error("Submit Document Review Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Update verification stage
const submitStageVerification = async (req, res) => {
  try {
    const { providerId, stageName } = req.params;
    const {
      status,
      reviewNotes,
      rejectionReason,
      verificationMethod,
      supportingDocumentIds
    } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required for verification stage update."
      });
    }

    const verification = await updateVerificationStage({
      providerId,
      stageName,
      status,
      reviewNotes,
      rejectionReason,
      verificationMethod,
      supportingDocumentIds,
      adminId: req.adminId
    });

    return res.status(200).json({
      success: true,
      message: `Verification stage '${stageName}' updated successfully.`,
      data: { verification }
    });
  } catch (error) {
    console.error("Submit Stage Verification Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Decide application
const submitApplicationDecision = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { decision, reason } = req.body;

    if (!decision) {
      return res.status(400).json({
        success: false,
        message: "Decision is required."
      });
    }

    const result = await decideProviderApplication({
      applicationId,
      decision,
      reason,
      adminId: req.adminId
    });

    return res.status(200).json({
      success: true,
      message: `Application decided as '${decision}' successfully.`,
      data: result
    });
  } catch (error) {
    console.error("Decide Application Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Audit history
const getAuditHistory = async (req, res) => {
  try {
    const { providerId } = req.params;
    const result = await getProviderAuditHistory(providerId);

    return res.status(200).json({
      success: true,
      message: "Provider audit history retrieved successfully.",
      data: result
    });
  } catch (error) {
    console.error("Get Audit History Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// --- Service Moderation Handlers ---

// List services for admin moderation
const listServices = async (req, res) => {
  try {
    const result = await getServicesForAdmin(req.query);
    return res.status(200).json({
      success: true,
      data: result.services,
      pagination: result.pagination
    });
  } catch (error) {
    console.error("List Services Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Get single service for admin
const getService = async (req, res) => {
  try {
    const service = await getServiceDetailsForAdmin(req.params.id);
    return res.status(200).json({
      success: true,
      data: service
    });
  } catch (error) {
    console.error("Get Service Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Review service (approve or reject)
const submitServiceReview = async (req, res) => {
  try {
    const service = await reviewService(req.params.id, req.body, req.adminId);
    return res.status(200).json({
      success: true,
      message: `Service moderation ${service.moderationStatus} successfully.`,
      data: service
    });
  } catch (error) {
    console.error("Submit Service Review Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Suspend service
const submitServiceSuspension = async (req, res) => {
  try {
    const service = await suspendService(req.params.id, req.body, req.adminId);
    return res.status(200).json({
      success: true,
      message: "Service suspended successfully.",
      data: service
    });
  } catch (error) {
    console.error("Submit Service Suspension Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Restore service
const submitServiceRestoration = async (req, res) => {
  try {
    const service = await restoreService(req.params.id, req.body, req.adminId);
    return res.status(200).json({
      success: true,
      message: "Service restored successfully.",
      data: service
    });
  } catch (error) {
    console.error("Submit Service Restoration Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Get service audit history
const getServiceAuditHistory = async (req, res) => {
  try {
    const result = await getServiceHistory(req.params.id);
    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error("Get Service Audit History Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// List exceptional cancellation requests for admin
const listExceptionalCancellations = async (req, res) => {
  try {
    const result = await getExceptionalCancellationRequests(req.query);
    return res.status(200).json({
      success: true,
      data: result.requests,
      pagination: result.pagination
    });
  } catch (error) {
    console.error("List Exceptional Cancellations Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Get single exceptional cancellation request details
const getExceptionalCancellation = async (req, res) => {
  try {
    const request = await getExceptionalCancellationRequestDetails(req.params.id);
    return res.status(200).json({
      success: true,
      data: request
    });
  } catch (error) {
    console.error("Get Exceptional Cancellation Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Decide on exceptional cancellation request (approve or reject)
const submitExceptionalCancellationDecision = async (req, res) => {
  try {
    const result = await decideExceptionalCancellation(
      req.params.id,
      req.body,
      req.adminId
    );
    return res.status(200).json({
      success: true,
      message: `Exceptional cancellation request ${result.exceptionalRequest.status} successfully.`,
      data: result
    });
  } catch (error) {
    console.error("Submit Exceptional Cancellation Decision Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

module.exports = {
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
};
