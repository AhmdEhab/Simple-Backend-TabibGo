const path = require("path");

/**
 * POST /api/uploads
 * Generic signed-in file upload.
 * Validates type and size (via multer & magic-byte middleware).
 * Returns { fileUrl } without creating user-document database record.
 */
const uploadGenericFile = async (req, res, next) => {
  try {
    if (!req.file) {
      const error = new Error("No file uploaded or file rejected by validator.");
      error.statusCode = 400;
      throw error;
    }

    // Return accessible fileUrl or relative path
    const normalizedPath = req.file.path.replace(/\\/g, "/");
    const fileUrl = `/uploads/${req.file.filename}`;

    res.status(201).json({
      success: true,
      message: "File uploaded successfully.",
      data: {
        fileUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        storagePath: normalizedPath
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadGenericFile
};
