# TabibiGo Backend – Documentation Audit Report

This audit compares the documentation in `BACKEND_DOCUMENTATION.md` against the actual implementation in the codebase as of November 2026.

---

## 1. Executive Summary

| Category | Total Checked | Verified Accurate | Discrepancies Found |
|---|---|---|---|
| API Endpoints | 23 | 23 | 0 (All routes, controllers, and status codes match) |
| Mongoose Schemas & Collections | 8 | 8 | 0 (All collections, fields, and indexes match) |
| Admin Backend Integration Architecture | 1 | 0 | 1 (Direct shared DB pattern documented instead of strict service-to-service API) |
| Provider Verification Stages | 4 | 0 | 1 (Described as "Prepared" stages when independent verification models do not exist) |
| UserDocument Multi-file Support | 1 | 0 | 1 (Unique index `{ userId: 1, documentType: 1 }` prevents uploading multiple certificates) |
| Document Replacement Review History | 1 | 0 | 1 (Replacement overwrites existing doc; history is not preserved in `UserDocument`) |
| Provider Application Readiness | 1 | 0 | 1 (Requires uploaded non-rejected docs; does not require prior Admin approval) |
| OTP Purposes | 3 | 2 | 1 (`sign_in` exists in enum, but only `email_verification` and `password_reset` are implemented) |
| Admin Document Review Access | 1 | 0 | 1 (Private download route `/api/documents/:id/download` restricts access strictly to owner; no admin reviewer endpoint exists) |

---

## 2. Detailed Discrepancy Findings & Corrections

### Finding 1: Admin Backend Integration Communication Architecture
- **Documented Behavior:**
  Section 9 stated: *"The Admin Backend and Client Backend can communicate via: 1. Shared Database Access: The Admin Backend connects directly to TabibiGo-Users..."*
- **Actual Architecture & System Requirements:**
  The Admin Backend and Client Backend maintain separate databases. Direct shared database access across backends violates data isolation and security boundaries.
- **Relevant Source Files:**
  `src/app.js`, `src/config/database.js`
- **Correction:**
  Remove any recommendation of shared database access. Clarify that communication with the Admin Backend must occur strictly over authenticated internal service-to-service APIs (e.g. mutual TLS or HMAC-signed headers such as `X-Internal-Service-Key`).

---

### Finding 2: Provider Verification Stages & Workflow Status
- **Documented Behavior:**
  Section 7 listed four verification stages:
  - Identity Verified (*Prepared*)
  - License Verified (*Prepared*)
  - Experience Verified (*Prepared via yearsOfExperience and education fields*)
  - Skills Assessed (*Prepared via BLS certificate and interview_required*)
- **Actual Behavior in Code:**
  - Neither `ProviderProfile` nor `UserDocument` has separate tracking fields for "Experience Verified" or "Skills Assessed".
  - Simply uploading a BLS certificate or entering `yearsOfExperience` in the profile is an unverified self-declaration by the provider, not verified proof of clinical skill or experience.
  - The actual application model `ProviderApplication` contains only a single aggregate `status` (`draft`, `submitted`, `under_review`, `interview_required`, `approved`, `rejected`).
- **Relevant Source Files:**
  `src/models/ProviderProfile.js`, `src/models/ProviderApplication.js`, `src/services/providerApplication.service.js`
- **Correction:**
  Explicitly mark the four independent verification stages as **Not Implemented**. Document that verification is currently tracked as a single monolithic application status (`ProviderApplication.status`) and a single boolean flag (`ProviderProfile.isApproved`), with granular multi-stage sub-verification deferred to future Admin Backend workflows.

---

### Finding 3: Document Replacement and Review History
- **Documented Behavior:**
  Section 8 described document replacement as replacing previous files, but did not clarify the impact on audit and review history.
- **Actual Behavior in Code:**
  In `src/services/document.service.js` (`saveUserDocument`):
  ```javascript
  const document = await UserDocument.findOneAndUpdate(
    { userId: user._id, documentType: targetDocType },
    { $set: docData },
    { upsert: true, returnDocument: "after", runValidators: true }
  );
  ```
  When a user replaces an existing document, the previous document record is updated in place (`status` resets to `pending_review`, `rejectionReason` resets to `null`, and `uploadedAt` resets to `new Date()`). Previous file revision history and previous rejection notes are overwritten, not versioned.
- **Relevant Source Files:**
  `src/services/document.service.js` (line 105), `src/models/UserDocument.js`
- **Correction:**
  Explicitly document that replacement overwrites the record in-place and resets the review state to `pending_review`. Audit/version history is **Not Implemented** in the current single-record schema.

---

### Finding 4: Single Document per Type vs. Multiple Certificates Limitation
- **Documented Behavior:**
  Section 3 & Section 8 documented unique index `{ userId: 1, documentType: 1 }`.
- **Impact & Actual Behavior in Code:**
  Because of `{ userId: 1, documentType: 1 }` unique compound index:
  - A provider can only upload **one** document per `documentType`.
  - Providers cannot upload multiple experience certificates, multiple degrees, or multiple specialty training certificates under the same document type; any subsequent upload of that type overwrites the previous one.
- **Relevant Source Files:**
  `src/models/UserDocument.js` (line 92), `src/services/document.service.js`
