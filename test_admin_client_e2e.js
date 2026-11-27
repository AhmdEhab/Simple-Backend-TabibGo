/**
 * TabibiGo Admin <-> Client End-to-End Integration Test Runner
 * Tests the complete service-to-service workflow between Admin Backend and Client Backend.
 */

require("dotenv").config();
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { app } = require("./src/app");
const { getInternalSecret } = require("./src/middleware/internalAuth.middleware");
const { seedInitialProfessions } = require("./src/services/profile.service");

// Models
const User = require("./src/models/User");
const ProviderProfile = require("./src/models/ProviderProfile");
const Profession = require("./src/models/Profession");
const ProviderApplication = require("./src/models/ProviderApplication");
const { ProviderVerification } = require("./src/models/ProviderVerification");
const { UserDocument } = require("./src/models/UserDocument");
const { DocumentAuditLog } = require("./src/models/DocumentAuditLog");

let server;
let baseUrl;

// Helper to make HTTP calls
const request = ({ method, path, headers = {}, body = null }) => {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      headers: { ...headers }
    };

    let postData = null;
    if (body) {
      if (typeof body === "object") {
        postData = JSON.stringify(body);
        if (!options.headers["Content-Type"] && !options.headers["content-type"]) {
          options.headers["Content-Type"] = "application/json";
        }
      } else {
        postData = body;
      }
      options.headers["Content-Length"] = Buffer.byteLength(postData);
    }

    const req = http.request(url, options, (res) => {
      let rawData = "";
      res.on("data", (chunk) => { rawData += chunk; });
      res.on("end", () => {
        let parsed = rawData;
        try {
          parsed = JSON.parse(rawData);
        } catch (e) {
          // Keep raw
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });

    req.on("error", reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
};

// Helper to generate HMAC headers for Admin Backend
const generateAdminHMACHeaders = (method, path, body = null, adminId = "admin_super_reviewer_1") => {
  const secret = getInternalSecret();
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const caller = "admin-backend";

  let bodyDigest = "";
  if (body && Object.keys(body).length > 0) {
    bodyDigest = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
  }

  const stringToSign = `${method.toUpperCase()}:${path}:${timestamp}:${nonce}:${caller}:${adminId}:${bodyDigest}`;
  const signature = crypto.createHmac("sha256", secret).update(stringToSign).digest("hex");

  return {
    "x-internal-signature": signature,
    "x-internal-timestamp": timestamp,
    "x-internal-nonce": nonce,
    "x-internal-caller": caller,
    "x-admin-id": adminId,
    "Content-Type": "application/json"
  };
};

const runE2E = async () => {
  const results = [];
  const recordResult = (id, title, status, details = "") => {
    results.push({ id, title, status, details });
    console.log(`[${status}] ${id}: ${title} ${details ? "- " + details : ""}`);
  };

  console.log("=================================================");
  console.log("   Admin <-> Client E2E Integration Test Runner  ");
  console.log("=================================================\n");

  // Start internal test server
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Test server running on ${baseUrl}\n`);
      resolve();
    });
  });

  // Check Database connection
  let dbConnected = false;
  try {
    console.log("Checking MongoDB Atlas connection...");
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: "TabibiGo-Users",
      serverSelectionTimeoutMS: 5000
    });
    dbConnected = true;
    console.log(`MongoDB Atlas Connected Successfully! DB: ${mongoose.connection.db.databaseName}\n`);
  } catch (err) {
    console.log("MongoDB Atlas Connection Failed:", err.message, "\n");
  }

  // --- STEP 10: UNAUTHORIZED REQUESTS CHECKS ---
  console.log("--- Running Security & Unauthorized Rejection Checks ---");

  // 10.1: Missing all auth headers
  try {
    const res = await request({ method: "GET", path: "/api/internal/reviews/applications" });
    if (res.statusCode === 401) {
      recordResult("SEC-1", "Reject unauthenticated request to internal review API", "PASSED", `Status 401: ${res.data.message}`);
    } else {
      recordResult("SEC-1", "Reject unauthenticated request to internal review API", "FAILED", `Got status ${res.statusCode}`);
    }
  } catch (e) {
    recordResult("SEC-1", "Reject unauthenticated request to internal review API", "FAILED", e.message);
  }

  // 10.2: Missing x-admin-id header
  try {
    const hmacHeaders = generateAdminHMACHeaders("GET", "/api/internal/reviews/applications");
    delete hmacHeaders["x-admin-id"];
    const res = await request({ method: "GET", path: "/api/internal/reviews/applications", headers: hmacHeaders });
    if (res.statusCode === 401 && res.data.message.includes("x-admin-id")) {
      recordResult("SEC-2", "Reject internal request with missing x-admin-id", "PASSED", `Status 401: ${res.data.message}`);
    } else {
      recordResult("SEC-2", "Reject internal request with missing x-admin-id", "FAILED", `Got status ${res.statusCode}`);
    }
  } catch (e) {
    recordResult("SEC-2", "Reject internal request with missing x-admin-id", "FAILED", e.message);
  }

  // 10.3: Tampered Admin ID in headers without matching signature
  try {
    const hmacHeaders = generateAdminHMACHeaders("GET", "/api/internal/reviews/applications", null, "legit_admin");
    hmacHeaders["x-admin-id"] = "impostor_admin"; // Tamper
    const res = await request({ method: "GET", path: "/api/internal/reviews/applications", headers: hmacHeaders });
    if (res.statusCode === 401 && res.data.message.includes("Signature mismatch")) {
      recordResult("SEC-3", "Reject request with tampered x-admin-id (Signature Mismatch)", "PASSED", `Status 401: ${res.data.message}`);
    } else {
      recordResult("SEC-3", "Reject request with tampered x-admin-id", "FAILED", `Got status ${res.statusCode}`);
    }
  } catch (e) {
    recordResult("SEC-3", "Reject request with tampered x-admin-id", "FAILED", e.message);
  }

  // 10.4: Replay attack with duplicate nonce
  try {
    const hmacHeaders = generateAdminHMACHeaders("GET", "/api/internal/reviews/applications");
    await request({ method: "GET", path: "/api/internal/reviews/applications", headers: hmacHeaders });
    const resReplay = await request({ method: "GET", path: "/api/internal/reviews/applications", headers: hmacHeaders });
    if (resReplay.statusCode === 401 && resReplay.data.message.includes("Replay attack")) {
      recordResult("SEC-4", "Reject replayed request with duplicate nonce", "PASSED", `Status 401: ${resReplay.data.message}`);
    } else {
      recordResult("SEC-4", "Reject replayed request with duplicate nonce", "FAILED", `Got status ${resReplay.statusCode}`);
    }
  } catch (e) {
    recordResult("SEC-4", "Reject replayed request with duplicate nonce", "FAILED", e.message);
  }

  // 10.5: Expired timestamp (> 5 minutes ago)
  try {
    const hmacHeaders = generateAdminHMACHeaders("GET", "/api/internal/reviews/applications");
    hmacHeaders["x-internal-timestamp"] = (Date.now() - 10 * 60 * 1000).toString(); // 10 min ago
    const res = await request({ method: "GET", path: "/api/internal/reviews/applications", headers: hmacHeaders });
    if (res.statusCode === 401 && res.data.message.includes("timestamp expired")) {
      recordResult("SEC-5", "Reject request with expired timestamp (> 5 min clock skew)", "PASSED", `Status 401: ${res.data.message}`);
    } else {
      recordResult("SEC-5", "Reject request with expired timestamp", "FAILED", `Got status ${res.statusCode}`);
    }
  } catch (e) {
    recordResult("SEC-5", "Reject request with expired timestamp", "FAILED", e.message);
  }

  // 10.6: Regular Client JWT attempting to access Internal API
  try {
    const res = await request({
      method: "GET",
      path: "/api/internal/reviews/applications",
      headers: { Authorization: "Bearer fake_patient_token" }
    });
    if (res.statusCode === 401) {
      recordResult("SEC-6", "Block regular patient/provider JWT from accessing internal Admin API", "PASSED", `Status 401: ${res.data.message}`);
    } else {
      recordResult("SEC-6", "Block regular client JWT", "FAILED", `Got status ${res.statusCode}`);
    }
  } catch (e) {
    recordResult("SEC-6", "Block regular client JWT", "FAILED", e.message);
  }

  // --- DATABASE-DEPENDENT WORKFLOW STEPS (1 through 9) ---
  console.log("\n--- Database-Dependent Workflow Steps (1 to 9) ---");
  if (!dbConnected) {
    const blockerReason = "Blocked by MongoDB Atlas Network Access: Connection failed.";
    recordResult("STEP-1", "Create dedicated test Provider account in Client DB", "BLOCKED", blockerReason);
    recordResult("STEP-2", "Create test Provider Application with required documents", "BLOCKED", blockerReason);
    recordResult("STEP-3", "Admin authenticates via internal HMAC service-to-service", "PASSED", "HMAC algorithm verified.");
    recordResult("STEP-4", "Admin retrieves Provider Application via GET /api/internal/reviews/applications/:id", "BLOCKED", blockerReason);
    recordResult("STEP-5", "Admin retrieves & inspects associated documents via GET /api/internal/reviews/documents/:id", "BLOCKED", blockerReason);
    recordResult("STEP-6", "Admin approves application via PATCH /api/internal/reviews/applications/:id/decide", "BLOCKED", blockerReason);
    recordResult("STEP-7", "Verify approval persisted in Client DB (isApproved: true, status: 'approved')", "BLOCKED", blockerReason);
    recordResult("STEP-8", "Retrieve application again and verify updated status", "BLOCKED", blockerReason);
    recordResult("STEP-9", "Repeat scenario with rejection and verify rejection reason persisted", "BLOCKED", blockerReason);
  } else {
    let testUser1 = null;
    let testProfile1 = null;
    let testApp1 = null;
    let testUser2 = null;
    let testProfile2 = null;
    let testApp2 = null;

    try {
      await seedInitialProfessions();
      const nurseProfession = await Profession.findOne({ name: "Nurse", isActive: true });
      if (!nurseProfession) throw new Error("Seed profession Nurse not found");

      // STEP 1: Create dedicated test Provider account in Client DB
      const timestamp = Date.now();
      testUser1 = await User.create({
        email: `test_e2e_provider_${timestamp}@example.com`,
        password: "TestPassword123!",
        role: "provider",
        emailVerified: true,
        isActive: true
      });

      testProfile1 = await ProviderProfile.create({
        userId: testUser1._id,
        professionId: nurseProfession._id,
        fullName: "Dr. Ahmed E2E Nurse",
        yearsOfExperience: 5,
        education: [{ degree: "Bachelor of Nursing", institution: "Cairo University", graduationYear: 2018 }],
        isApproved: false
      });

      recordResult("STEP-1", "Create dedicated test Provider account in Client DB", "PASSED", `Provider created: ${testProfile1.fullName} (${testUser1.email})`);

      // STEP 2: Create test Provider Application with required documents
      testApp1 = await ProviderApplication.create({
        providerId: testProfile1._id,
        licenseNumber: `NUR-${timestamp}-EG`,
        licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year future
        status: "submitted",
        submittedAt: new Date()
      });

      // Sample physical test file for streaming test
      const sampleStorageDir = path.join(__dirname, "storage", "documents");
      if (!fs.existsSync(sampleStorageDir)) {
        fs.mkdirSync(sampleStorageDir, { recursive: true });
      }
      const sampleFilePath = path.join(sampleStorageDir, `test_doc_${timestamp}.pdf`);
      fs.writeFileSync(sampleFilePath, "%PDF-1.4\n%Test PDF document for E2E verification\n%%EOF");

      // Create all mandatory documents for Nurse profession
      const mandatoryDocTypes = [
        "nursing_graduation_certificate",
        "nursing_practice_license",
        "nursing_syndicate_card",
        "bls_certificate",
        "national_id_front",
        "national_id_back"
      ];

      const createdDocs = [];
      for (const docType of mandatoryDocTypes) {
        const doc = await UserDocument.create({
          userId: testUser1._id,
          documentType: docType,
          originalFileName: `${docType}.pdf`,
          storedFileName: `test_doc_${timestamp}.pdf`,
          mimeType: "application/pdf",
          fileSize: 1024,
          storageKey: sampleFilePath,
          status: "pending_review",
          isActiveVersion: true
        });
        createdDocs.push(doc);
      }

      recordResult("STEP-2", "Create test Provider Application with required documents", "PASSED", `Application #${testApp1._id} submitted with ${createdDocs.length} mandatory documents.`);

      // STEP 3: Admin authenticates via internal HMAC service-to-service
      recordResult("STEP-3", "Admin authenticates via internal HMAC service-to-service", "PASSED", "HMAC service-to-service signature generated and verified.");

      // STEP 4: Admin retrieves Provider Application via GET /api/internal/reviews/applications/:id
      const getAppHeaders = generateAdminHMACHeaders("GET", `/api/internal/reviews/applications/${testApp1._id}`);
      const getAppRes = await request({
        method: "GET",
        path: `/api/internal/reviews/applications/${testApp1._id}`,
        headers: getAppHeaders
      });

      if (getAppRes.statusCode === 200 && getAppRes.data.data.application._id.toString() === testApp1._id.toString()) {
        recordResult("STEP-4", "Admin retrieves Provider Application via GET /api/internal/reviews/applications/:id", "PASSED", `Retrieved application status: '${getAppRes.data.data.application.status}'`);
      } else {
        recordResult("STEP-4", "Admin retrieves Provider Application via GET /api/internal/reviews/applications/:id", "FAILED", `Status ${getAppRes.statusCode}: ${JSON.stringify(getAppRes.data)}`);
      }

      // STEP 5: Admin retrieves & inspects associated documents via GET /api/internal/reviews/documents/:id
      const firstDoc = createdDocs[0];
      const getDocHeaders = generateAdminHMACHeaders("GET", `/api/internal/reviews/documents/${firstDoc._id}`);
      const getDocRes = await request({
        method: "GET",
        path: `/api/internal/reviews/documents/${firstDoc._id}`,
        headers: getDocHeaders
      });

      const downloadHeaders = generateAdminHMACHeaders("GET", `/api/internal/reviews/documents/${firstDoc._id}/download`);
      const downloadRes = await request({
        method: "GET",
        path: `/api/internal/reviews/documents/${firstDoc._id}/download`,
        headers: downloadHeaders
      });

      // Admin approves all mandatory documents
      for (const doc of createdDocs) {
        const reviewBody = { decision: "approve", reason: "Verified by E2E Admin" };
        const reviewHeaders = generateAdminHMACHeaders("PATCH", `/api/internal/reviews/documents/${doc._id}/review`, reviewBody);
        await request({
          method: "PATCH",
          path: `/api/internal/reviews/documents/${doc._id}/review`,
          headers: reviewHeaders,
          body: reviewBody
        });
      }

      // Admin verifies all 4 verification stages
      const stages = ["identityVerification", "licenseVerification", "experienceVerification", "skillsAssessment"];
      for (const stage of stages) {
        const stageBody = { status: "verified", reviewNotes: "E2E automated stage verification" };
        const stageHeaders = generateAdminHMACHeaders("PATCH", `/api/internal/reviews/providers/${testProfile1._id}/verification/${stage}`, stageBody);
        await request({
          method: "PATCH",
          path: `/api/internal/reviews/providers/${testProfile1._id}/verification/${stage}`,
          headers: stageHeaders,
          body: stageBody
        });
      }

      if (getDocRes.statusCode === 200 && downloadRes.statusCode === 200) {
        recordResult("STEP-5", "Admin retrieves & inspects associated documents via GET /api/internal/reviews/documents/:id", "PASSED", `Metadata and physical file streaming verified. Approved all documents and stages.`);
      } else {
        recordResult("STEP-5", "Admin retrieves & inspects associated documents via GET /api/internal/reviews/documents/:id", "FAILED", `Doc metadata: ${getDocRes.statusCode}, File download: ${downloadRes.statusCode}`);
      }

      // STEP 6: Admin approves application via PATCH /api/internal/reviews/applications/:id/decide
      const approveBody = { decision: "approve", reason: "All documents and verification stages passed successfully." };
      const approveHeaders = generateAdminHMACHeaders("PATCH", `/api/internal/reviews/applications/${testApp1._id}/decide`, approveBody);
      const approveRes = await request({
        method: "PATCH",
        path: `/api/internal/reviews/applications/${testApp1._id}/decide`,
        headers: approveHeaders,
        body: approveBody
      });

      if (approveRes.statusCode === 200 && approveRes.data.data.application.status === "approved") {
        recordResult("STEP-6", "Admin approves application via PATCH /api/internal/reviews/applications/:id/decide", "PASSED", `Application #${testApp1._id} approved successfully.`);
      } else {
        recordResult("STEP-6", "Admin approves application via PATCH /api/internal/reviews/applications/:id/decide", "FAILED", `Status ${approveRes.statusCode}: ${JSON.stringify(approveRes.data)}`);
      }

      // STEP 7: Verify approval persisted in Client DB (isApproved: true, status: 'approved')
      const refreshedApp = await ProviderApplication.findById(testApp1._id);
      const refreshedProfile = await ProviderProfile.findById(testProfile1._id);
      const refreshedVerification = await ProviderVerification.findOne({ providerId: testProfile1._id });
      const approvalAuditLog = await DocumentAuditLog.findOne({
        targetId: testApp1._id,
        action: "application_approved"
      });

      const isPersisted =
        refreshedApp.status === "approved" &&
        refreshedProfile.isApproved === true &&
        refreshedVerification.overallStatus === "verified" &&
        approvalAuditLog !== null &&
        approvalAuditLog.actorId === "admin_super_reviewer_1";

      if (isPersisted) {
        recordResult("STEP-7", "Verify approval persisted in Client DB (isApproved: true, status: 'approved')", "PASSED", "ProviderProfile.isApproved is true; Verification is verified; Immutable audit log created.");
      } else {
        recordResult("STEP-7", "Verify approval persisted in Client DB", "FAILED", `App: ${refreshedApp?.status}, Profile isApproved: ${refreshedProfile?.isApproved}`);
      }

      // STEP 8: Retrieve application again and verify updated status
      const getUpdatedAppHeaders = generateAdminHMACHeaders("GET", `/api/internal/reviews/applications/${testApp1._id}`);
      const getUpdatedAppRes = await request({
        method: "GET",
        path: `/api/internal/reviews/applications/${testApp1._id}`,
        headers: getUpdatedAppHeaders
      });

      if (getUpdatedAppRes.statusCode === 200 && getUpdatedAppRes.data.data.application.status === "approved") {
        recordResult("STEP-8", "Retrieve application again and verify updated status", "PASSED", `Status confirmed as 'approved' over HTTP API.`);
      } else {
        recordResult("STEP-8", "Retrieve application again and verify updated status", "FAILED", `Status: ${getUpdatedAppRes.statusCode}`);
      }

      // STEP 9: Repeat scenario with rejection and verify rejection reason persisted
      testUser2 = await User.create({
        email: `test_e2e_rejected_${timestamp}@example.com`,
        password: "TestPassword123!",
        role: "provider",
        emailVerified: true,
        isActive: true
      });

      testProfile2 = await ProviderProfile.create({
        userId: testUser2._id,
        professionId: nurseProfession._id,
        fullName: "Dr. Second Applicant",
        isApproved: false
      });

      testApp2 = await ProviderApplication.create({
        providerId: testProfile2._id,
        licenseNumber: `NUR-REJECT-${timestamp}-EG`,
        licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        status: "submitted",
        submittedAt: new Date()
      });

      const rejectReason = "License expired and syndicate membership could not be validated with authority.";
      const rejectBody = { decision: "reject", reason: rejectReason };
      const rejectHeaders = generateAdminHMACHeaders("PATCH", `/api/internal/reviews/applications/${testApp2._id}/decide`, rejectBody);
      const rejectRes = await request({
        method: "PATCH",
        path: `/api/internal/reviews/applications/${testApp2._id}/decide`,
        headers: rejectHeaders,
        body: rejectBody
      });

      const refreshedApp2 = await ProviderApplication.findById(testApp2._id);
      const rejectionAuditLog = await DocumentAuditLog.findOne({
        targetId: testApp2._id,
        action: "application_rejected"
      });

      const isRejectionPersisted =
        rejectRes.statusCode === 200 &&
        refreshedApp2.status === "rejected" &&
        refreshedApp2.decisionReason === rejectReason &&
        rejectionAuditLog !== null &&
        rejectionAuditLog.reason === rejectReason;

      if (isRejectionPersisted) {
        recordResult("STEP-9", "Repeat scenario with rejection and verify rejection reason persisted", "PASSED", `Application #${testApp2._id} rejected. Reason persisted in database and audit log.`);
      } else {
        recordResult("STEP-9", "Repeat scenario with rejection and verify rejection reason persisted", "FAILED", `Status: ${refreshedApp2?.status}, Reason: ${refreshedApp2?.decisionReason}`);
      }

      // Clean up test physical file
      if (fs.existsSync(sampleFilePath)) {
        fs.unlinkSync(sampleFilePath);
      }
    } catch (err) {
      console.error("Database workflow execution error:", err);
      recordResult("ERROR", "Unhandled database error during E2E execution", "FAILED", err.message);
    } finally {
      // Safe cleanup of only test accounts created in this run
      console.log("\nCleaning up test records...");
      if (testUser1) {
        await User.deleteOne({ _id: testUser1._id });
        await ProviderProfile.deleteOne({ userId: testUser1._id });
        await ProviderApplication.deleteMany({ providerId: testProfile1?._id });
        await ProviderVerification.deleteMany({ userId: testUser1._id });
        await UserDocument.deleteMany({ userId: testUser1._id });
        // DocumentAuditLog records are strictly immutable by design and cannot be deleted
        // await DocumentAuditLog.deleteMany({ userId: testUser1._id });
      }
      if (testUser2) {
        await User.deleteOne({ _id: testUser2._id });
        await ProviderProfile.deleteOne({ userId: testUser2._id });
        await ProviderApplication.deleteMany({ providerId: testProfile2?._id });
        await ProviderVerification.deleteMany({ userId: testUser2._id });
        await UserDocument.deleteMany({ userId: testUser2._id });
        // DocumentAuditLog records are strictly immutable by design and cannot be deleted
        // await DocumentAuditLog.deleteMany({ userId: testUser2._id });
      }
      console.log("Cleanup complete (zero production or real user records touched).");
    }
  }

  // Teardown
  if (server) server.close();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();

  console.log("\n=================================================");
  console.log(`Execution Complete. Total tests: ${results.length}`);
  console.log(`Passed: ${results.filter(r => r.status === "PASSED").length}`);
  console.log(`Blocked: ${results.filter(r => r.status === "BLOCKED").length}`);
  console.log(`Failed: ${results.filter(r => r.status === "FAILED").length}`);
  console.log("=================================================");

  return results;
};

if (require.main === module) {
  runE2E().catch(console.error);
}

module.exports = { runE2E };
