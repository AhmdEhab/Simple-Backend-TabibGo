const express = require("express");
const router = express.Router();
const {
  listCatalogServiceTypes,
  listCatalogProfessions
} = require("../controllers/catalog.controller");

// Public endpoints
router.get("/service-types", listCatalogServiceTypes);
router.get("/professions", listCatalogProfessions);

module.exports = router;
