const fs = require("fs");
const path = require("path");
const { UserDocument } = require("../models/UserDocument");
const { DocumentAuditLog } = require("../models/DocumentAuditLog");
const ProviderProfile = require("../models/ProviderProfile");
const PatientProfile = require("../models/PatientProfile");
const {
  PATIENT_DOCUMENTS_CONFIG,
  PROFESSION_DOCUMENT_CONFIGS
} = require("../config/documentRequirements");

/**
 * Resolve provider document rules based on profession
 */
const getProviderDocumentRules = async (userId) => {
  const provider = await ProviderProfile.findOne({ userId }).populate("professionId");
  const professionName = provider?.professionId?.name || "Nurse"; // fallback if unset

  const rules = PROFESSION_DOCUMENT_CONFIGS[professionName] || PROFESSION_DOCUMENT_CONFIGS["Nurse"];
  return rules;
};

/**
 * Get required documents list with current status for user
 */
const getRequiredDocumentsStatus = async (user) => {
  let requiredDefs = [];
  if (user.role === "patient") {
    requiredDefs = PATIENT_DOCUMENTS_CONFIG;
  } else if (user.role === "provider") {
    requiredDefs = await getProviderDocumentRules(user._id);
  } else {
    const error = new Error("Invalid user role.");
    error.statusCode = 400;
    throw error;
  }

  // Fetch all active uploaded documents for this user
  const uploadedDocs = await UserDocument.find({
    userId: user._id,
    isActiveVersion: true
  }).sort({ uploadedAt: -1 });

  const uploadedMap = new Map();
  // Group documents by documentType (or legacyType)
  uploadedDocs.forEach((doc) => {
    if (!uploadedMap.has(doc.documentType)) {
      uploadedMap.set(doc.documentType, []);
    }
    uploadedMap.get(doc.documentType).push(doc);
  });

  return requiredDefs.map((def) => {
    // Check match for specific type or legacyType
    let docs = uploadedMap.get(def.type) || [];
    if (docs.length === 0 && def.legacyType) {
      docs = uploadedMap.get(def.legacyType) || [];
    }

    const latestDoc = docs.length > 0 ? docs[0] : null;

    return {
      documentType: def.type,
      legacyType: def.legacyType || null,
      label: def.label,
      category: def.category, // legal_mandatory or platform_policy
      authority: def.authority || null,
      required: def.required,
      allowMultiple: def.allowMultiple || false,
      description: def.description,
      isUploaded: docs.length > 0,
      uploadCount: docs.length,
      status: latestDoc ? latestDoc.status : "missing",
      documentId: latestDoc ? latestDoc._id : null,
      uploadedAt: latestDoc ? latestDoc.uploadedAt : null,
      rejectionReason: latestDoc ? latestDoc.rejectionReason : null,
      documents: docs.map((d) => ({
        id: d._id,
        originalFileName: d.originalFileName,
        status: d.status,
        version: d.version,
        uploadedAt: d.uploadedAt
      }))
    };
  });
};

/**
 * Upload a document or replacement version safely
 * Supports:
 * 1. Multiple documents of types that have allowMultiple: true (e.g. experience_certificate)
 * 2. Versioned replacement for single-document types, preserving old records, status, and rejection history
 */
