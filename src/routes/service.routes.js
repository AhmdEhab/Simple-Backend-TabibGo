const express = require("express");
const router = express.Router();
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");
const {
  listCategories,
  createService,
  updateService,
  getMyServices,
  discoverServices,
  getServiceDetails
} = require("../controllers/service.controller");

// Public / Discovery routes
router.get("/categories", listCategories);
router.get("/discover", discoverServices);

// Provider authenticated routes
router.post("/", authenticate, authorizeRoles("provider"), createService);
router.get("/my-services", authenticate, authorizeRoles("provider"), getMyServices);
router.put("/:id", authenticate, authorizeRoles("provider"), updateService);

// Public / Authenticated service details
router.get("/:id", getServiceDetails);

module.exports = router;
