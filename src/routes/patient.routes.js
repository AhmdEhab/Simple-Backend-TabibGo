const express = require("express");
const router = express.Router();
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");
const {
  getPatientProfile,
  updatePatientProfile,
  getPatientVerifications,
  submitPatientVerification
} = require("../controllers/patient.controller");

// All patient endpoints require authenticated patient
router.use(authenticate, authorizeRoles("patient"));

router.get("/profile", getPatientProfile);
router.patch("/profile", updatePatientProfile);

router.get("/verification", getPatientVerifications);
router.post("/verification", submitPatientVerification);

module.exports = router;
