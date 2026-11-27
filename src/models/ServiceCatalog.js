const mongoose = require("mongoose");

const serviceCatalogSchema = new mongoose.Schema(
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
    durationOptions: {
      type: [Number],
      default: [30, 60, 90]
    },
    priceReference: {
      type: {
        type: String,
        enum: ["fixed", "range", "min", "max", null],
        default: null
      },
      min: { type: Number, default: null },
      max: { type: Number, default: null }
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

serviceCatalogSchema.index({ professionId: 1, name: 1 }, { unique: true });

const ServiceCatalog = mongoose.model(
  "ServiceCatalog",
  serviceCatalogSchema,
  "Service_Catalog"
);

module.exports = ServiceCatalog;
