const ServiceCatalog = require("../models/ServiceCatalog");
const Profession = require("../models/Profession");

/**
 * GET /api/catalog/service-types
 * List service catalog items
 */
const listCatalogServiceTypes = async (req, res, next) => {
  try {
    const { professionId, page = 1, limit = 20 } = req.query;
    const filter = { isActive: true };
    if (professionId) filter.professionId = professionId;

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const items = await ServiceCatalog.find(filter)
      .populate("professionId", "name description")
      .sort({ name: 1 })
      .skip(skip)
      .limit(parseInt(limit, 10));

    const total = await ServiceCatalog.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: items,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        pages: Math.ceil(total / parseInt(limit, 10))
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/catalog/professions
 * List professions that have at least one active catalog item
 */
const listCatalogProfessions = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    // Distinct professionIds from active ServiceCatalog items
    const activeCatalogProfessionIds = await ServiceCatalog.distinct("professionId", { isActive: true });

    const filter = {
      _id: { $in: activeCatalogProfessionIds },
      isActive: true
    };

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const professions = await Profession.find(filter)
      .sort({ name: 1 })
      .skip(skip)
      .limit(parseInt(limit, 10));

    const total = await Profession.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: professions,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        pages: Math.ceil(total / parseInt(limit, 10))
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listCatalogServiceTypes,
  listCatalogProfessions
};
