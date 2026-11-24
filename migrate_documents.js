/**
 * Migration Script: Migrate UserDocument Indexes and Initialize Verification Records
 * 
 * Safety Rules:
 * 1. Safe to run multiple times (Idempotent).
 * 2. Does NOT delete any existing documents or user records.
 * 3. Does NOT drop collections.
 * 4. Safely drops only the old unique index `userId_1_documentType_1` on `User_Documents`.
 * 5. Creates new non-unique compound indexes supporting multi-file and versioning.
 * 6. Ensures existing documents have `isActiveVersion: true` and `version: 1`.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("./src/config/database");
const { UserDocument } = require("./src/models/UserDocument");
const { ProviderVerification } = require("./src/models/ProviderVerification");
const ProviderProfile = require("./src/models/ProviderProfile");

const migrate = async () => {
  try {
    console.log("Connecting to MongoDB Atlas...");
    await connectDB();

    const collection = UserDocument.collection;

    // 1. Inspect existing indexes on User_Documents
    const indexes = await collection.indexes();
    console.log("Existing User_Documents Indexes:");
    indexes.forEach((idx) => console.log(` - ${idx.name} (unique: ${Boolean(idx.unique)})`));

    // 2. Drop the old unique index if it exists
    const oldUniqueIndex = indexes.find(
      (idx) => idx.name === "userId_1_documentType_1" && idx.unique === true
    );

    if (oldUniqueIndex) {
      console.log("\nDropping old unique index 'userId_1_documentType_1'...");
      await collection.dropIndex("userId_1_documentType_1");
      console.log("Old unique index dropped successfully.");
    } else {
      console.log("\nOld unique index 'userId_1_documentType_1' not found or already dropped.");
    }

    // 3. Ensure new non-unique index on { userId: 1, documentType: 1, isActiveVersion: 1 }
    console.log("Creating new index { userId: 1, documentType: 1, isActiveVersion: 1 }...");
    await collection.createIndex(
      { userId: 1, documentType: 1, isActiveVersion: 1 },
      { name: "userId_1_documentType_1_isActiveVersion_1", background: true }
    );

    // 4. Update existing UserDocument records with default versioning fields if missing
    console.log("Backfilling versioning fields for existing documents...");
    const updateResult = await UserDocument.updateMany(
      { isActiveVersion: { $exists: false } },
      { $set: { isActiveVersion: true, version: 1, previousDocumentId: null } }
    );
    console.log(`Updated ${updateResult.modifiedCount} existing document records.`);

    // 5. Initialize ProviderVerification records for existing providers if missing
    console.log("Initializing ProviderVerification records for existing providers...");
    const providers = await ProviderProfile.find();
    let createdVerifications = 0;
    for (const prov of providers) {
      const exists = await ProviderVerification.findOne({ providerId: prov._id });
      if (!exists) {
        await ProviderVerification.create({
          providerId: prov._id,
          userId: prov.userId,
          overallStatus: prov.isApproved ? "verified" : "unverified"
        });
        createdVerifications++;
      }
    }
    console.log(`Created ${createdVerifications} verification records.`);

    // 6. Verify updated indexes
    const updatedIndexes = await collection.indexes();
    console.log("\nUpdated User_Documents Indexes:");
    updatedIndexes.forEach((idx) => console.log(` - ${idx.name} (unique: ${Boolean(idx.unique)})`));

    console.log("\nMigration completed successfully!");
  } catch (err) {
    console.error("Migration failed with error:", err.message);
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  migrate();
}

module.exports = migrate;
