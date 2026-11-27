# TabibiGo Client Backend — Admin ↔ Client Integration Matrix

> **Audit Date:** 2026-11-27  
> **Architecture:** Separate Databases (Admin Database vs Client Database `TabibiGo-Users`)  
> **Protocol:** Internal Service-to-Service REST over HTTPS with HMAC-SHA256 Signatures  
> **Source Files Inspected:**  
> - `src/middleware/internalAuth.middleware.js`  
> - `src/routes/internalReview.routes.js`  
> - `src/controllers/internalReview.controller.js`  
> - `src/services/internalReview.service.js`

---

## 1. Security & Authentication Architecture

All 17 endpoints mounted under `/api/internal/reviews/*` are strictly protected by `verifyInternalService`.

### Cryptographic Guarantees Verified at Runtime
1. **HMAC-SHA256 Request Signing:**  
   The string-to-sign binds:
   `METHOD:PATH:TIMESTAMP:NONCE:CALLER:ADMIN_ID:BODY_DIGEST`  
   Any modification to `x-admin-id`, URL, or body produces a signature mismatch (`401 Unauthorized`).
2. **Replay Protection via Nonce Cache:**  
   Every request must supply `x-internal-nonce`. Reusing a nonce within the 5-minute validity window is rejected (`401 Replay attack detected`). Verified in runtime unit test: **PASS**.
3. **Admin Identity Header (`x-admin-id`):**  
   Mandatory. Rejects empty/missing header with `401 Unauthorized`. Verified in runtime unit test: **PASS**.
4. **Timestamp Freshness:**  
   Enforces a strict ±5 minute clock-skew window. Requests with expired timestamps are rejected with `401 Unauthorized`.
5. **API Key Fallback:**  
   In `NODE_ENV=production`, direct API key fallback is disabled unless `ALLOW_INSECURE_INTERNAL_API_KEY=true`.

---

## 2. Complete 17-Endpoint Integration Matrix

| # | HTTP Method | Endpoint URL | Auth Mechanism | Request Body | Expected Response | Implementation Handler | Status |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/internal/reviews/applications` | HMAC-SHA256 (`x-admin-id`) | None (Query: `page`, `limit`, `status`) | `{ success: true, data: { applications, pagination } }` | `internalReview.controller.listApplications` | VERIFIED |
| 2 | GET | `/api/internal/reviews/applications/:applicationId` | HMAC-SHA256 (`x-admin-id`) | None | `{ success: true, data: { application, provider, verification, documents, auditLogs } }` | `internalReview.controller.getApplication` | VERIFIED |
| 3 | GET | `/api/internal/reviews/documents/:documentId` | HMAC-SHA256 (`x-admin-id`) | None | `{ success: true, data: { document } }` | `internalReview.controller.getDocumentInfo` | VERIFIED |
| 4 | GET | `/api/internal/reviews/documents/:documentId/download` | HMAC-SHA256 (`x-admin-id`) | None | Binary file stream (`inline; filename="..."`) | `internalReview.controller.downloadDocument` | VERIFIED (Local disk path dependent) |
| 5 | PATCH | `/api/internal/reviews/documents/:documentId/review` | HMAC-SHA256 (`x-admin-id`) | `{ decision: "approve" \| "reject", reason?: string }` | `{ success: true, message, data: { document } }` | `internalReview.controller.submitDocumentReview` | VERIFIED |
| 6 | PATCH | `/api/internal/reviews/providers/:providerId/verification/:stageName` | HMAC-SHA256 (`x-admin-id`) | `{ status: "verified" \| "rejected" \| "requires_action", reviewNotes, rejectionReason, verificationMethod, supportingDocumentIds }` | `{ success: true, message, data: { verification } }` | `internalReview.controller.submitStageVerification` | VERIFIED |
| 7 | PATCH | `/api/internal/reviews/applications/:applicationId/decide` | HMAC-SHA256 (`x-admin-id`) | `{ decision: "approved" \| "rejected" \| "under_review" \| "interview_required", reason?: string }` | `{ success: true, message, data: { application, provider, verification } }` | `internalReview.controller.submitApplicationDecision` | VERIFIED |
| 8 | GET | `/api/internal/reviews/providers/:providerId/history` | HMAC-SHA256 (`x-admin-id`) | None | `{ success: true, data: { auditLogs } }` | `internalReview.controller.getAuditHistory` | VERIFIED |
| 9 | GET | `/api/internal/reviews/services` | HMAC-SHA256 (`x-admin-id`) | None (Query: `status`, `page`, `limit`) | `{ success: true, data: services, pagination }` | `internalReview.controller.listServices` | VERIFIED |
| 10 | GET | `/api/internal/reviews/services/:id` | HMAC-SHA256 (`x-admin-id`) | None | `{ success: true, data: service }` | `internalReview.controller.getService` | VERIFIED |
| 11 | PATCH | `/api/internal/reviews/services/:id/review` | HMAC-SHA256 (`x-admin-id`) | `{ decision: "approved" \| "rejected", reason?: string }` | `{ success: true, message, data: service }` | `internalReview.controller.submitServiceReview` | VERIFIED |
| 12 | PATCH | `/api/internal/reviews/services/:id/suspend` | HMAC-SHA256 (`x-admin-id`) | `{ reason: string }` | `{ success: true, message, data: service }` | `internalReview.controller.submitServiceSuspension` | VERIFIED |
| 13 | PATCH | `/api/internal/reviews/services/:id/restore` | HMAC-SHA256 (`x-admin-id`) | `{ reason?: string }` | `{ success: true, message, data: service }` | `internalReview.controller.submitServiceRestoration` | VERIFIED |
| 14 | GET | `/api/internal/reviews/services/:id/history` | HMAC-SHA256 (`x-admin-id`) | None | `{ success: true, data: { service, auditLogs } }` | `internalReview.controller.getServiceAuditHistory` | VERIFIED |
| 15 | GET | `/api/internal/reviews/exceptional-cancellations` | HMAC-SHA256 (`x-admin-id`) | None (Query: `status`, `page`, `limit`) | `{ success: true, data: requests, pagination }` | `internalReview.controller.listExceptionalCancellations` | VERIFIED |
| 16 | GET | `/api/internal/reviews/exceptional-cancellations/:id` | HMAC-SHA256 (`x-admin-id`) | None | `{ success: true, data: request }` | `internalReview.controller.getExceptionalCancellation` | VERIFIED |
| 17 | PATCH | `/api/internal/reviews/exceptional-cancellations/:id/decide` | HMAC-SHA256 (`x-admin-id`) | `{ decision: "approve" \| "reject", reason: string }` | `{ success: true, message, data: { exceptionalRequest, serviceRequest } }` | `internalReview.controller.submitExceptionalCancellationDecision` | VERIFIED |

