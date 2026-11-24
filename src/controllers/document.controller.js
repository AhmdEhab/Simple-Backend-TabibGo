const {
  getRequiredDocumentsStatus,
  saveUserDocument,
  getUserDocuments,
  getDocumentById,
  getDocumentFileForDownload,
  deleteUserDocument
} = require("../services/document.service");

// Get list of required documents and upload status
const getRequiredDocuments = async (req, res) => {
  try {
    const requirements = await getRequiredDocumentsStatus(req.user);

    return res.status(200).json({
      success: true,
      message: "Required documents retrieved successfully.",
      data: { requirements }
    });
  } catch (error) {
    console.error("Get Required Docs Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Upload or replace a document
const uploadDocument = async (req, res) => {
  try {
    const { documentType, replaceDocumentId } = req.body;

    if (!documentType) {
      return res.status(400).json({
        success: false,
        message: "documentType is required."
      });
    }

    const document = await saveUserDocument(req.user, {
      documentType,
      file: req.file,
      replaceDocumentId: replaceDocumentId || null
    });

    return res.status(201).json({
      success: true,
      message: "Document uploaded successfully.",
      data: {
        document: {
          id: document._id,
          documentType: document.documentType,
          originalFileName: document.originalFileName,
          mimeType: document.mimeType,
          fileSize: document.fileSize,
          status: document.status,
          version: document.version,
          previousDocumentId: document.previousDocumentId,
          uploadedAt: document.uploadedAt
        }
      }
    });
  } catch (error) {
    console.error("Upload Document Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Get all uploaded documents
const getMyDocuments = async (req, res) => {
  try {
    const documents = await getUserDocuments(req.user._id);

    return res.status(200).json({
      success: true,
      message: "Documents retrieved successfully.",
      data: { documents }
    });
  } catch (error) {
    console.error("Get My Documents Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Get single document metadata
const getDocumentMetadata = async (req, res) => {
  try {
    const { documentId } = req.params;

    const doc = await getDocumentById(documentId, req.user._id);

    return res.status(200).json({
      success: true,
      message: "Document metadata retrieved successfully.",
      data: {
        document: {
          id: doc._id,
          documentType: doc.documentType,
          originalFileName: doc.originalFileName,
          mimeType: doc.mimeType,
          fileSize: doc.fileSize,
          status: doc.status,
          rejectionReason: doc.rejectionReason,
          uploadedAt: doc.uploadedAt,
          reviewedAt: doc.reviewedAt
        }
      }
    });
  } catch (error) {
    console.error("Get Doc Metadata Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Private authenticated file download/viewing
const downloadDocument = async (req, res) => {
  try {
    const { documentId } = req.params;

    const fileInfo = await getDocumentFileForDownload(documentId, req.user._id);

    res.setHeader("Content-Type", fileInfo.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${fileInfo.fileName}"`);

    return res.sendFile(fileInfo.filePath);
  } catch (error) {
    console.error("Download Document Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

// Delete a document
const deleteDocument = async (req, res) => {
  try {
    const { documentId } = req.params;

    await deleteUserDocument(documentId, req.user._id);

    return res.status(200).json({
      success: true,
      message: "Document deleted successfully."
    });
  } catch (error) {
    console.error("Delete Document Error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error."
    });
  }
};

module.exports = {
  getRequiredDocuments,
  uploadDocument,
  getMyDocuments,
  getDocumentMetadata,
  downloadDocument,
  deleteDocument
};
