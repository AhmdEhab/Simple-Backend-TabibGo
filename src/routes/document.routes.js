const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth.middleware");
const { handleDocumentUpload } = require("../middleware/upload.middleware");
const {
  getRequiredDocuments,
  uploadDocument,
  getMyDocuments,
  getDocumentMetadata,
  downloadDocument,
  deleteDocument
} = require("../controllers/document.controller");

// All document endpoints require authentication
router.use(authenticate);

// Get required documents list with statuses
router.get("/requirements", getRequiredDocuments);

// Upload or replace a document
router.post("/upload", handleDocumentUpload, uploadDocument);

// Get list of uploaded documents
router.get("/my-documents", getMyDocuments);

// Get specific document metadata
router.get("/:documentId", getDocumentMetadata);

// Download or view authenticated document
router.get("/:documentId/download", downloadDocument);

// Delete document
router.delete("/:documentId", deleteDocument);

module.exports = router;
