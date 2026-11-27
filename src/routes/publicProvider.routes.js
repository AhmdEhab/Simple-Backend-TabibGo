const express = require("express");
const router = express.Router();
const { getPublicProviderProfile } = require("../controllers/publicProvider.controller");

// Public route
router.get("/:id", getPublicProviderProfile);

module.exports = router;
