const serviceService = require("../services/service.service");

/**
 * GET /api/services/categories
 */
const listCategories = async (req, res, next) => {
  try {
    const { professionId } = req.query;
    const categories = await serviceService.getCategories(professionId);
    res.status(200).json({
      success: true,
      data: categories
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/services
 * Provider: Create & publish service
 */
const createService = async (req, res, next) => {
  try {
    const service = await serviceService.createService(req.user.id, req.body);
    res.status(201).json({
      success: true,
      message: "Service created successfully and published.",
      data: service
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/services/:id
 * Provider: Update service
 */
const updateService = async (req, res, next) => {
  try {
    const service = await serviceService.updateService(req.user.id, req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: "Service updated successfully.",
      data: service
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/services/my-services
 * Provider: List own services
 */
const getMyServices = async (req, res, next) => {
  try {
    const result = await serviceService.getProviderServices(req.user.id, req.query);
    res.status(200).json({
      success: true,
      data: result.services,
      pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/services/discover
 * Public/Patient Discovery
 */
const discoverServices = async (req, res, next) => {
  try {
    const result = await serviceService.discoverServices(req.query);
    res.status(200).json({
      success: true,
      data: result.services,
      pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/services/:id
 * Public/Patient View Service Details
 */
const getServiceDetails = async (req, res, next) => {
  try {
    const service = await serviceService.getServiceDetails(req.params.id);
    res.status(200).json({
      success: true,
      data: service
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listCategories,
  createService,
  updateService,
  getMyServices,
  discoverServices,
  getServiceDetails
};
