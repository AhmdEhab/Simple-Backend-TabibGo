const express = require("express");
const router = express.Router();
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");
const {
  createApplication,
  getApplicationStatus
} = require("../controllers/providerApplication.controller");

// Only authenticated providers can access application endpoints
router.use(authenticate, authorizeRoles("provider"));

router.get("/status", getApplicationStatus);
router.post("/submit", createApplication);

module.exports = router;
