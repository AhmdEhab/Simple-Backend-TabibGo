const mongoose = require("mongoose");

const serviceCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    professionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Profession",
      required: true,
      index: true
    },
    description: {
      type: String,
      trim: true,
      default: null
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

serviceCategorySchema.index({ professionId: 1, name: 1 }, { unique: true });

const ServiceCategory = mongoose.model(
  "ServiceCategory",
  serviceCategorySchema,
  "Service_Categories"
);

module.exports = ServiceCategory;