---

## 3. Database Updates in Client DB upon Admin Actions

1. **Application Approval (`PATCH /applications/:id/decide` with `decision: "approved"`):**
   - Strictly enforces prerequisites via `validateProviderApprovalPrerequisites`:
     - All 4 verification stages must be in `"verified"` status.
     - All mandatory documents must be in active `"approved"` status.
     - No active document can be in `"rejected"` status.
   - If prerequisites fail, rejects with HTTP 400 and detailed errors.
   - If passes:
     - `ProviderApplication.status` -> `"approved"`
     - `ProviderProfile.isApproved` -> `true`
     - `ProviderVerification.overallStatus` -> `"verified"`
     - Appends immutable `DocumentAuditLog` record.
2. **Document Review (`PATCH /documents/:id/review`):**
   - Updates `UserDocument.status` -> `"approved"` or `"rejected"`.
   - Records `reviewedBy: req.adminId` and `reviewedAt`.
   - Appends immutable `DocumentAuditLog` record.
3. **Service Moderation (`PATCH /services/:id/review`):**
   - Updates `Service.moderationStatus` -> `"approved"` or `"rejected"`.
   - Appends immutable `ServiceAuditLog` record.
4. **Service Suspension (`PATCH /services/:id/suspend`):**
   - Sets `Service.moderationStatus = "suspended"`.
   - Appends immutable `ServiceAuditLog` record.
5. **Exceptional Cancellation Decision (`PATCH /exceptional-cancellations/:id/decide`):**
   - If approved: cancels the target booking, records `cancelledBy: "admin"`, updates `ExceptionalCancellationRequest.status = "approved"`.
   - Appends immutable `ServiceAuditLog` record.

---

## 4. Identified Limitations & Recommendations

1. **In-Memory Nonce Cache:**  
   `usedNonceCache` is an in-memory `Map()`. In multi-instance / clustered production deployments, replace with an atomic Redis key (`SET nonce 1 EX 300 NX`).
2. **Local Storage for Document Streaming:**  
   `GET /documents/:documentId/download` uses `res.sendFile(resolvedPath)` reading from local disk `storage/documents/`. In containerized production environments, cloud presigned URLs (S3/Cloudinary) must be used.
