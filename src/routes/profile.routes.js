const express = require("express");
const router = express.Router();
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");
const {
  completePatientProfile,
  completeProviderProfile,
  getMyProfile,
  updateMyProfile,
  listProfessions
} = require("../controllers/profile.controller");

// Public or authenticated list of active professions
router.get("/professions", listProfessions);

// Protected Profile Endpoints
router.get("/me", authenticate, getMyProfile);
router.put("/me", authenticate, updateMyProfile);

// Specific creation endpoints
router.post("/patient", authenticate, authorizeRoles("patient"), completePatientProfile);
router.post("/provider", authenticate, authorizeRoles("provider"), completeProviderProfile);

module.exports = router;
