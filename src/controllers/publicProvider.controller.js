const ProviderProfile = require("../models/ProviderProfile");
const { Service } = require("../models/Service");

/**
 * GET /api/providers/:id
 * Public provider profile.
 * Approved providers only.
 * Returns public fields only: name, photo, bio, profession, years of experience,
 * service area, published services, and rating.
 * Never returns documents, contact details, or patient data.
 */
const getPublicProviderProfile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const provider = await ProviderProfile.findOne({
      _id: id,
      isApproved: true
    })
      .populate("professionId", "name description")
      .select("fullName photoUrl bio yearsOfExperience serviceArea ratingAvg ratingCount professionId createdAt");

    if (!provider) {
      const error = new Error("Provider not found or not currently active.");
      error.statusCode = 404;
      throw error;
    }

    // Fetch published services from this approved provider
    const publishedServices = await Service.find({
      providerId: provider._id,
      publicationStatus: "published",
      moderationStatus: { $nin: ["rejected", "suspended"] }
    })
      .populate("professionId", "name")
      .populate("catalogId", "name")
      .select("title description price currency durationMinutes serviceAreas");

    res.status(200).json({
      success: true,
      data: {
        provider: {
          id: provider._id,
          fullName: provider.fullName,
          photoUrl: provider.photoUrl,
          bio: provider.bio,
          yearsOfExperience: provider.yearsOfExperience,
          serviceArea: provider.serviceArea,
          ratingAvg: provider.ratingAvg,
          ratingCount: provider.ratingCount,
          profession: provider.professionId
        },
        services: publishedServices
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPublicProviderProfile
};
