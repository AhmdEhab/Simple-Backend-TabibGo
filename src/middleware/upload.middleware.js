const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Private secure uploads folder outside public root
const UPLOADS_DIR = path.resolve(process.env.STORAGE_PATH || path.join(__dirname, "../../storage/documents"));

// Ensure storage directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Allowed MIME types and extensions
const ALLOWED_MIME_EXT_MAP = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"]
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Organize by user directory securely
    const userDir = path.join(UPLOADS_DIR, req.user ? req.user._id.toString() : "temp");
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    // Generate secure random filename with validated extension
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(16).toString("hex")}${ext}`;
    cb(null, uniqueSuffix);
  }
});

// File filter checking extension & reported MIME type
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ALLOWED_MIME_EXT_MAP[file.mimetype];

  if (!allowedExts || !allowedExts.includes(ext)) {
    const error = new Error(`File type ${ext} or MIME ${file.mimetype} is not allowed. Allowed types: jpg, jpeg, png, webp, pdf.`);
    error.statusCode = 400;
    return cb(error, false);
  }

  cb(null, true);
};

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE
  },
  fileFilter
});

/**
 * Validate Magic Numbers / File Signatures for uploaded buffer
 */
const validateFileBufferSignature = (buffer, mimeType) => {
  if (!buffer || buffer.length < 4) return false;

  // JPEG: FF D8 FF
  if (mimeType === "image/jpeg") {
    return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  }
  // PNG: 89 50 4E 47
  if (mimeType === "image/png") {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  }
  // PDF: %PDF (25 50 44 46)
  if (mimeType === "application/pdf") {
    return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  }
  // WEBP: RIFF....WEBP
  if (mimeType === "image/webp") {
    if (buffer.length < 12) return false;
    const riff = buffer.slice(0, 4).toString("ascii") === "RIFF";
    const webp = buffer.slice(8, 12).toString("ascii") === "WEBP";
    return riff && webp;
  }

  return true;
};

/**
 * Middleware wrapper for single file upload with signature check and error handling
 */
const handleDocumentUpload = (req, res, next) => {
  const uploadSingle = upload.single("file");

  uploadSingle(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            message: `File exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)}MB.`
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message
        });
      }
      return res.status(err.statusCode || 400).json({
        success: false,
        message: err.message
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file was uploaded."
      });
    }

    // Verify magic number/signature by reading the first 16 bytes
    try {
      const fd = fs.openSync(req.file.path, "r");
      const buffer = Buffer.alloc(16);
      fs.readSync(fd, buffer, 0, 16, 0);
      fs.closeSync(fd);

      const isValidSignature = validateFileBufferSignature(buffer, req.file.mimetype);
      if (!isValidSignature) {
        // Remove corrupted or spoofed file immediately
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({
          success: false,
          message: "File signature mismatch. The file content does not match its extension/MIME type."
        });
      }
    } catch (readErr) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(500).json({
        success: false,
        message: "Failed to verify file integrity."
      });
    }

    next();
  });
};

module.exports = {
  handleDocumentUpload,
  UPLOADS_DIR,
  MAX_FILE_SIZE,
  ALLOWED_MIME_EXT_MAP
};