- **Correction:**
  Document this architectural constraint clearly in Section 8 as a current technical limitation. To support multiple training or experience certificates, a separate collection or an array-based document schema would be required in future versions.

---

### Finding 5: Admin Reviewer Document Access
- **Documented Behavior:**
  Section 4 documented `GET /api/documents/:documentId/download` as the private authenticated document retrieval route.
- **Actual Behavior in Code:**
  In `src/controllers/document.controller.js` and `src/services/document.service.js`:
  ```javascript
  const getDocumentFileForDownload = async (documentId, userId) => {
    const doc = await UserDocument.findOne({ _id: documentId, userId });
    if (!doc) {
      const error = new Error("Document not found or access denied.");
      error.statusCode = 404;
      throw error;
    }
    ...
  };
  ```
  The endpoint strictly matches `userId: req.user._id`. An administrative reviewer or external auditing service cannot download or view documents through this endpoint because there is no admin-role override implemented in the Client Backend.
- **Relevant Source Files:**
  `src/services/document.service.js` (line 195), `src/controllers/document.controller.js` (line 130)
- **Correction:**
  Clarify that Admin reviewers currently have **No Implemented Endpoint** in the Client Backend to access private documents. Admin document review endpoints must be implemented via an internal authenticated service API.

---

### Finding 6: Provider Application Submission Readiness Conditions
- **Documented Behavior:**
  Sections 1, 7, and 12 discussed provider application verification.
- **Actual Behavior in Code:**
  In `src/services/providerApplication.service.js` (`validateProviderApplicationReadiness`):
  ```javascript
  return {
    isReady: missingDocs.length === 0 && rejectedDocs.length === 0,
    missingDocs,
    rejectedDocs,
    pendingDocs
  };
  ```
  A provider application **can be submitted while documents are in `pending_review` status**. It only requires that all mandatory documents are uploaded (`missingDocs.length === 0`) and none are rejected (`rejectedDocs.length === 0`). It does **not** require documents to be `approved` prior to submission, because document review and application review occur simultaneously in the verification lifecycle.
- **Relevant Source Files:**
  `src/services/providerApplication.service.js` (lines 53-58)
- **Correction:**
  Explicitly document that application submission requires documents to be present and non-rejected (`pending_review` is accepted). Document approval is a post-submission step carried out by administrators.

---

### Finding 7: OTP Purposes in Schema vs. Implemented Auth Endpoints
- **Documented Behavior:**
  Section 3 documented `OTPCode.purpose` enum: `["sign_in", "email_verification", "password_reset"]`.
- **Actual Behavior in Code:**
  - `email_verification`: Fully implemented via `POST /api/auth/send-verification-otp` and `POST /api/auth/verify-email`.
  - `password_reset`: Fully implemented via `POST /api/auth/forgot-password` and `POST /api/auth/verify-password-reset`.
  - `sign_in`: Present in Mongoose schema enum, but **Not Implemented** in routes or controllers (login uses password authentication, not OTP login).
- **Relevant Source Files:**
  `src/models/OTPCode.js` (line 21), `src/routes/auth.routes.js`, `src/services/otp.service.js`
- **Correction:**
  Note in Section 3 and Section 5 that `sign_in` is a reserved schema enum value, but OTP-based passwordless sign-in is **Not Implemented**.

---

## 3. Summary of Status Classifications

| Feature Area | Status in Code | Notes |
|---|---|---|
| User Registration & Role Assignment | **Implemented** | `patient` and `provider` supported |
| Email OTP Verification | **Implemented** | Rate-limited (60s), 5 attempts max |
| Passwordless OTP Sign-in | **Not Implemented** | Schema enum exists; endpoints do not |
| Password Hashing | **Implemented** | `bcryptjs` cost 12 |
| JWT Access Tokens & Refresh Rotation | **Implemented** | 15m access, 7d refresh with SHA-256 rotation |
| Logout & Token Revocation | **Implemented** | Marks token revoked in MongoDB |
| Password Reset with OTP | **Implemented** | Generates secure one-time 64-char token |
| Patient Profile Management | **Implemented** | Demographics, location, medical info |
| Provider Profile Management | **Implemented** | Profession validation, bio, experience, sparse GeoJSON |
| Active Professions Catalog | **Implemented** | Seeded with Nurse & Physical Therapist |
| Profession Document Requirements Config | **Implemented** | Separate rules for Nurse & Physical Therapist |
| Legal vs. Platform Document Category | **Implemented** | `legal_mandatory` vs `platform_policy` |
| Secure File Upload & Magic Byte Check | **Implemented** | JPEG, PNG, WebP, PDF verified via byte signatures |
| Private File Streaming | **Implemented** | Authenticated download for document owner |
| Document Versioning / Multi-file Upload | **Not Implemented** | Enforces 1 document per type; overwrites history |
| Provider Application Submission | **Implemented** | Validates document presence; accepts pending docs |
| Re-application After Rejection | **Implemented** | Unlocks provider to reapply |
| Four Independent Verification Stages | **Not Implemented** | Only single aggregate status and `isApproved` exist |
| Admin Document Review Endpoints | **Pending Admin Integration** | Admin Backend must use service-to-service API |
| Admin Reviewer File Download Access | **Pending Admin Integration** | Client download endpoint strictly enforces owner ID |
| Admin Application Decision Endpoints | **Pending Admin Integration** | Schema prepared; endpoints belong to Admin Backend |