const saveUserDocument = async (user, { documentType, file, replaceDocumentId = null }) => {
  // Validate that documentType is allowed for user's role and profession
  const requiredList = await getRequiredDocumentsStatus(user);
  const matchedRule = requiredList.find(
    (r) => r.documentType === documentType || (r.legacyType && r.legacyType === documentType)
  );

  if (!matchedRule) {
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    const error = new Error(`Document type '${documentType}' is not valid for role '${user.role}'.`);
    error.statusCode = 400;
    throw error;
  }

  const targetDocType = matchedRule.documentType;
  const allowMultiple = matchedRule.allowMultiple;

  let previousDoc = null;
  let newVersion = 1;

  // If client specified an existing document to replace
  if (replaceDocumentId) {
    previousDoc = await UserDocument.findOne({
      _id: replaceDocumentId,
      userId: user._id
    });
  } else if (!allowMultiple) {
    // If not a multi-file type, find current active document to supersede
    previousDoc = await UserDocument.findOne({
      userId: user._id,
      documentType: { $in: [targetDocType, matchedRule.legacyType].filter(Boolean) },
      isActiveVersion: true
    }).sort({ version: -1 });
  }

  if (previousDoc) {
    newVersion = (previousDoc.version || 1) + 1;
  }

  try {
    // 1. Create brand-new document record
    const newDoc = await UserDocument.create({
      userId: user._id,
      documentType: targetDocType,
      originalFileName: file.originalname,
      storedFileName: file.filename,
      mimeType: file.mimetype,
      fileSize: file.size,
      storageKey: file.path,
      status: "pending_review",
      rejectionReason: null,
      isActiveVersion: true,
      version: newVersion,
      previousDocumentId: previousDoc ? previousDoc._id : null,
      uploadedAt: new Date()
    });

    // 2. If replacing a previous document, mark the previous record as superseded (isActiveVersion: false)
    // NOTE: The previous database record and its file on disk are PRESERVED for audit history!
    if (previousDoc) {
      previousDoc.isActiveVersion = false;
      await previousDoc.save();

      // Audit log replacement
      await DocumentAuditLog.create({
        targetType: "document",
        targetId: newDoc._id,
        userId: user._id,
        action: "document_replaced",
        previousStatus: previousDoc.status,
        newStatus: "pending_review",
        actorType: "user",
        actorId: user._id.toString(),
        reason: `Replaced document version ${previousDoc.version} with version ${newVersion}.`,
        metadata: {
          previousDocumentId: previousDoc._id,
          previousFileName: previousDoc.originalFileName,
          newFileName: newDoc.originalFileName
        }
      });
    } else {
      // Audit log new upload
      await DocumentAuditLog.create({
        targetType: "document",
        targetId: newDoc._id,
        userId: user._id,
        action: "document_uploaded",
        previousStatus: null,
        newStatus: "pending_review",
        actorType: "user",
        actorId: user._id.toString(),
        metadata: {
          documentType: targetDocType,
          fileName: newDoc.originalFileName,
          version: newVersion
        }
      });
    }

    // Update patient identityStatus or provider sync if relevant
    if (user.role === "patient") {
      await PatientProfile.findOneAndUpdate(
        { userId: user._id },
        { $set: { identityStatus: "pending" } }
      );
    }

    return newDoc;
  } catch (dbError) {
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    throw dbError;
  }
};

/**
 * Get all active uploaded documents for user
 */
const getUserDocuments = async (userId) => {
  return UserDocument.find({ userId, isActiveVersion: true }).select("-storageKey").sort({ uploadedAt: -1 });
};

/**
 * Get all document versions (including superseded records) for audit history
 */
const getUserDocumentHistory = async (userId) => {
  return UserDocument.find({ userId }).select("-storageKey").sort({ uploadedAt: -1 });
};

/**
 * Get single document metadata by ID with ownership check
 */
const getDocumentById = async (documentId, userId) => {
  const doc = await UserDocument.findOne({ _id: documentId, userId });
  if (!doc) {
    const error = new Error("Document not found or access denied.");
    error.statusCode = 404;
    throw error;
  }
  return doc;
};

/**
 * Get document stream/file for private authenticated download
 */
const getDocumentFileForDownload = async (documentId, userId) => {
  const doc = await UserDocument.findOne({ _id: documentId, userId });
  if (!doc) {
    const error = new Error("Document not found or access denied.");
    error.statusCode = 404;
    throw error;
  }

  const resolvedPath = path.resolve(doc.storageKey);
  if (!fs.existsSync(resolvedPath)) {
    const error = new Error("Document file is missing from storage.");
    error.statusCode = 404;
    throw error;
  }

  return {
    filePath: resolvedPath,
    mimeType: doc.mimeType,
    fileName: doc.originalFileName
  };
};

/**
 * Delete a document (only allowed if pending_review or rejected, not if approved)
 */
const deleteUserDocument = async (documentId, userId) => {
  const doc = await UserDocument.findOne({ _id: documentId, userId });
  if (!doc) {
    const error = new Error("Document not found or access denied.");
    error.statusCode = 404;
    throw error;
  }

  if (doc.status === "approved") {
    const error = new Error("Approved documents cannot be deleted.");
    error.statusCode = 400;
    throw error;
  }

  // Remove physical file
  if (doc.storageKey && fs.existsSync(doc.storageKey)) {
    try {
      fs.unlinkSync(doc.storageKey);
    } catch (err) {
      console.warn("Could not delete file:", doc.storageKey, err.message);
    }
  }

  // If this was an active document replacing a previous one, restore previous active flag if appropriate
  if (doc.previousDocumentId) {
    await UserDocument.updateOne(
      { _id: doc.previousDocumentId },
      { $set: { isActiveVersion: true } }
    );
  }

  await UserDocument.deleteOne({ _id: documentId });

  return true;
};

module.exports = {
  getRequiredDocumentsStatus,
  getProviderDocumentRules,
  saveUserDocument,
  getUserDocuments,
  getUserDocumentHistory,
  getDocumentById,
  getDocumentFileForDownload,
  deleteUserDocument
};
