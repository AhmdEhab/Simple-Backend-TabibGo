# TabibiGo – Final Security & Workflow Hardening Audit Report

This report presents the findings, fixes, security verifications, and remaining operational considerations resulting from the focused security hardening of the TabibiGo Client Backend.

---

## 1. Executive Summary

| Security Domain | Initial State | Hardened State & Fix Implemented | Verification Result |
|---|---|---|---|
| **HMAC Replay Protection** | Timestamp check only (+/- 5 min). Same signed request could be replayed within the window. | **Enforced Unique Request Nonces** with an in-memory TTL expiration cache. Duplicate nonces are immediately rejected (`401 Replay attack detected`). | **PASS** (Test 6.6 verified duplicate request rejection) |
| **Admin Identity Integrity** | `x-admin-id` was read from header without being bound to the HMAC signature string. | **Cryptographic Context Binding:** Method, path, timestamp, nonce, caller, admin ID, and body digest are combined into the string-to-sign. Tampering with `x-admin-id` breaks the HMAC signature. | **PASS** (Test 6.7 verified identity tampering rejection) |
| **Provider Approval Prerequisite Enforcement** | Application could be approved before stages were verified or while documents were pending/rejected. | **Strict Gatekeeping (`validateProviderApprovalPrerequisites`):** Verifies all 4 stages are `"verified"`, all mandatory active documents are `"approved"`, and no active document is `"rejected"`. Inactive old versions cannot satisfy requirements. | **PASS** (Tests 6.9, 6.10, 6.11, 6.12 verified blocked approval) |
| **Audit Log Immutability** | Audit logs were append-only in service logic, but Mongoose schema permitted modifications. | **Schema-Level Immutability Hooks:** `DocumentAuditLog` schema pre-hooks intercept and throw security violations on any `update`, `replace`, or `delete` operations. | **PASS** (Test 6.15 verified update & delete blocked) |
| **Automated Security Test Suite** | 45 test cases | Expanded to **47 automated test cases** covering replay attacks, tampering, prerequisite gates, and immutability. | **100% PASS** (47/47 passing against MongoDB Atlas) |

---

## 2. Detailed Findings & Fixes Implemented

