const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth.middleware");
const { handleDocumentUpload } = require("../middleware/upload.middleware");
const { uploadGenericFile } = require("../controllers/upload.controller");

// Generic upload requires authenticated user
router.post("/", authenticate, handleDocumentUpload, uploadGenericFile);

module.exports = router;
