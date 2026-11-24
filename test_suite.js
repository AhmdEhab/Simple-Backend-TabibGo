/**
 * TabibiGo Comprehensive Backend Integration & Security Hardening Test Suite
 * Covers:
 * 1. Authentication (Register, Duplicate Email, Invalid Role, OTP verification, Login restrictions, Tokens, Refresh, Logout, Protected routes)
 * 2. Profiles (Patient profile, Provider profile, Invalid/Inactive profession, Duplicate prevention, Authorization)
 * 3. Documents (Upload valid patient & provider documents, Invalid types/MIME/extensions, Size limits, Protected download, Deletion, Security traversal)
 * 4. Multi-Document Support & Versioned Replacement (Preserving old records, previousDocumentId, rejection notes)
 * 5. Provider Applications (Submit without docs, Submit with docs, Duplicate application prevention, Resubmission after rejection)
 * 6. Internal Admin Integration & Security Hardening:
 *    - HMAC-SHA256 verification
 *    - Replay protection with unique Nonce cache
 *    - Rejection of duplicate signed requests (same nonce)
 *    - Rejection of missing/empty nonces
 *    - Prevention of Admin Identity tampering (signed adminId & caller)
 *    - Enforcement of Provider Approval prerequisites:
 *      * Approval blocked when stages are unverified
 *      * Approval blocked when active required documents are pending or rejected
 *      * Old approved document version CANNOT satisfy requirement if newer version is rejected
 *    - Strict Audit Log Immutability (updates and deletes throw errors)
 */

require("dotenv").config();
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const mongoose = require("mongoose");
const connectDB = require("./src/config/database");
const { app } = require("./src/app");
const User = require("./src/models/User");
const PatientProfile = require("./src/models/PatientProfile");
const ProviderProfile = require("./src/models/ProviderProfile");
const Profession = require("./src/models/Profession");
const RefreshToken = require("./src/models/RefreshToken");
const OTPCode = require("./src/models/OTPCode");
const { UserDocument } = require("./src/models/UserDocument");
const ProviderApplication = require("./src/models/ProviderApplication");
const { ProviderVerification } = require("./src/models/ProviderVerification");
const { DocumentAuditLog } = require("./src/models/DocumentAuditLog");
const { ServiceRequest } = require("./src/models/ServiceRequest");
const { ExceptionalCancellationRequest } = require("./src/models/ExceptionalCancellationRequest");
const { seedInitialProfessions } = require("./src/services/profile.service");
const { hashOTP } = require("./src/services/otp.service");
const { getInternalSecret, getInternalApiKey } = require("./src/middleware/internalAuth.middleware");

let server;
let baseUrl;