### 1. HMAC Replay Protection & Nonce Cache
- **Issue Discovered:** The earlier implementation relied solely on `timestampHeader` validation within a 5-minute window (`300,000 ms`). While expired requests outside the 5-minute window were rejected, an attacker intercepting a valid signed request could replay the exact same HTTP request multiple times within the 5-minute window.
- **Fix Implemented:**
  1. Updated [src/middleware/internalAuth.middleware.js](file:///c:/Users/aehab/OneDrive/سطح%20المكتب/TabibiGo_Backend/src/middleware/internalAuth.middleware.js) to require an `x-internal-nonce` header.
  2. Built an atomic `checkAndStoreNonce(nonce, validUntilMs)` mechanism with an in-memory cache and periodic cleanup.
  3. Bound `nonce` into the signature string: `${method}:${path}:${timestamp}:${nonce}:${caller}:${adminId}:${bodyDigest}`.
  4. If a request arrives with an already-used nonce, it is immediately rejected with HTTP `401 Unauthorized: Replay attack detected: Nonce has already been used.`

### 2. Admin Identity Integrity & Tamper Prevention
- **Issue Discovered:** `x-admin-id` was accepted from request headers to record the administrative reviewer in audit logs. However, because it was not part of the HMAC signature payload, an attacker with network visibility could modify the `x-admin-id` header without invalidating the cryptographic signature.
- **Fix Implemented:**
  1. Modified the HMAC signing string format in `internalAuth.middleware.js` to strictly bind `callerHeader` and `adminIdHeader`.
  2. Any alteration of `x-admin-id` or `x-internal-caller` results in a signature mismatch, returning HTTP `401 Unauthorized: Invalid internal service signature`.
  3. Required `x-admin-id` to be present on all internal calls (even with API key fallback) to guarantee audit accountability.

### 3. Provider Approval Rules Hardening
- **Issue Discovered:** In `src/services/internalReview.service.js`, an application could be marked `approved` without confirming that each individual verification stage had reached `verified` status, or while mandatory documents were still in `pending_review` or `rejected` status.
- **Fix Implemented:**
  Created `validateProviderApprovalPrerequisites(provider)` in `internalReview.service.js` which enforces:
  1. **Stage Completion Gate:** All 4 independent stages (`identityVerification`, `licenseVerification`, `experienceVerification`, `skillsAssessment`) must have status `"verified"`.
  2. **Active Document Approval Gate:** Every mandatory document for the provider's profession must have an active version in `"approved"` status.
  3. **No Active Rejections:** No active document belonging to the provider may be in `"rejected"` status.
  4. **Active Version Integrity:** Older superseded approved document versions cannot bypass an active document that has been superseded by a rejected or pending version.

### 4. Audit Log Immutability Enforcement
- **Issue Discovered:** While no public or internal API exposed update or delete routes for `DocumentAuditLog`, the Mongoose schema did not enforce immutability at the model level.
- **Fix Implemented:**
  In [src/models/DocumentAuditLog.js](file:///c:/Users/aehab/OneDrive/سطح%20المكتب/TabibiGo_Backend/src/models/DocumentAuditLog.js), added schema pre-hooks intercepting:
  - `updateOne`, `updateMany`, `findOneAndUpdate`, `replaceOne`
  - `deleteOne`, `deleteMany`, `findOneAndDelete`, `remove`
  Any attempt to mutate or delete an audit log document throws:
  `Security Violation: DocumentAuditLog records are strictly immutable and cannot be updated or deleted.`

---

## 3. Security Test Suite Execution & Results

Executed against MongoDB Atlas with zero mock bypasses:

```text
=================================================
   TabibiGo Security & Workflow Hardening Suite  
=================================================

--- 1. Authentication Tests ---
✓ PASS - 1.1 Register Patient (Status: 201)
✓ PASS - 1.2 Register Provider (Status: 201)
✓ PASS - 1.3 Duplicate Email Rejection (Status: 409)
✓ PASS - 1.4 Invalid Role Rejection (Status: 400)
✓ PASS - 1.5 Block Login Unverified User (Status: 403)
✓ PASS - 1.6 Verify Email with Valid OTP (Status: 200)
✓ PASS - 1.7 Login Verified Patient (Issued Tokens) (Status: 200)
✓ PASS - 1.8 Login Verified Provider (Issued Tokens) (Status: 200)
✓ PASS - 1.9 Reject Protected Endpoint Without Token (Status: 401)
✓ PASS - 1.10 Access Protected Endpoint With Token (Status: 200)
✓ PASS - 1.11 Refresh Token Rotation (Issues New Tokens) (Status: 200)
✓ PASS - 1.12 Old Refresh Token Rejected After Rotation (Status: 401)
✓ PASS - 1.13 Logout Successfully (Status: 200)

--- 2. Profiles Tests ---
✓ PASS - 2.1 Create / Complete Patient Profile (Status: 200)
✓ PASS - 2.2 Role Guard: Patient Forbidden from Provider Profile (Status: 403)
✓ PASS - 2.3 Reject Invalid / Non-existent Profession (Status: 400)
✓ PASS - 2.4 Create / Complete Provider Profile (Status: 200)
✓ PASS - 2.5 Get My Profile (Provider) (Status: 200)
✓ PASS - 2.6 Update Profile Successfully (Status: 200)

--- 3. Secure Document Tests ---
✓ PASS - 3.1 Get Patient Document Requirements (Count: 4)
✓ PASS - 3.2 Get Provider Document Requirements (Count: 9)
✓ PASS - 3.3 Upload Valid Patient Document (DocId: 6b04ba8d1322f066b5a9b025)
✓ PASS - 3.4 Reject Cross-Role Document Type (Status: 400)
✓ PASS - 3.5 Reject File Signature Mismatch (Status: 400)
✓ PASS - 3.6 Reject Disallowed File Extension (Status: 400)
✓ PASS - 3.7 Download Document Authenticated (Status: 200)
✓ PASS - 3.8 Block Cross-User Document Access (Status: 404)

--- 4. Multi-Document Support & Versioning Tests ---
✓ PASS - 4.1 Upload Multiple Experience Certificates (Doc1 & Doc2 distinct)
✓ PASS - 4.2 Multiple Documents Stored Simultaneously (Count: 2)
✓ PASS - 4.3 Upload Versioned Replacement Document (V2 ID: 6b04ba9b1322f066b5a9b02d, Prev ID: 6b04ba991322f066b5a9b02b)
✓ PASS - 4.4 Old Version Record Preserved with Rejection Reason (Status: rejected, Reason: Image is blurry)

--- 5. Provider Application Tests ---
✓ PASS - 5.1 Submit Application with Pending Required Documents (Status: 201)
✓ PASS - 5.2 Prevent Duplicate Active Application (Status: 409)

--- 6. Security Hardening Tests ---
✓ PASS - 6.1 Reject Internal API Without Authentication (Status: 401)
✓ PASS - 6.2 Reject Request Without Nonce (Status: 401)
✓ PASS - 6.3 Reject Request with Invalid Signature (Status: 401)
✓ PASS - 6.4 Reject Expired Internal Timestamp (Status: 401)
✓ PASS - 6.5 Valid HMAC Request with Nonce Accepted (Total: 7)
✓ PASS - 6.6 Reject Replay of Duplicate Nonce (Status: 401)
✓ PASS - 6.7 Reject Admin Identity Tampering (Status: 401)
✓ PASS - 6.8 Admin Secure Document Download (Status: 200)
✓ PASS - 6.9 Approval Blocked When Stages Are Incomplete (Status: 400)
✓ PASS - 6.10 Approval Blocked When Mandatory Documents Are Unapproved (Status: 400)
✓ PASS - 6.11 Approval Blocked When Active Document is Rejected (Status: 400)
✓ PASS - 6.12 Inactive Approved Version Cannot Bypass Active Rejection (Status: 400)
✓ PASS - 6.14 Application Approved When All Prerequisites Met (App Status: approved)
✓ PASS - 6.15 Audit Log Records Strictly Immutable (No Updates or Deletions) (Update Blocked: true, Delete Blocked: true)

=================================================
Summary: Total: 47 | Passed: 47 | Failed: 0
=================================================
```

---

## 4. Trust Boundary & Remaining Risks

### Trust Boundary Specification
```
[Admin Reviewer (Human)]
         │ (1. Authenticates via Admin Backend SSO / Password)
         ▼
[Admin Backend Service]
         │ (2. Validates human session, RBAC permissions, and audit authorization)
         │ (3. Generates Nonce, Timestamp, Body SHA-256)
         │ (4. Signs with shared INTERNAL_SERVICE_SECRET via HMAC-SHA256)
         ▼
[Client Backend (/api/internal/reviews/*)]
         │ (5. Verifies Nonce freshness in cache)
         │ (6. Validates Timestamp window +/- 5 min)
         │ (7. Verifies HMAC-SHA256 over METHOD:PATH:TS:NONCE:CALLER:ADMIN_ID:BODY)
         │ (8. Executes business logic & records immutable DocumentAuditLog)
```

1. **Responsibility of the Admin Backend:**
   - The Admin Backend is responsible for authenticating the human administrator before issuing signed requests.
   - The Admin Backend must verify that the administrator has the appropriate RBAC role (e.g. `medical_credential_reviewer` vs `super_admin`) before dispatching decisions.
   - The Client Backend trusts the authenticity of `x-admin-id` because it is cryptographically signed by the Admin Backend's private shared secret.

2. **Remaining Operational Considerations:**
   - **Distributed Nonce Cache (For Multi-Instance Scaling):** The current nonce cache uses an in-memory `Map` with periodic TTL pruning. When deploying multiple load-balanced instances of the Client Backend, a distributed cache (such as Redis with a 5-minute TTL) should be configured so nonces are shared across all backend instances.
   - **Secret Rotation Policy:** Establish a periodic secret rotation schedule for `INTERNAL_SERVICE_SECRET`. Dual-key support (primary and secondary secrets) can be added during rotation periods.

---

## 5. Exact Integration Steps Required Before Admin Backend Connection

1. **Exchange Shared Secret:**
   Ensure both backends configure the exact same `INTERNAL_SERVICE_SECRET` in their respective production `.env` files. Never commit this value to git.
2. **Implement Admin Request Signer:**
   Implement the exact 7-part HMAC-SHA256 signing format documented in [ADMIN_INTEGRATION.md](file:///c:/Users/aehab/OneDrive/سطح%20المكتب/TabibiGo_Backend/ADMIN_INTEGRATION.md):
   ```
   stringToSign = `${method}:${path}:${timestamp}:${nonce}:${caller}:${adminId}:${bodyDigest}`
   ```
3. **Generate UUID/Cryptographic Nonces:**
   The Admin Backend must generate a unique cryptographic nonce (e.g. `crypto.randomBytes(16).toString("hex")` or UUID v4) for every HTTP request.
4. **Pass Reviewer Identity:**
   Include the authenticated reviewer's email or user ID in `x-admin-id` for traceability in `Document_Audit_Logs`.
5. **Handle Prerequisite Errors Gracefully:**
   The Admin UI should surface the detailed prerequisite error messages returned by `PATCH /api/internal/reviews/applications/:id/decide` (e.g., notifying the reviewer if a mandatory stage or document remains unapproved before attempting final application approval).
