const crypto = require("crypto");

/**
 * Service-to-Service Authentication Middleware:
 * Verifies internal requests from Admin Backend with rigorous security guarantees:
 * 1. Required Nonce (unique per request ID) with TTL expiration cache preventing replay.
 * 2. Timestamp freshness validation (strict +/- 5 minutes window).
 * 3. HMAC-SHA256 signature binding method, path, timestamp, nonce, caller, adminId, and body SHA-256.
 *    -> This prevents admin identity tampering (changing x-admin-id invalidates the signature).
 * 4. Fallback internal API key requires explicit x-admin-id for auditability.
 */

const getInternalSecret = () => {
  return process.env.INTERNAL_SERVICE_SECRET || process.env.ADMIN_SERVICE_SECRET || "default_internal_secret_change_in_production";
};

const getInternalApiKey = () => {
  return process.env.INTERNAL_API_KEY || "default_internal_api_key_change_in_production";
};

// In-memory nonce cache with expiration tracking
// Maps nonce -> expiryTimestampMs
const usedNonceCache = new Map();

// Periodic cleanup of expired nonces (every 60 seconds)
setInterval(() => {
  const now = Date.now();
  for (const [nonce, expiresAt] of usedNonceCache.entries()) {
    if (expiresAt <= now) {
      usedNonceCache.delete(nonce);
    }
  }
}, 60 * 1000).unref(); // unref so it won't hold open test processes

/**
 * Atomic check and store of nonce to prevent concurrent race conditions
 */
const checkAndStoreNonce = (nonce, validUntilMs) => {
  const now = Date.now();
  if (usedNonceCache.has(nonce)) {
    const expiresAt = usedNonceCache.get(nonce);
    if (expiresAt > now) {
      return false; // Replay detected!
    }
  }
  usedNonceCache.set(nonce, validUntilMs);
  return true;
};

const verifyInternalService = (req, res, next) => {
  try {
    const apiKeyHeader = req.headers["x-internal-api-key"];
    const signatureHeader = req.headers["x-internal-signature"];
    const timestampHeader = req.headers["x-internal-timestamp"];
    const nonceHeader = req.headers["x-internal-nonce"];
    const callerHeader = req.headers["x-internal-caller"] || "admin-backend";
    const adminIdHeader = req.headers["x-admin-id"];

    // Ensure admin identity header is present and non-empty
    if (!adminIdHeader || !adminIdHeader.trim()) {
      return res.status(401).json({
        success: false,
        message: "Missing required admin reviewer identity ('x-admin-id' header)."
      });
    }

    // 1. Direct Secret API Key Match (Disabled in production for maximum cryptographic security)
    if (apiKeyHeader) {
      if (process.env.NODE_ENV === "production" && !process.env.ALLOW_INSECURE_INTERNAL_API_KEY) {
        return res.status(403).json({
          success: false,
          message: "Internal API key authentication is disabled in production. HMAC-SHA256 signature with nonce is strictly required."
        });
      }

      if (apiKeyHeader === getInternalApiKey()) {
        req.internalCaller = callerHeader.trim();
        req.adminId = adminIdHeader.trim();
        return next();
      }
    }

    // 2. Production HMAC-SHA256 Signature with Replay & Tamper Protection
    if (signatureHeader && timestampHeader) {
      // Require unique Nonce
      if (!nonceHeader || !nonceHeader.trim()) {
        return res.status(401).json({
          success: false,
          message: "Missing required internal nonce ('x-internal-nonce' header)."
        });
      }

      const requestTimestamp = parseInt(timestampHeader, 10);
      const now = Date.now();
      const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

      // Check timestamp freshness
      if (Number.isNaN(requestTimestamp) || Math.abs(now - requestTimestamp) > WINDOW_MS) {
        return res.status(401).json({
          success: false,
          message: "Internal request timestamp expired or clock skew exceeded."
        });
      }

      // Check and store nonce atomically
      const nonceValidUntil = requestTimestamp + WINDOW_MS;
      const isNonceFresh = checkAndStoreNonce(nonceHeader.trim(), nonceValidUntil);

      if (!isNonceFresh) {
        return res.status(401).json({
          success: false,
          message: "Replay attack detected: Nonce has already been used."
        });
      }

      // Compute request body digest if present
      let bodyDigest = "";
      if (req.body && Object.keys(req.body).length > 0) {
        bodyDigest = crypto.createHash("sha256").update(JSON.stringify(req.body)).digest("hex");
      }

      // Bind all critical context to the signature string:
      // METHOD:PATH:TIMESTAMP:NONCE:CALLER:ADMIN_ID:BODY_DIGEST
      // This guarantees that tampering with x-admin-id or x-internal-caller will invalidate the signature!
      const stringToSign = `${req.method.toUpperCase()}:${req.originalUrl || req.url}:${timestampHeader}:${nonceHeader.trim()}:${callerHeader.trim()}:${adminIdHeader.trim()}:${bodyDigest}`;
      
      const expectedSignature = crypto
        .createHmac("sha256", getInternalSecret())
        .update(stringToSign)
        .digest("hex");

      const signatureBuffer = Buffer.from(signatureHeader.trim(), "utf8");
      const expectedBuffer = Buffer.from(expectedSignature, "utf8");

      if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
        return res.status(401).json({
          success: false,
          message: "Invalid internal service signature. Signature mismatch."
        });
      }

      req.internalCaller = callerHeader.trim();
      req.adminId = adminIdHeader.trim();
      return next();
    }

    return res.status(401).json({
      success: false,
      message: "Unauthorized internal service request: Missing valid internal credentials."
    });
  } catch (error) {
    console.error("Internal Auth Middleware Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal authentication verification failure."
    });
  }
};

module.exports = {
  verifyInternalService,
  getInternalSecret,
  getInternalApiKey,
  usedNonceCache
};