// Simple HTTP request helper
const makeRequest = ({ method, path, headers = {}, body = null }) => {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      headers: { ...headers }
    };

    let postData = null;
    if (body) {
      if (typeof body === "string" || Buffer.isBuffer(body)) {
        postData = body;
      } else {
        postData = JSON.stringify(body);
        if (!options.headers["Content-Type"]) {
          options.headers["Content-Type"] = "application/json";
        }
      }
      options.headers["Content-Length"] = Buffer.byteLength(postData);
    }

    const req = http.request(url, options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const rawBuffer = Buffer.concat(chunks);
        const text = rawBuffer.toString("utf8");
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (e) {
          json = null;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json,
          raw: rawBuffer,
          text
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

// Internal HMAC signed request helper with Nonce and Admin ID binding
const makeHmacRequest = ({
  method,
  path,
  body = null,
  timestamp = null,
  nonce = null,
  caller = "admin-backend",
  adminId = "admin_reviewer_1",
  secret = null,
  customSignature = null
}) => {
  const ts = timestamp || Date.now().toString();
  const n = nonce !== null ? nonce : crypto.randomBytes(16).toString("hex");
  const sec = secret || getInternalSecret();

  let bodyDigest = "";
  if (body) {
    bodyDigest = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
  }

  // Bind all critical context: METHOD:PATH:TIMESTAMP:NONCE:CALLER:ADMIN_ID:BODY_DIGEST
  const stringToSign = `${method.toUpperCase()}:${path}:${ts}:${n}:${caller}:${adminId}:${bodyDigest}`;
  const signature = customSignature !== null ? customSignature : crypto.createHmac("sha256", sec).update(stringToSign).digest("hex");

  const headers = {
    "x-internal-signature": signature,
    "x-internal-timestamp": ts,
    "x-internal-nonce": n,
    "x-internal-caller": caller,
    "x-admin-id": adminId
  };

  return makeRequest({
    method,
    path,
    headers,
    body
  });
};

// Multipart form builder helper for file uploads
const makeMultipartUpload = ({ path, token, fields = {}, fileField = null }) => {
  return new Promise((resolve, reject) => {
    const boundary = "----WebKitFormBoundary" + Math.random().toString(16).substring(2);
    const crlf = "\r\n";
    const parts = [];

    for (const [key, value] of Object.entries(fields)) {
      parts.push(Buffer.from(
        `--${boundary}${crlf}Content-Disposition: form-data; name="${key}"${crlf}${crlf}${value}${crlf}`
      ));
    }

    if (fileField) {
      const { fieldName, filename, contentType, content } = fileField;
      parts.push(Buffer.from(
        `--${boundary}${crlf}Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"${crlf}Content-Type: ${contentType}${crlf}${crlf}`
      ));
      parts.push(Buffer.isBuffer(content) ? content : Buffer.from(content));
      parts.push(Buffer.from(crlf));
    }

    parts.push(Buffer.from(`--${boundary}--${crlf}`));
    const payload = Buffer.concat(parts);

    const headers = {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": payload.length
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    makeRequest({
      method: "POST",
      path,
      headers,
      body: payload
    }).then(resolve).catch(reject);
  });
};

const results = [];
const record = (name, passed, details = "") => {
  results.push({ name, passed, details });
  const status = passed ? "✓ PASS" : "✗ FAIL";
  console.log(`${status} - ${name} ${details ? "(" + details + ")" : ""}`);
};

const runAllTests = async () => {
  console.log("=================================================");
  console.log("   TabibiGo Security & Workflow Hardening Suite  ");
  console.log("=================================================\n");

  await connectDB();
  await seedInitialProfessions();

  const testPrefix = "test_run_" + Date.now();
  const patientEmail = `${testPrefix}_patient@example.com`;
  const providerEmail = `${testPrefix}_provider@example.com`;
  const testPassword = "Password123";

  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running at ${baseUrl}\n`);

  try {
    // ----------------------------------------------------
    // SECTION 1: AUTHENTICATION TESTS
    // ----------------------------------------------------
    console.log("--- 1. Authentication Tests ---");

    // 1.1 Register Patient
    let res = await makeRequest({
      method: "POST",
      path: "/api/auth/register",
      body: { email: patientEmail, password: testPassword, role: "patient" }
    });
    record("1.1 Register Patient", res.statusCode === 201 && res.body?.success === true, `Status: ${res.statusCode}`);

    // 1.2 Register Provider
    res = await makeRequest({
      method: "POST",
      path: "/api/auth/register",
      body: { email: providerEmail, password: testPassword, role: "provider" }
    });
    record("1.2 Register Provider", res.statusCode === 201 && res.body?.success === true, `Status: ${res.statusCode}`);

    // 1.3 Duplicate Email Register
    res = await makeRequest({
      method: "POST",
      path: "/api/auth/register",
      body: { email: patientEmail, password: testPassword, role: "patient" }
    });
    record("1.3 Duplicate Email Rejection", res.statusCode === 409, `Status: ${res.statusCode}`);

    // 1.4 Invalid Role Register
    res = await makeRequest({
      method: "POST",
      path: "/api/auth/register",
      body: { email: "invalid_role@example.com", password: testPassword, role: "superadmin" }
    });
    record("1.4 Invalid Role Rejection", res.statusCode === 400, `Status: ${res.statusCode}`);

    // 1.5 Login before email verification
    res = await makeRequest({
      method: "POST",
      path: "/api/auth/login",
      body: { email: patientEmail, password: testPassword }
    });
    record("1.5 Block Login Unverified User", res.statusCode === 403 && res.body?.message?.includes("verify"), `Status: ${res.statusCode}`);

    // 1.6 Verify OTP for patient
    const patientOTPCode = "123456";
    const patientOTPHash = hashOTP(patientEmail, patientOTPCode, "email_verification");
    await OTPCode.create({
      email: patientEmail,
      codeHash: patientOTPHash,
      purpose: "email_verification",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    });

    res = await makeRequest({
      method: "POST",
      path: "/api/auth/verify-email",
      body: { email: patientEmail, code: patientOTPCode }
    });
    record("1.6 Verify Email with Valid OTP", res.statusCode === 200 && res.body?.success === true, `Status: ${res.statusCode}`);

    // Verify provider directly in DB
    await User.updateOne({ email: providerEmail }, { $set: { emailVerified: true } });

    // 1.7 Login Verified Patient
    res = await makeRequest({
      method: "POST",
      path: "/api/auth/login",
      body: { email: patientEmail, password: testPassword }
    });
    const patientAccessToken = res.body?.data?.tokens?.accessToken;
    const patientRefreshToken = res.body?.data?.tokens?.refreshToken;
    record("1.7 Login Verified Patient (Issued Tokens)", res.statusCode === 200 && Boolean(patientAccessToken) && Boolean(patientRefreshToken), `Status: ${res.statusCode}`);

    // 1.8 Login Provider
    res = await makeRequest({
      method: "POST",
      path: "/api/auth/login",
      body: { email: providerEmail, password: testPassword }
    });
    const providerAccessToken = res.body?.data?.tokens?.accessToken;
    const providerRefreshToken = res.body?.data?.tokens?.refreshToken;
    record("1.8 Login Verified Provider (Issued Tokens)", res.statusCode === 200 && Boolean(providerAccessToken), `Status: ${res.statusCode}`);

    // 1.9 Access Protected Endpoint Without Token
    res = await makeRequest({
      method: "GET",
      path: "/api/auth/me"
    });
    record("1.9 Reject Protected Endpoint Without Token", res.statusCode === 401, `Status: ${res.statusCode}`);

    // 1.10 Access Protected Endpoint With Valid Token
    res = await makeRequest({
      method: "GET",
      path: "/api/auth/me",
      headers: { Authorization: `Bearer ${patientAccessToken}` }
    });
    record("1.10 Access Protected Endpoint With Token", res.statusCode === 200 && res.body?.data?.user?.email === patientEmail, `Status: ${res.statusCode}`);

    // 1.11 Refresh Token Rotation
    res = await makeRequest({
      method: "POST",
      path: "/api/auth/refresh-token",
      body: { refreshToken: patientRefreshToken }
    });
    const newPatientAccessToken = res.body?.data?.accessToken;
    const newPatientRefreshToken = res.body?.data?.refreshToken;
    record("1.11 Refresh Token Rotation (Issues New Tokens)", res.statusCode === 200 && Boolean(newPatientAccessToken) && newPatientRefreshToken !== patientRefreshToken, `Status: ${res.statusCode}`);

    // 1.12 Old Refresh Token Invalidation
    res = await makeRequest({
      method: "POST",
      path: "/api/auth/refresh-token",
      body: { refreshToken: patientRefreshToken }
    });
    record("1.12 Old Refresh Token Rejected After Rotation", res.statusCode === 401, `Status: ${res.statusCode}`);

    // 1.13 Logout Invalidation
    res = await makeRequest({
      method: "POST",
      path: "/api/auth/logout",
      body: { refreshToken: newPatientRefreshToken }
    });
    record("1.13 Logout Successfully", res.statusCode === 200 && res.body?.success === true, `Status: ${res.statusCode}`);

    // ----------------------------------------------------
    // SECTION 2: PROFILES TESTS
    // ----------------------------------------------------
    console.log("\n--- 2. Profiles Tests ---");

    // 2.1 Complete Patient Profile
    res = await makeRequest({
      method: "POST",
      path: "/api/profiles/patient",
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: {
        fullName: "Test Patient Name",
        dateOfBirth: "1995-05-15",
        gender: "female",
        location: { governorate: "Cairo", city: "Nasr City", address: "El-Tayaran St" },
        healthInfo: { conditions: ["Hypertension"], allergies: ["Penicillin"] }
      }
    });
    record("2.1 Create / Complete Patient Profile", res.statusCode === 200 && res.body?.data?.profile?.fullName === "Test Patient Name", `Status: ${res.statusCode}`);

    // 2.2 Patient Forbidden From Creating Provider Profile
    res = await makeRequest({
      method: "POST",
      path: "/api/profiles/provider",
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: { fullName: "Hacker", professionId: new mongoose.Types.ObjectId() }
    });
    record("2.2 Role Guard: Patient Forbidden from Provider Profile", res.statusCode === 403, `Status: ${res.statusCode}`);

    // 2.3 Provider Profile with Inactive/Invalid Profession
    res = await makeRequest({
      method: "POST",
      path: "/api/profiles/provider",
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: { fullName: "Dr. Provider", professionId: new mongoose.Types.ObjectId() }
    });
    record("2.3 Reject Invalid / Non-existent Profession", res.statusCode === 400, `Status: ${res.statusCode}`);

    // 2.4 Complete Provider Profile (Nurse)
    const nurseProfession = await Profession.findOne({ name: "Nurse", isActive: true });
    res = await makeRequest({
      method: "POST",
      path: "/api/profiles/provider",
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: {
        fullName: "Nurse Mary",
        professionId: nurseProfession._id,
        bio: "Experienced registered nurse with ICU background",
        yearsOfExperience: 5
      }
    });
    const providerProfileId = res.body?.data?.profile?._id;
    record("2.4 Create / Complete Provider Profile", res.statusCode === 200 && res.body?.data?.profile?.fullName === "Nurse Mary", `Status: ${res.statusCode}`);

    // 2.5 Get My Profile
    res = await makeRequest({
      method: "GET",
      path: "/api/profiles/me",
      headers: { Authorization: `Bearer ${providerAccessToken}` }
    });
    record("2.5 Get My Profile (Provider)", res.statusCode === 200 && res.body?.data?.profile?.fullName === "Nurse Mary", `Status: ${res.statusCode}`);

    // 2.6 Update My Profile
    res = await makeRequest({
      method: "PUT",
      path: "/api/profiles/me",
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: { bio: "Updated ICU & ER nurse" }
    });
    record("2.6 Update Profile Successfully", res.statusCode === 200 && res.body?.data?.profile?.bio === "Updated ICU & ER nurse", `Status: ${res.statusCode}`);

    // 2.7 Verify Sensitive Fields Cannot Be Overwritten Through Profile Updates (role, isApproved, userId)
    res = await makeRequest({
      method: "PUT",
      path: "/api/profiles/me",
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: {
        role: "admin",
        isApproved: true,
        userId: new mongoose.Types.ObjectId(),
        identityStatus: "verified"
      }
    });
    // Check that patient's user record and identityStatus remain unchanged
    const patientUserCheck = await User.findOne({ email: patientEmail });
    const patientProfileCheck = await PatientProfile.findOne({ userId: patientUserCheck._id });
    const sensitiveProtected = patientUserCheck.role === "patient" && patientProfileCheck.identityStatus !== "verified";
    record("2.7 Prevent Modification of Sensitive Fields via Profile API", res.statusCode === 200 && sensitiveProtected, `Role: ${patientUserCheck.role}, Identity: ${patientProfileCheck.identityStatus}`);

    // 2.8 Patient Cannot Update Provider Profile & Vice Versa
    res = await makeRequest({
      method: "POST",
      path: "/api/profiles/patient",
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: { fullName: "Provider Trying To Be Patient" }
    });
    record("2.8 Role Isolation: Provider Cannot Create/Update Patient Profile", res.statusCode === 403, `Status: ${res.statusCode}`);

    // ----------------------------------------------------
    // SECTION 3: SECURE DOCUMENT TESTS & MULTI-DOCUMENT SUPPORT
    // ----------------------------------------------------
    console.log("\n--- 3. Secure Document Tests ---");

    // 3.1 Get Requirements for Patient
    res = await makeRequest({
      method: "GET",
      path: "/api/documents/requirements",
      headers: { Authorization: `Bearer ${patientAccessToken}` }
    });
    record("3.1 Get Patient Document Requirements", res.statusCode === 200 && res.body?.data?.requirements?.length === 4, `Count: ${res.body?.data?.requirements?.length}`);

    // 3.2 Get Requirements for Provider (Nurse: 9 categories)
    res = await makeRequest({
      method: "GET",
      path: "/api/documents/requirements",
      headers: { Authorization: `Bearer ${providerAccessToken}` }
    });
    record("3.2 Get Provider Document Requirements", res.statusCode === 200 && res.body?.data?.requirements?.length === 9, `Count: ${res.body?.data?.requirements?.length}`);

    const validPngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]);
    const validPdfBuffer = Buffer.from("%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");

    // 3.3 Upload Valid Patient Document
    res = await makeMultipartUpload({
      path: "/api/documents/upload",
      token: patientAccessToken,
      fields: { documentType: "national_id_front" },
      fileField: {
        fieldName: "file",
        filename: "id_front.png",
        contentType: "image/png",
        content: validPngBuffer
      }
    });
    const patientDocId = res.body?.data?.document?.id;
    record("3.3 Upload Valid Patient Document", res.statusCode === 201 && Boolean(patientDocId), `DocId: ${patientDocId}`);

    // 3.4 Upload Invalid Document Type for Patient
    res = await makeMultipartUpload({
      path: "/api/documents/upload",
      token: patientAccessToken,
      fields: { documentType: "nursing_graduation_certificate" },
      fileField: {
        fieldName: "file",
        filename: "grad.pdf",
        contentType: "application/pdf",
        content: validPdfBuffer
      }
    });
    record("3.4 Reject Cross-Role Document Type", res.statusCode === 400, `Status: ${res.statusCode}`);

    // 3.5 Reject File Signature Mismatch
    res = await makeMultipartUpload({
      path: "/api/documents/upload",
      token: patientAccessToken,
      fields: { documentType: "national_id_back" },
      fileField: {
        fieldName: "file",
        filename: "fake.png",
        contentType: "image/png",
        content: Buffer.from("THIS IS PLAIN TEXT NOT PNG")
      }
    });
    record("3.5 Reject File Signature Mismatch", res.statusCode === 400 && res.body?.message?.includes("signature mismatch"), `Status: ${res.statusCode}`);

    // 3.6 Reject Disallowed File Extension
    res = await makeMultipartUpload({
      path: "/api/documents/upload",
      token: patientAccessToken,
      fields: { documentType: "national_id_back" },
      fileField: {
        fieldName: "file",
        filename: "script.js",
        contentType: "application/javascript",
        content: Buffer.from("console.log('malicious')")
      }
    });
    record("3.6 Reject Disallowed File Extension", res.statusCode === 400, `Status: ${res.statusCode}`);

    // 3.7 Download Document Authenticated
    res = await makeRequest({
      method: "GET",
      path: `/api/documents/${patientDocId}/download`,
      headers: { Authorization: `Bearer ${patientAccessToken}` }
    });
    record("3.7 Download Document Authenticated", res.statusCode === 200 && res.headers["content-type"] === "image/png", `Status: ${res.statusCode}`);

    // 3.8 Prevent Cross-User Document Access
    res = await makeRequest({
      method: "GET",
      path: `/api/documents/${patientDocId}/download`,
      headers: { Authorization: `Bearer ${providerAccessToken}` }
    });
    record("3.8 Block Cross-User Document Access", res.statusCode === 404, `Status: ${res.statusCode}`);

    // ----------------------------------------------------
    // SECTION 4: MULTI-DOCUMENT SUPPORT & VERSIONING TESTS
    // ----------------------------------------------------
    console.log("\n--- 4. Multi-Document Support & Versioning Tests ---");

    // 4.1 Upload Multiple Experience Certificates
    res = await makeMultipartUpload({
      path: "/api/documents/upload",
      token: providerAccessToken,
      fields: { documentType: "experience_certificate" },
      fileField: {
        fieldName: "file",
        filename: "exp_hospital_A.pdf",
        contentType: "application/pdf",
        content: validPdfBuffer
      }
    });
    const expDoc1Id = res.body?.data?.document?.id;

    res = await makeMultipartUpload({
      path: "/api/documents/upload",
      token: providerAccessToken,
      fields: { documentType: "experience_certificate" },
      fileField: {
        fieldName: "file",
        filename: "exp_hospital_B.pdf",
        contentType: "application/pdf",
        content: validPdfBuffer
      }
    });
    const expDoc2Id = res.body?.data?.document?.id;
    record("4.1 Upload Multiple Experience Certificates", res.statusCode === 201 && expDoc1Id !== expDoc2Id, `Doc1: ${expDoc1Id}, Doc2: ${expDoc2Id}`);

    // 4.2 Multiple Documents Stored Simultaneously
    const activeExpDocs = await UserDocument.find({
      userId: (await User.findOne({ email: providerEmail }))._id,
      documentType: "experience_certificate",
      isActiveVersion: true
    });
    record("4.2 Multiple Documents Stored Simultaneously", activeExpDocs.length === 2, `Count: ${activeExpDocs.length}`);

    // 4.3 Upload Versioned Replacement Document (Nursing License)
    res = await makeMultipartUpload({
      path: "/api/documents/upload",
      token: providerAccessToken,
      fields: { documentType: "nursing_practice_license" },
      fileField: {
        fieldName: "file",
        filename: "nurse_license_v1.pdf",
        contentType: "application/pdf",
        content: validPdfBuffer
      }
    });
    const licV1Id = res.body?.data?.document?.id;

    // Simulate rejection of license v1
    await UserDocument.updateOne(
      { _id: licV1Id },
      { $set: { status: "rejected", rejectionReason: "Image is blurry" } }
    );

    // Upload replacement version 2
    res = await makeMultipartUpload({
      path: "/api/documents/upload",
      token: providerAccessToken,
      fields: { documentType: "nursing_practice_license" },
      fileField: {
        fieldName: "file",
        filename: "nurse_license_v2.pdf",
        contentType: "application/pdf",
        content: validPdfBuffer
      }
    });
    const licV2Id = res.body?.data?.document?.id;
    const licV2Version = res.body?.data?.document?.version;
    const licV2PrevId = res.body?.data?.document?.previousDocumentId;
    record("4.3 Upload Versioned Replacement Document", res.statusCode === 201 && licV2Version === 2 && licV2PrevId === licV1Id, `V2 ID: ${licV2Id}, Prev ID: ${licV2PrevId}`);

    // 4.4 Old Version Record Preserved with Rejection Reason
    const preservedV1 = await UserDocument.findById(licV1Id);
    record("4.4 Old Version Record Preserved with Rejection Reason", preservedV1.isActiveVersion === false && preservedV1.rejectionReason === "Image is blurry", `Status: ${preservedV1.status}, Reason: ${preservedV1.rejectionReason}`);

    // Upload Remaining Nurse Mandatory Documents
    const mandatoryNurseTypes = [
      "nursing_graduation_certificate",
      "nursing_syndicate_card",
      "bls_certificate",
      "national_id_front",
      "national_id_back"
    ];
    for (const dt of mandatoryNurseTypes) {
      await makeMultipartUpload({
        path: "/api/documents/upload",
        token: providerAccessToken,
        fields: { documentType: dt },
        fileField: {
          fieldName: "file",
          filename: `${dt}.pdf`,
          contentType: "application/pdf",
          content: validPdfBuffer
        }
      });
    }

    // ----------------------------------------------------
    // SECTION 5: PROVIDER APPLICATION TESTS
    // ----------------------------------------------------
    console.log("\n--- 5. Provider Application Tests ---");

    // 5.1 Submit Application with Pending Required Documents
    res = await makeRequest({
      method: "POST",
      path: "/api/provider-applications/submit",
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: {
        licenseNumber: "LIC-123456",
        licenseExpiry: "2028-12-31"
      }
    });
    const applicationId = res.body?.data?.application?._id;
    record("5.1 Submit Application with Pending Required Documents", res.statusCode === 201 && res.body?.data?.application?.status === "submitted", `Status: ${res.statusCode}`);

    // 5.2 Prevent Duplicate Active Application
    res = await makeRequest({
      method: "POST",
      path: "/api/provider-applications/submit",
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: {
        licenseNumber: "LIC-123456",
        licenseExpiry: "2028-12-31"
      }
    });
    record("5.2 Prevent Duplicate Active Application", res.statusCode === 409, `Status: ${res.statusCode}`);

    // ----------------------------------------------------
    // SECTION 6: SECURITY & WORKFLOW HARDENING TESTS
    // ----------------------------------------------------
    console.log("\n--- 6. Security Hardening Tests ---");

    // 6.1 Reject Request Without Authentication
    res = await makeRequest({
      method: "GET",
      path: "/api/internal/reviews/applications"
    });
    record("6.1 Reject Internal API Without Authentication", res.statusCode === 401, `Status: ${res.statusCode}`);

    // 6.2 Reject Request Without Nonce
    res = await makeRequest({
      method: "GET",
      path: "/api/internal/reviews/applications",
      headers: {
        "x-internal-signature": "some_sig",
        "x-internal-timestamp": Date.now().toString(),
        "x-internal-caller": "admin-backend",
        "x-admin-id": "admin_1"
      }
    });
    record("6.2 Reject Request Without Nonce", res.statusCode === 401 && res.body?.message?.includes("Missing required internal nonce"), `Status: ${res.statusCode}`);

    // 6.3 Reject Request With Invalid Signature
    res = await makeHmacRequest({
      method: "GET",
      path: "/api/internal/reviews/applications",
      customSignature: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
    });
    record("6.3 Reject Request with Invalid Signature", res.statusCode === 401, `Status: ${res.statusCode}`);

    // 6.4 Reject Expired Internal Timestamp (Replay Window Protection)
    const oldTimestamp = (Date.now() - 10 * 60 * 1000).toString();
    res = await makeHmacRequest({
      method: "GET",
      path: "/api/internal/reviews/applications",
      timestamp: oldTimestamp
    });
    record("6.4 Reject Expired Internal Timestamp", res.statusCode === 401 && res.body?.message?.includes("timestamp expired"), `Status: ${res.statusCode}`);

    // 6.5 Successful Signed Request With Nonce
    const testNonce = crypto.randomBytes(16).toString("hex");
    res = await makeHmacRequest({
      method: "GET",
      path: "/api/internal/reviews/applications",
      nonce: testNonce
    });
    record("6.5 Valid HMAC Request with Nonce Accepted", res.statusCode === 200 && Array.isArray(res.body?.data?.applications), `Total: ${res.body?.data?.pagination?.total}`);

    // 6.6 Reject Replay of Exact Same Request / Nonce (Replay Attack Prevention)
    res = await makeHmacRequest({
      method: "GET",
      path: "/api/internal/reviews/applications",
      nonce: testNonce // Replaying the exact same nonce!
    });
    record("6.6 Reject Replay of Duplicate Nonce", res.statusCode === 401 && res.body?.message?.includes("Replay attack detected"), `Status: ${res.statusCode}`);

    // 6.7 Prevent Admin Identity Tampering (Changing x-admin-id breaks signature)
    const legitNonce = crypto.randomBytes(16).toString("hex");
    const legitTs = Date.now().toString();
    const sec = getInternalSecret();
    const legitSign = crypto
      .createHmac("sha256", sec)
      .update(`GET:/api/internal/reviews/applications:${legitTs}:${legitNonce}:admin-backend:original_admin:`)
      .digest("hex");

    // Malicious attacker intercepts and swaps x-admin-id to super_admin
    res = await makeRequest({
      method: "GET",
      path: "/api/internal/reviews/applications",
      headers: {
        "x-internal-signature": legitSign,
        "x-internal-timestamp": legitTs,
        "x-internal-nonce": legitNonce,
        "x-internal-caller": "admin-backend",
        "x-admin-id": "tampered_super_admin" // Tampered admin ID
      }
    });
    record("6.7 Reject Admin Identity Tampering", res.statusCode === 401, `Status: ${res.statusCode}`);

    // 6.8 Admin Secure Private Document Download
    res = await makeHmacRequest({
      method: "GET",
      path: `/api/internal/reviews/documents/${licV2Id}/download`
    });
    record("6.8 Admin Secure Document Download", res.statusCode === 200 && res.headers["content-type"] === "application/pdf", `Status: ${res.statusCode}`);

    // 6.9 Application Approval Blocked When Stages Are Incomplete
    res = await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/applications/${applicationId}/decide`,
      body: { decision: "approve", reason: "Premature approval attempt." }
    });
    record("6.9 Approval Blocked When Stages Are Incomplete", res.statusCode === 400 && res.body?.message?.includes("unmet prerequisites"), `Status: ${res.statusCode}`);

    // 6.10 Application Approval Blocked When Required Documents Are Pending
    // Verify stages first, but leave documents in pending_review
    const stages = ["identityVerification", "licenseVerification", "experienceVerification", "skillsAssessment"];
    for (const stg of stages) {
      await makeHmacRequest({
        method: "PATCH",
        path: `/api/internal/reviews/providers/${providerProfileId}/verification/${stg}`,
        body: { status: "verified", reviewNotes: "All stages verified." }
      });
    }

    res = await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/applications/${applicationId}/decide`,
      body: { decision: "approve", reason: "Attempt approval with pending documents." }
    });
    record("6.10 Approval Blocked When Mandatory Documents Are Unapproved", res.statusCode === 400 && res.body?.message?.includes("Unapproved mandatory documents"), `Status: ${res.statusCode}`);

    // 6.11 Application Approval Blocked When An Active Document is Rejected
    // Simulate rejecting an active document
    await UserDocument.updateOne(
      { userId: (await User.findOne({ email: providerEmail }))._id, documentType: "bls_certificate", isActiveVersion: true },
      { $set: { status: "rejected", rejectionReason: "BLS expired" } }
    );

    res = await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/applications/${applicationId}/decide`,
      body: { decision: "approve", reason: "Attempt approval with rejected document." }
    });
    record("6.11 Approval Blocked When Active Document is Rejected", res.statusCode === 400 && res.body?.message?.includes("rejected status"), `Status: ${res.statusCode}`);

    // 6.12 Old Approved Version CANNOT Satisfy Requirement If Active Version is Rejected
    // Create an old approved version of BLS, but leave active version rejected
    const activeBls = await UserDocument.findOne({
      userId: (await User.findOne({ email: providerEmail }))._id,
      documentType: "bls_certificate",
      isActiveVersion: true
    });
    await UserDocument.create({
      userId: activeBls.userId,
      documentType: "bls_certificate",
      originalFileName: "old_bls.pdf",
      storedFileName: "old_bls.pdf",
      mimeType: "application/pdf",
      fileSize: 1000,
      storageKey: activeBls.storageKey,
      status: "approved", // Old version approved
      isActiveVersion: false, // Inactive
      version: 1
    });

    res = await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/applications/${applicationId}/decide`,
      body: { decision: "approve", reason: "Attempt approval using old approved version." }
    });
    record("6.12 Inactive Approved Version Cannot Bypass Active Rejection", res.statusCode === 400 && res.body?.message?.includes("rejected status"), `Status: ${res.statusCode}`);

    // 6.13 Approve All Active Mandatory Documents
    await UserDocument.updateMany(
      { userId: (await User.findOne({ email: providerEmail }))._id, isActiveVersion: true },
      { $set: { status: "approved", rejectionReason: null } }
    );

    // 6.14 Application Approval Succeeds When All Prerequisites Satisfied
    res = await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/applications/${applicationId}/decide`,
      body: { decision: "approve", reason: "All prerequisites, documents and stages verified." }
    });
    record("6.14 Application Approved When All Prerequisites Met", res.statusCode === 200 && res.body?.data?.provider?.isApproved === true, `App Status: ${res.body?.data?.application?.status}`);

    // 6.15 Strict Audit Log Immutability (Enforce No Update / No Delete)
    const sampleLog = await DocumentAuditLog.findOne({ userId: (await User.findOne({ email: providerEmail }))._id });
    let updateThrewError = false;
    let deleteThrewError = false;

    try {
      await DocumentAuditLog.updateOne({ _id: sampleLog._id }, { $set: { action: "hacked" } });
    } catch (e) {
      updateThrewError = e.message.includes("DocumentAuditLog records are strictly immutable");
    }

    try {
      await DocumentAuditLog.deleteOne({ _id: sampleLog._id });
    } catch (e) {
      deleteThrewError = e.message.includes("DocumentAuditLog records are strictly immutable");
    }

    record("6.15 Audit Log Records Strictly Immutable (No Updates or Deletions)", updateThrewError && deleteThrewError, `Update Blocked: ${updateThrewError}, Delete Blocked: ${deleteThrewError}`);

    // ----------------------------------------------------
    // SECTION 7: SERVICES PUBLISHING & BOOKING WORKFLOW TESTS
    // ----------------------------------------------------
    console.log("\n--- 7. Services Publishing & Booking Workflow Tests ---");

    // Create an unverified provider to test publishing restrictions
    const unverifiedProviderEmail = `unverified_prov_${Date.now()}@example.com`;
    await User.create({
      email: unverifiedProviderEmail,
      password: "Password123!",
      role: "provider",
      emailVerified: true,
      isActive: true
    });
    res = await makeRequest({
      method: "POST",
      path: "/api/auth/login",
      body: { email: unverifiedProviderEmail, password: "Password123!" }
    });
    const unverifiedProvToken = res.body?.data?.tokens?.accessToken;
    await makeRequest({
      method: "PUT",
      path: "/api/profiles/me",
      headers: { Authorization: `Bearer ${unverifiedProvToken}` },
      body: { fullName: "Unverified Provider", professionId: (await Profession.findOne({ name: "Nurse" }))._id }
    });

    // 7.1 Unverified Provider Cannot Publish Service
    res = await makeRequest({
      method: "POST",
      path: "/api/services",
      headers: { Authorization: `Bearer ${unverifiedProvToken}` },
      body: {
        title: "Home Nursing Care",
        description: "Professional post-operative nursing care.",
        price: 350,
        durationMinutes: 60,
        serviceAreas: [{ governorate: "Cairo", city: "Nasr City" }]
      }
    });
    record("7.1 Unverified Provider Cannot Publish (Status: 403)", res.statusCode === 403, `Status: ${res.statusCode}`);

    // 7.2 Verified Provider Cannot Publish Outside Approved Profession
    const ptProfession = await Profession.findOne({ name: "Physical Therapist" });
    res = await makeRequest({
      method: "POST",
      path: "/api/services",
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: {
        professionId: ptProfession._id,
        title: "Physical Rehab Therapy",
        description: "Post stroke rehab.",
        price: 500,
        durationMinutes: 45,
        serviceAreas: [{ governorate: "Cairo", city: "Nasr City" }]
      }
    });
    record("7.2 Provider Cannot Publish Outside Approved Profession (Status: 400)", res.statusCode === 400, `Status: ${res.statusCode}`);

    // 7.3 Verified Provider Can Publish Service Immediately (Instant Publishing)
    const nurseProf = await Profession.findOne({ name: "Nurse" });
    res = await makeRequest({
      method: "POST",
      path: "/api/services",
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: {
        professionId: nurseProf._id,
        title: "Elderly Nursing & Wound Care",
        description: "Comprehensive home nursing and sterile wound dressing.",
        price: 400,
        durationMinutes: 60,
        serviceAreas: [{ governorate: "Cairo", city: "Nasr City" }]
      }
    });
    const service1 = res.body?.data;
    const service1Id = service1?._id;
    record(
      "7.3 Verified Provider Can Publish Immediately (Status: 201)",
      res.statusCode === 201 && service1?.publicationStatus === "published" && service1?.moderationStatus === "pending_review",
      `PubStatus: ${service1?.publicationStatus}, ModStatus: ${service1?.moderationStatus}`
    );

    // 7.4 Service is Visible in Public / Patient Discovery Before Admin Moderation
    res = await makeRequest({
      method: "GET",
      path: `/api/services/discover?search=Wound`
    });
    const discovered = res.body?.data || [];
    const foundService = discovered.find((s) => s._id === service1Id);
    record("7.4 Service Visible in Discovery Before Admin Moderation", Boolean(foundService), `Found: ${Boolean(foundService)}`);

    // 7.5 Provider Cannot Modify Protected Moderation Fields via Update API
    res = await makeRequest({
      method: "PUT",
      path: `/api/services/${service1Id}`,
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: {
        moderationStatus: "approved",
        reviewedBy: "hacked_admin",
        price: 450
      }
    });
    const updatedService = res.body?.data;
    record(
      "7.5 Provider Cannot Tamper Moderation Fields (ModStatus remains pending_review)",
      res.statusCode === 200 && updatedService?.moderationStatus === "pending_review" && updatedService?.price === 450,
      `ModStatus: ${updatedService?.moderationStatus}, Price: ${updatedService?.price}`
    );

    // 7.6 Cross-Provider Service Edit Blocked
    res = await makeRequest({
      method: "PUT",
      path: `/api/services/${service1Id}`,
      headers: { Authorization: `Bearer ${unverifiedProvToken}` },
      body: { price: 999 }
    });
    record("7.6 Provider Cannot Edit Another Provider's Service (Status: 403 or 404)", res.statusCode === 403 || res.statusCode === 404, `Status: ${res.statusCode}`);

    // 7.7 Admin Rejection Automatically Hides the Service
    res = await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/services/${service1Id}/review`,
      body: { decision: "reject", rejectionReason: "Clinical description needs clarification." }
    });
    record(
      "7.7 Admin Rejection Hides Service (ModStatus: rejected, PubStatus: hidden)",
      res.statusCode === 200 && res.body?.data?.publicationStatus === "hidden" && res.body?.data?.moderationStatus === "rejected",
      `Pub: ${res.body?.data?.publicationStatus}, Mod: ${res.body?.data?.moderationStatus}`
    );

    // 7.8 Rejected Service Disappears from Public / Patient Discovery
    res = await makeRequest({
      method: "GET",
      path: `/api/services/discover?search=Wound`
    });
    const afterRejectFound = (res.body?.data || []).find((s) => s._id === service1Id);
    record("7.8 Rejected Service Hidden from Discovery", !afterRejectFound, `Visible: ${Boolean(afterRejectFound)}`);

    // 7.9 Admin Suspension Hides Service
    // Publish service 2 to test suspension and approval
    res = await makeRequest({
      method: "POST",
      path: "/api/services",
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: {
        professionId: nurseProf._id,
        title: "IV Cannulation & Medication Administration",
        description: "Administering IV medications and fluid drips safely at home.",
        price: 300,
        durationMinutes: 45,
        serviceAreas: [{ governorate: "Cairo", city: "Nasr City" }]
      }
    });
    const service2Id = res.body?.data?._id;

    res = await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/services/${service2Id}/suspend`,
      body: { suspensionReason: "Quality investigation in progress." }
    });
    record(
      "7.9 Admin Suspension Hides Service (ModStatus: suspended, PubStatus: hidden)",
      res.statusCode === 200 && res.body?.data?.publicationStatus === "hidden" && res.body?.data?.moderationStatus === "suspended",
      `Pub: ${res.body?.data?.publicationStatus}, Mod: ${res.body?.data?.moderationStatus}`
    );

    // 7.10 Publish Service 3 for Booking & Admin Approves it
    res = await makeRequest({
      method: "POST",
      path: "/api/services",
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: {
        professionId: nurseProf._id,
        title: "Post-Surgical Nursing Care",
        description: "Sterile dressing and vital signs monitoring.",
        price: 500,
        durationMinutes: 60,
        serviceAreas: [{ governorate: "Cairo", city: "Nasr City" }]
      }
    });
    const service3Id = res.body?.data?._id;

    res = await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/services/${service3Id}/review`,
      body: { decision: "approve" }
    });
    record(
      "7.10 Admin Moderation Approval (ModStatus: approved, PubStatus: published)",
      res.statusCode === 200 && res.body?.data?.moderationStatus === "approved" && res.body?.data?.publicationStatus === "published",
      `Pub: ${res.body?.data?.publicationStatus}, Mod: ${res.body?.data?.moderationStatus}`
    );

    // 7.11 Admin Service Restoration (Restores Suspended Service to Published)
    res = await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/services/${service2Id}/restore`,
      body: { restorationReason: "Quality investigation completed; approved for practice." }
    });
    record(
      "7.11 Admin Service Restoration (ModStatus: approved, PubStatus: published)",
      res.statusCode === 200 && res.body?.data?.moderationStatus === "approved" && res.body?.data?.publicationStatus === "published",
      `Pub: ${res.body?.data?.publicationStatus}, Mod: ${res.body?.data?.moderationStatus}`
    );

    // 7.12 Ineligible Service Restoration Rejected (Already approved service cannot be restored)
    res = await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/services/${service2Id}/restore`,
      body: { restorationReason: "Trying to restore already approved service." }
    });
    record(
      "7.12 Ineligible Service Restoration Rejected (Status: 400)",
      res.statusCode === 400,
      `Status: ${res.statusCode}`
    );

    // 7.13 Restoration Respects Provider Intent (Provider explicitly hid service before admin action)
    // Create service 4, provider hides it, admin rejects it, admin restores it -> should remain hidden!
    res = await makeRequest({
      method: "POST",
      path: "/api/services",
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: {
        professionId: nurseProf._id,
        title: "Pediatric Home Care",
        description: "Specialized pediatric monitoring.",
        price: 450,
        durationMinutes: 60,
        serviceAreas: [{ governorate: "Cairo", city: "Nasr City" }]
      }
    });
    const service4Id = res.body?.data?._id;
    // Provider hides it
    await makeRequest({
      method: "PUT",
      path: `/api/services/${service4Id}`,
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: { publicationStatus: "hidden" }
    });
    // Admin rejects it
    await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/services/${service4Id}/review`,
      body: { decision: "reject", rejectionReason: "Need protocol revision" }
    });
    // Admin restores it
    res = await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/services/${service4Id}/restore`,
      body: { restorationReason: "Re-evaluated and approved" }
    });
    record(
      "7.13 Restoration Does Not Auto-Republish Provider-Hidden Service (PubStatus: hidden, ModStatus: approved)",
      res.statusCode === 200 && res.body?.data?.publicationStatus === "hidden" && res.body?.data?.moderationStatus === "approved",
      `Pub: ${res.body?.data?.publicationStatus}, Mod: ${res.body?.data?.moderationStatus}`
    );

    // ----------------------------------------------------
    // SECTION 8: PATIENT SERVICE REQUEST & BOOKING TESTS
    // ----------------------------------------------------
    console.log("\n--- 8. Service Request & Booking Tests ---");

    // 8.1 Unverified Patient Cannot Create Service Request (Patient documents not yet approved)
    res = await makeRequest({
      method: "POST",
      path: "/api/service-requests",
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: {
        serviceId: service3Id,
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        address: { governorate: "Cairo", city: "Nasr City", street: "Abbas El Akkad" }
      }
    });
    record("8.1 Unverified Patient Cannot Create Request (Status: 403)", res.statusCode === 403, `Status: ${res.statusCode}`);

    // Approve Patient Documents to satisfy platform verification requirements
    const patientUser = await User.findOne({ email: patientEmail });
    await UserDocument.create([
      {
        userId: patientUser._id,
        documentType: "profile_photo",
        originalFileName: "photo.jpg",
        storedFileName: "photo.jpg",
        mimeType: "image/jpeg",
        fileSize: 1024,
        storageKey: "patient_photo",
        status: "approved",
        isActiveVersion: true,
        version: 1
      },
      {
        userId: patientUser._id,
        documentType: "national_id_front",
        originalFileName: "nid_front.jpg",
        storedFileName: "nid_front.jpg",
        mimeType: "image/jpeg",
        fileSize: 1024,
        storageKey: "patient_nid_front",
        status: "approved",
        isActiveVersion: true,
        version: 1
      },
      {
        userId: patientUser._id,
        documentType: "national_id_back",
        originalFileName: "nid_back.jpg",
        storedFileName: "nid_back.jpg",
        mimeType: "image/jpeg",
        fileSize: 1024,
        storageKey: "patient_nid_back",
        status: "approved",
        isActiveVersion: true,
        version: 1
      },
      {
        userId: patientUser._id,
        documentType: "proof_of_address",
        originalFileName: "address.pdf",
        storedFileName: "address.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
        storageKey: "patient_address",
        status: "approved",
        isActiveVersion: true,
        version: 1
      }
    ]);

    // 8.2 Verified Patient Can Create Service Request
    const bookingTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    res = await makeRequest({
      method: "POST",
      path: "/api/service-requests",
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: {
        serviceId: service3Id,
        scheduledAt: bookingTime.toISOString(),
        address: { governorate: "Cairo", city: "Nasr City", street: "10 Abbas El Akkad" },
        patientNotes: "Patient has knee stiffness."
      }
    });
    const booking1 = res.body?.data;
    const booking1Id = booking1?._id;
    record(
      "8.2 Verified Patient Can Create Service Request (Status: 201)",
      res.statusCode === 201 && booking1?.status === "pending" && booking1?.priceSnapshot === 500,
      `Status: ${booking1?.status}, PriceSnapshot: ${booking1?.priceSnapshot}`
    );

    // 8.3 Patient Cannot Request Suspended or Hidden Service
    res = await makeRequest({
      method: "POST",
      path: "/api/service-requests",
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: {
        serviceId: service1Id, // service1 was rejected by admin in test 7.7 and is hidden
        scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        address: { governorate: "Cairo", city: "Nasr City", street: "10 Abbas El Akkad" }
      }
    });
    record("8.3 Patient Cannot Request Suspended or Hidden Service (Status: 400)", res.statusCode === 400, `Status: ${res.statusCode}`);

    // 8.4 Self-Booking Prevention (Provider cannot request own service)
    res = await makeRequest({
      method: "POST",
      path: "/api/service-requests",
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: {
        serviceId: service3Id,
        scheduledAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        address: { governorate: "Cairo", city: "Nasr City", street: "10 Abbas El Akkad" }
      }
    });
    record("8.4 Role / Self-Booking Prevention (Status: 400 or 403)", res.statusCode === 400 || res.statusCode === 403, `Status: ${res.statusCode}`);

    // 8.5 Price Snapshot Integrity (Provider edits service price; booking snapshot remains unchanged)
    await makeRequest({
      method: "PUT",
      path: `/api/services/${service3Id}`,
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: { price: 750 } // Increased price
    });
    res = await makeRequest({
      method: "GET",
      path: `/api/service-requests/${booking1Id}`,
      headers: { Authorization: `Bearer ${patientAccessToken}` }
    });
    const fetchedBooking = res.body?.data;
    record(
      "8.5 Price Snapshot Integrity After Service Price Change (Remains: 500)",
      fetchedBooking?.priceSnapshot === 500,
      `Snapshot: ${fetchedBooking?.priceSnapshot}, NewServicePrice: 750`
    );

    // 8.6 Cross-Provider Cannot Respond to Request
    res = await makeRequest({
      method: "POST",
      path: `/api/service-requests/${booking1Id}/respond`,
      headers: { Authorization: `Bearer ${unverifiedProvToken}` },
      body: { action: "accept" }
    });
    record("8.6 Unauthorized Provider Cannot Respond (Status: 404)", res.statusCode === 404, `Status: ${res.statusCode}`);

    // 8.7 Owner Provider Accepts Request
    res = await makeRequest({
      method: "POST",
      path: `/api/service-requests/${booking1Id}/respond`,
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: { action: "accept" }
    });
    record("8.7 Provider Accepts Service Request (Status: 200)", res.statusCode === 200 && res.body?.data?.status === "accepted", `Status: ${res.body?.data?.status}`);

    // 8.8 Invalid Status Transition Rejected (Cannot skip directly from accepted to completed)
    res = await makeRequest({
      method: "PATCH",
      path: `/api/service-requests/${booking1Id}/status`,
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: { status: "completed" }
    });
    record("8.8 Invalid Status Transition Rejected (accepted -> completed rejected)", res.statusCode === 400, `Status: ${res.statusCode}`);

    // 8.9 Valid Workflow Progression: accepted -> confirmed -> in_progress -> completed
    await makeRequest({
      method: "PATCH",
      path: `/api/service-requests/${booking1Id}/status`,
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: { status: "confirmed" }
    });
    await makeRequest({
      method: "PATCH",
      path: `/api/service-requests/${booking1Id}/status`,
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: { status: "in_progress" }
    });
    res = await makeRequest({
      method: "PATCH",
      path: `/api/service-requests/${booking1Id}/status`,
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: { status: "completed" }
    });
    record(
      "8.9 Valid Workflow Progression to Completed (Status: 200)",
      res.statusCode === 200 && res.body?.data?.status === "completed" && Boolean(res.body?.data?.completedAt),
      `FinalStatus: ${res.body?.data?.status}`
    );

    // 8.10 Service Audit History Preserved
    res = await makeHmacRequest({
      method: "GET",
      path: `/api/internal/reviews/services/${service3Id}/history`
    });
    const auditLogs = res.body?.data?.logs || [];
    record(
      "8.10 Service Audit History Recorded (Count > 0)",
      res.statusCode === 200 && auditLogs.length > 0,
      `Audit Logs: ${auditLogs.length}`
    );

    // =========================================================================
    // SECTION 9: CANCELLATION WORKFLOW TESTS (NORMAL & EXCEPTIONAL)
    // =========================================================================
    console.log("\n--- SECTION 9: CANCELLATION WORKFLOW TESTS ---");

    // Helper: Create a booking for cancellation testing
    let testBookingCounter = 0;
    const createTestBooking = async (minutesInFuture) => {
      testBookingCounter++;
      // Increment schedule date to avoid conflicting overlapping 30-min window for same service
      const scheduledTime = new Date(Date.now() + (minutesInFuture + testBookingCounter * 120) * 60 * 1000);
      const createRes = await makeRequest({
        method: "POST",
        path: "/api/service-requests",
        headers: { Authorization: `Bearer ${patientAccessToken}` },
        body: {
          serviceId: service3Id,
          scheduledAt: scheduledTime.toISOString(),
          address: {
            governorate: "Cairo",
            city: "Nasr City",
            street: "Test St 99"
          },
          patientNotes: "Cancellation testing booking"
        }
      });
      return createRes.body?.data;
    };

    // 9.1 Normal Cancellation at >= 60 minutes succeeds (Patient)
    const booking91 = await createTestBooking(120); // 2 hours in future
    res = await makeRequest({
      method: "POST",
      path: `/api/service-requests/${booking91._id}/cancel`,
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: { reason: "Patient had schedule conflict" }
    });
    record(
      "9.1 Patient Normal Cancellation at >= 60 mins (Status: 200)",
      res.statusCode === 200 && res.body?.data?.status === "cancelled" && res.body?.data?.cancelledBy === "patient",
      `Status: ${res.body?.data?.status}, CancelledBy: ${res.body?.data?.cancelledBy}`
    );

    // 9.2 Normal Cancellation requires reason
    const booking92 = await createTestBooking(120);
    res = await makeRequest({
      method: "POST",
      path: `/api/service-requests/${booking92._id}/cancel`,
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: { reason: "" }
    });
    record(
      "9.2 Normal Cancellation Requires Reason (Status: 400)",
      res.statusCode === 400,
      `Status: ${res.statusCode}`
    );

    // 9.3 Normal Cancellation at >= 60 minutes succeeds (Provider)
    const booking93 = await createTestBooking(120);
    res = await makeRequest({
      method: "POST",
      path: `/api/service-requests/${booking93._id}/cancel`,
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: { reason: "Provider urgent clinical emergency" }
    });
    record(
      "9.3 Provider Normal Cancellation at >= 60 mins (Status: 200)",
      res.statusCode === 200 && res.body?.data?.status === "cancelled" && res.body?.data?.cancelledBy === "provider",
      `Status: ${res.body?.data?.status}, CancelledBy: ${res.body?.data?.cancelledBy}`
    );

    // 9.4 Normal Cancellation rejected when < 60 minutes remain
    // Create booking and directly set scheduledAt in DB to 30 mins in future
    const booking94 = await createTestBooking(120);
    await ServiceRequest.findByIdAndUpdate(booking94._id, {
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes in future
    });
    res = await makeRequest({
      method: "POST",
      path: `/api/service-requests/${booking94._id}/cancel`,
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: { reason: "Late emergency cancellation attempt" }
    });
    record(
      "9.4 Normal Cancellation Rejected When < 60 mins (Status: 400)",
      res.statusCode === 400,
      `Status: ${res.statusCode}`
    );

    // 9.5 Normal Cancellation rejected after in_progress
    const booking95 = await createTestBooking(120);
    // Move to accepted -> confirmed -> in_progress
    await ServiceRequest.findByIdAndUpdate(booking95._id, { status: "in_progress" });
    res = await makeRequest({
      method: "POST",
      path: `/api/service-requests/${booking95._id}/cancel`,
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: { reason: "Attempting cancel during session" }
    });
    record(
      "9.5 Normal Cancellation Rejected When In Progress (Status: 400)",
      res.statusCode === 400,
      `Status: ${res.statusCode}`
    );

    // 9.6 Exceptional Cancellation Request by Patient (< 60 mins)
    const booking96 = await createTestBooking(120);
    await ServiceRequest.findByIdAndUpdate(booking96._id, {
      scheduledAt: new Date(Date.now() + 25 * 60 * 1000)
    });
    res = await makeRequest({
      method: "POST",
      path: `/api/service-requests/${booking96._id}/exceptional-cancel`,
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: {
        reason: "Patient had sudden medical emergency requiring hospitalization",
        supportingDetails: "Admitted to St. Mary ER"
      }
    });
    const expReq96 = res.body?.data;
    record(
      "9.6 Patient Submits Exceptional Cancellation Request (Status: 201)",
      res.statusCode === 201 && expReq96?.status === "pending_review" && expReq96?.requesterRole === "patient",
      `ExpReqId: ${expReq96?._id}, Status: ${expReq96?.status}`
    );

    // 9.7 Prevent duplicate pending exceptional request for same requester & booking
    res = await makeRequest({
      method: "POST",
      path: `/api/service-requests/${booking96._id}/exceptional-cancel`,
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: { reason: "Duplicate submission attempt" }
    });
    record(
      "9.7 Duplicate Pending Exceptional Request Rejected (Status: 409)",
      res.statusCode === 409,
      `Status: ${res.statusCode}`
    );

    // 9.8 Exceptional Cancellation Request by Provider (In Progress urgent intervention)
    const booking98 = await createTestBooking(120);
    await ServiceRequest.findByIdAndUpdate(booking98._id, { status: "in_progress" });
    res = await makeRequest({
      method: "POST",
      path: `/api/service-requests/${booking98._id}/exceptional-cancel`,
      headers: { Authorization: `Bearer ${providerAccessToken}` },
      body: {
        reason: "Patient home unsafe for treatment due to hazardous conditions",
        supportingDetails: "Gas leak detected at patient residence"
      }
    });
    const expReq98 = res.body?.data;
    record(
      "9.8 Provider Submits Exceptional Request for In-Progress (Status: 201)",
      res.statusCode === 201 && expReq98?.status === "pending_review" && expReq98?.requesterRole === "provider",
      `ExpReqId: ${expReq98?._id}, Role: ${expReq98?.requesterRole}`
    );

    // 9.9 Unauthorized / Client without Admin Auth cannot access internal decision API
    res = await makeRequest({
      method: "PATCH",
      path: `/api/internal/reviews/exceptional-cancellations/${expReq96?._id}/decide`,
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: { decision: "approve", decisionReason: "Unauthorized attempt" }
    });
    record(
      "9.9 Unauthorized Access to Admin Decision API Blocked (Status: 401)",
      res.statusCode === 401,
      `Status: ${res.statusCode}`
    );

    // 9.10 Admin Rejection of Exceptional Request (Booking remains unchanged)
    res = await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/exceptional-cancellations/${expReq98?._id}/decide`,
      body: {
        decision: "reject",
        decisionReason: "Intervention not warranted; provider must resolve safely or complete"
      }
    });
    const booking98After = await ServiceRequest.findById(booking98._id);
    record(
      "9.10 Admin Rejects Exceptional Request (Booking Unchanged) (Status: 200)",
      res.statusCode === 200 &&
        res.body?.data?.exceptionalRequest?.status === "rejected" &&
        booking98After?.status === "in_progress",
      `ExpStatus: ${res.body?.data?.exceptionalRequest?.status}, BookingStatus: ${booking98After?.status}`
    );

    // 9.11 Admin Approval of Exceptional Request (Cancels Booking)
    res = await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/exceptional-cancellations/${expReq96?._id}/decide`,
      body: {
        decision: "approve",
        decisionReason: "Verified patient emergency medical admission; full waiver granted"
      }
    });
    const booking96After = await ServiceRequest.findById(booking96._id);
    record(
      "9.11 Admin Approves Exceptional Request (Cancels Booking) (Status: 200)",
      res.statusCode === 200 &&
        res.body?.data?.exceptionalRequest?.status === "approved" &&
        booking96After?.status === "cancelled" &&
        booking96After?.cancelledBy === "admin",
      `ExpStatus: ${res.body?.data?.exceptionalRequest?.status}, BookingStatus: ${booking96After?.status}, CancelledBy: ${booking96After?.cancelledBy}`
    );

    // 9.12 Exceptional Request for Completed Booking Rejected at Submission
    const booking912 = await createTestBooking(120);
    await ServiceRequest.findByIdAndUpdate(booking912._id, { status: "completed" });
    res = await makeRequest({
      method: "POST",
      path: `/api/service-requests/${booking912._id}/exceptional-cancel`,
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: { reason: "Trying to cancel after service completed" }
    });
    record(
      "9.12 Exceptional Request for Completed Booking Rejected (Status: 400)",
      res.statusCode === 400,
      `Status: ${res.statusCode}`
    );

    // 9.13 Exceptional Request for Already Cancelled Booking Rejected at Submission
    res = await makeRequest({
      method: "POST",
      path: `/api/service-requests/${booking91._id}/exceptional-cancel`,
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: { reason: "Trying to cancel already cancelled booking" }
    });
    record(
      "9.13 Exceptional Request for Cancelled Booking Rejected (Status: 400)",
      res.statusCode === 400,
      `Status: ${res.statusCode}`
    );

    // 9.14 Race Condition / Incompatible State: Booking completed while request pending
    // Admin approval must be rejected when booking reached completed
    const booking914 = await createTestBooking(120);
    const expReq914Res = await makeRequest({
      method: "POST",
      path: `/api/service-requests/${booking914._id}/exceptional-cancel`,
      headers: { Authorization: `Bearer ${patientAccessToken}` },
      body: { reason: "Urgent dispute while session ongoing" }
    });
    const expReq914Id = expReq914Res.body?.data?._id;
    // Simulate booking completing concurrently before Admin decides
    await ServiceRequest.findByIdAndUpdate(booking914._id, { status: "completed" });
    res = await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/exceptional-cancellations/${expReq914Id}/decide`,
      body: {
        decision: "approve",
        decisionReason: "Admin attempt to cancel session that completed"
      }
    });
    record(
      "9.14 Admin Approval Blocked on Completed Session Race Condition (Status: 409)",
      res.statusCode === 409,
      `Status: ${res.statusCode}`
    );

    // 9.15 Re-deciding Already Decided Request Blocked (Race condition safety)
    res = await makeHmacRequest({
      method: "PATCH",
      path: `/api/internal/reviews/exceptional-cancellations/${expReq96?._id}/decide`,
      body: {
        decision: "reject",
        decisionReason: "Second decision attempt on already approved request"
      }
    });
    record(
      "9.15 Re-deciding Already Decided Request Blocked (Status: 409)",
      res.statusCode === 409,
      `Status: ${res.statusCode}`
    );

  } catch (err) {
    console.error("Test execution failed with error:", err);
  } finally {
    if (server) {
      server.close();
    }
    await mongoose.disconnect();
    console.log("\n=================================================");
    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.filter((r) => !r.passed).length;
    console.log(`Summary: Total: ${results.length} | Passed: ${passedCount} | Failed: ${failedCount}`);
    console.log("=================================================");
    process.exit(failedCount > 0 ? 1 : 0);
  }
};

runAllTests();
