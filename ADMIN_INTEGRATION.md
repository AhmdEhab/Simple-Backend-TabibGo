# TabibiGo Admin Backend Integration Contract & API Guide

> **Architecture Rule:** The Client Backend and Admin Backend use **separate databases**.  
> Direct shared database modification is **prohibited**.  
> All administrative reviews, verification actions, and document streaming are conducted strictly through the authenticated internal service-to-service API.

---

## 1. Authentication & Security Mechanism

All endpoints mounted under `/api/internal/reviews/*` require internal service authentication.

### Authentication Methods Supported

The internal middleware ([src/middleware/internalAuth.middleware.js](file:///c:/Users/aehab/OneDrive/سطح%20المكتب/TabibiGo_Backend/src/middleware/internalAuth.middleware.js)) accepts either of two authentication mechanisms:

#### Method 1: HMAC-SHA256 Signature with Replay Protection (Recommended for Production)
The Admin Backend computes an HMAC-SHA256 digest over the request method, path, timestamp, and body.

**Required Headers:**
```http
x-internal-signature: <hex_encoded_hmac_sha256>
x-internal-timestamp: <unix_epoch_milliseconds>
x-internal-nonce: <unique_hex_or_uuid_string>
x-internal-caller: admin-backend
x-admin-id: <admin_user_id_or_email>
Content-Type: application/json
```

**Signature Calculation Algorithm (Node.js / Express):**
```javascript
const crypto = require("crypto");

const method = req.method.toUpperCase();
const path = req.originalUrl || req.url; // e.g. "/api/internal/reviews/applications"
const timestamp = Date.now().toString();
const nonce = crypto.randomBytes(16).toString("hex");
const caller = "admin-backend";
const adminId = "admin_reviewer_1"; // Authenticated reviewer identity

// Compute SHA-256 digest of JSON request body (or empty string if no body)
let bodyDigest = "";
if (req.body && Object.keys(req.body).length > 0) {
  bodyDigest = crypto.createHash("sha256").update(JSON.stringify(req.body)).digest("hex");
}

// Binds all critical context to prevent replay and adminId tampering:
const stringToSign = `${method}:${path}:${timestamp}:${nonce}:${caller}:${adminId}:${bodyDigest}`;
const signature = crypto
  .createHmac("sha256", process.env.INTERNAL_SERVICE_SECRET)
  .update(stringToSign)
  .digest("hex");
```

- **Replay Protection Guarantee:**
  - Nonces are tracked in a TTL cache; replaying the exact same request or reusing an existing nonce returns `401 Unauthorized: Replay attack detected: Nonce has already been used.`
  - Requests with timestamps deviating by more than **5 minutes** (`300,000 ms`) from server time are rejected with `401 Unauthorized: Internal request timestamp expired or clock skew exceeded.`

#### Method 2: Internal API Key Header (Staging / Development)
For staging environments or simpler gateway setups, pass the pre-shared key header:
```http
x-internal-api-key: <INTERNAL_API_KEY>
x-internal-caller: admin-backend
x-admin-id: <admin_user_id_or_email>
Content-Type: application/json
```

---

## 2. Internal Review Endpoints Reference

Base Path: `/api/internal/reviews`

### 1. List Pending Applications
- **Method:** `GET`
- **URL:** `/api/internal/reviews/applications`
- **Query Parameters:**
  - `page`: Integer (default: `1`).
  - `limit`: Integer (default: `20`).
  - `status`: String, optional (`"submitted"`, `"under_review"`, `"interview_required"`). Defaults to all pending statuses.
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Pending applications retrieved successfully.",
    "data": {
      "applications": [
        {
          "_id": "673f4e24a8b1234567896666",
          "providerId": {
            "_id": "673f4e24a8b1234567894444",
            "fullName": "Sara Ibrahim",
            "professionId": {
              "_id": "673f4e24a8b1234567891111",
              "name": "Nurse"
            }
          },
          "licenseNumber": "NUR-98765-EG",
          "licenseExpiry": "2029-12-31T00:00:00.000Z",
          "status": "submitted",
          "submittedAt": "2026-11-23T20:40:00.000Z"
        }
      ],
      "pagination": {
        "total": 1,
        "page": 1,
        "limit": 20,
        "pages": 1
      }
    }
  }
  ```

---

### 2. Get Complete Application Details
- **Method:** `GET`
- **URL:** `/api/internal/reviews/applications/:applicationId`
- **Purpose:** Fetches full application profile, active documents, verification stages, and audit history.
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Application details retrieved successfully.",
    "data": {
      "application": { ... },
      "provider": { ... },
      "verification": {
        "overallStatus": "in_progress",
        "identityVerification": { "status": "not_started" },
        "licenseVerification": { "status": "not_started" },
        "experienceVerification": { "status": "not_started" },
        "skillsAssessment": { "status": "not_started" }
      },
      "documents": [ ... ],
      "auditLogs": [ ... ]
    }
  }
  ```

---

### 3. Get Document Metadata
- **Method:** `GET`
- **URL:** `/api/internal/reviews/documents/:documentId`
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Document metadata retrieved successfully.",
    "data": {
      "document": {
        "_id": "673f4e24a8b1234567895555",
        "userId": "673f4e24a8b123456789cdef",
        "documentType": "nursing_practice_license",
        "originalFileName": "nurse_license_v2.pdf",
        "mimeType": "application/pdf",
        "fileSize": 142500,
        "status": "pending_review",
        "version": 2,
        "previousDocumentId": "673f4e24a8b1234567891111",
        "isActiveVersion": true
      }
    }
  }
  ```

---

### 4. Secure Private Document Download for Admin Reviewer
- **Method:** `GET`
- **URL:** `/api/internal/reviews/documents/:documentId/download`
- **Purpose:** Streams the private file directly to the authenticated Admin Reviewer without exposing disk paths.
- **Success Response (200 OK):**
  - Binary file stream.
  - Header: `Content-Type: application/pdf` (or image type).
  - Header: `Content-Disposition: inline; filename="nurse_license_v2.pdf"`.

---

### 5. Approve or Reject an Individual Document
- **Method:** `PATCH`
- **URL:** `/api/internal/reviews/documents/:documentId/review`
- **Request Body:**
  ```json
  {
    "decision": "approve",
    "reason": "MOHP License confirmed against government registry."
  }
  ```
  - `decision`: String, required (`"approve"` or `"reject"`).
  - `reason`: String, optional for approval; strongly recommended for rejection.
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Document approved successfully.",
    "data": {
      "document": {
        "_id": "673f4e24a8b1234567895555",
        "status": "approved",
        "reviewedAt": "2026-11-23T23:55:00.000Z",
        "reviewedBy": "admin_reviewer_1"
      }
    }
  }
  ```

---

### 6. Record Independent Verification Stage Decision
- **Method:** `PATCH`
- **URL:** `/api/internal/reviews/providers/:providerId/verification/:stageName`
- **Path Parameters:**
  - `providerId`: MongoDB ObjectId of ProviderProfile.
  - `stageName`: One of:
    - `identityVerification`
    - `licenseVerification`
    - `experienceVerification`
    - `skillsAssessment`
- **Request Body:**
  ```json
  {
    "status": "verified",
    "reviewNotes": "Confirmed with Ministry of Health registry.",
    "verificationMethod": "online_syndicate_registry_check",
    "supportingDocumentIds": ["673f4e24a8b1234567895555"]
  }
  ```
  - `status`: String, required (`"pending"`, `"under_review"`, `"verified"`, `"rejected"`, `"requires_action"`).
  - `reviewNotes`: String, optional.
  - `rejectionReason`: String, optional.
  - `verificationMethod`: String, optional (e.g. `"online_syndicate_registry_check"`, `"in_person_clinical_interview"`, `"manual_document_review"`).
  - `supportingDocumentIds`: Array of Document ObjectIds, optional.
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Verification stage 'licenseVerification' updated successfully.",
    "data": {
      "verification": {
        "overallStatus": "in_progress",
        "licenseVerification": {
          "status": "verified",
          "reviewNotes": "Confirmed with Ministry of Health registry.",
          "reviewedBy": "admin_reviewer_1",
          "reviewedAt": "2026-11-23T23:55:00.000Z",
          "verificationMethod": "online_syndicate_registry_check"
        }
      }
    }
  }
  ```

---

### 7. Decide Provider Application
- **Method:** `PATCH`
- **URL:** `/api/internal/reviews/applications/:applicationId/decide`
- **Request Body:**
  ```json
  {
    "decision": "approve",
    "reason": "All documents verified and clinical skills interview passed."
  }
  ```
  - `decision`: String, required (`"approve"`, `"reject"`, `"interview_required"`, `"under_review"`).
  - `reason`: String, optional.
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Application decided as 'approve' successfully.",
    "data": {
      "application": {
        "_id": "673f4e24a8b1234567896666",
        "status": "approved",
        "decidedAt": "2026-11-23T23:58:00.000Z",
        "decidedByAdminId": "admin_reviewer_1",
        "decisionReason": "All documents verified and clinical skills interview passed."
      },
      "provider": {
        "_id": "673f4e24a8b1234567894444",
        "isApproved": true
      }
    }
  }
  ```

---

### 8. Get Provider Audit History
- **Method:** `GET`
- **URL:** `/api/internal/reviews/providers/:providerId/history`
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Provider audit history retrieved successfully.",
    "data": {
      "provider": { ... },
      "applications": [ ... ],
      "documents": [ ... ],
      "logs": [
        {
          "targetType": "application",
          "action": "application_approved",
          "previousStatus": "submitted",
          "newStatus": "approved",
          "actorType": "admin",
          "actorId": "admin_reviewer_1",
          "timestamp": "2026-11-23T23:58:00.000Z"
        }
      ]
    }
  }
  ```

---

## 3. Services Moderation API Endpoints

### 9. List Services for Admin Moderation
- **Method:** `GET`
- **URL:** `/api/internal/reviews/services`
- **Query Parameters:**
  - `page`: Page number (default: `1`)
  - `limit`: Items per page (default: `20`)
  - `moderationStatus`: Filter by status (`pending_review`, `under_review`, `approved`, `rejected`, `suspended`)
  - `publicationStatus`: Filter by publication status (`draft`, `published`, `hidden`, `archived`)
  - `professionId`: Filter by profession ObjectId
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "_id": "6740b...",
        "title": "Elderly Nursing & Wound Care",
        "description": "Comprehensive sterile dressing and home care.",
        "price": 400,
        "currency": "EGP",
        "durationMinutes": 60,
        "publicationStatus": "published",
        "moderationStatus": "pending_review",
        "providerId": {
          "_id": "6740a...",
          "fullName": "Sarah Ahmed",
          "isApproved": true
        },
        "professionId": {
          "_id": "67409...",
          "name": "Nurse"
        }
      }
    ],
    "pagination": { "total": 1, "page": 1, "limit": 20, "pages": 1 }
  }
  ```

---

### 10. Get Service Details for Moderation
- **Method:** `GET`
- **URL:** `/api/internal/reviews/services/:id`
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "_id": "6740b...",
      "title": "Elderly Nursing & Wound Care",
      "description": "Comprehensive sterile dressing.",
      "price": 400,
      "durationMinutes": 60,
      "publicationStatus": "published",
      "moderationStatus": "pending_review",
      "providerId": {
        "_id": "6740a...",
        "fullName": "Sarah Ahmed",
        "userId": {
          "email": "sarah.nurse@example.com",
          "isActive": true,
          "emailVerified": true
        }
      }
    }
  }
  ```

---

### 11. Moderate Service (Approve or Reject)
- **Method:** `PATCH`
- **URL:** `/api/internal/reviews/services/:id/review`
- **Request Body:**
  ```json
  {
    "decision": "approve" // or "reject"
    // "rejectionReason": "Clinical description does not meet platform standards." (Required if decision is reject)
  }
  ```
- **Business Behavior:**
  - `approve`: Sets `moderationStatus = "approved"`. Service remains `published`.
  - `reject`: Sets `moderationStatus = "rejected"` and **automatically sets `publicationStatus = "hidden"`** so patients cannot discover or book it.
  - Automatically records an immutable entry in `ServiceAuditLog`.
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Service moderation approved successfully.",
    "data": {
      "_id": "6740b...",
      "publicationStatus": "published",
      "moderationStatus": "approved",
      "reviewedBy": "admin_reviewer_1",
      "reviewedAt": "2026-11-24T00:30:00.000Z"
    }
  }
  ```

---

### 12. Suspend Service
- **Method:** `PATCH`
- **URL:** `/api/internal/reviews/services/:id/suspend`
- **Request Body:**
  ```json
  {
    "suspensionReason": "Clinical safety investigation active."
  }
  ```
- **Business Behavior:**
  - Sets `moderationStatus = "suspended"`.
  - Sets `publicationStatus = "hidden"`.
  - Providers cannot edit suspended services until lifted.
  - Automatically records an immutable entry in `ServiceAuditLog`.
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Service suspended successfully.",
    "data": {
      "_id": "6740b...",
      "publicationStatus": "hidden",
      "moderationStatus": "suspended",
      "suspensionReason": "Clinical safety investigation active.",
      "reviewedBy": "admin_reviewer_1",
      "reviewedAt": "2026-11-24T00:35:00.000Z"
    }
  }
  ```

---

### 13. Get Service Audit & Moderation History
- **Method:** `GET`
- **URL:** `/api/internal/reviews/services/:id/history`
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "service": { ... },
      "logs": [
        {
          "targetType": "service",
          "action": "service_moderation_approved",
          "actorType": "admin",
          "actorId": "admin_reviewer_1",
          "previousStatus": "pending_review",
          "newStatus": "approved",
          "timestamp": "2026-11-24T00:30:00.000Z"
        }
      ]
    }
  }
  ```

---

### 14. Restore Service (Lift Suspension / Rejection)
- **Method:** `PATCH`
- **URL:** `/api/internal/reviews/services/:id/restore`
- **Description:** Restores an eligible service that was previously `suspended` or `rejected` by an administrator back to `approved` moderation status.
- **Request Body:**
  ```json
  {
    "restorationReason": "Investigation concluded; documentation and safety verified."
  }
  ```
- **Business & Security Rules:**
  - **Eligibility Gate:** Fails with `400 Bad Request` if the service's current `moderationStatus` is NOT `suspended` or `rejected`. Already `approved` or `pending_review` services cannot be restored.
  - **Provider Prerequisite Gate:** Fails with `400 Bad Request` if the Provider is not currently approved, active, and verified. A service cannot be restored if its provider has an active disqualification.
  - **Provider Intent Preservation (No Auto-Republishing):** The system checks historical audit logs (`ServiceAuditLog`). If the Provider had intentionally set the service to `hidden`, `draft`, or `archived` before the administrative action, the service's moderation status is updated to `approved`, but its publication status **remains hidden or archived**. It is **never automatically republished** against the provider's explicit intent.
  - **Audit Trail:** Automatically generates an immutable `service_restored` audit entry recording the admin identity, reason, previous moderation status, new moderation status, and timestamp.
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Service restored successfully.",
    "data": {
      "_id": "6740b...",
      "publicationStatus": "published", // or "hidden" if previously hidden by provider
      "moderationStatus": "approved",
      "rejectionReason": null,
      "suspensionReason": null,
      "reviewedBy": "admin_reviewer_1",
      "reviewedAt": "2026-11-24T01:05:00.000Z"
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`:
    ```json
    {
      "success": false,
      "message": "Service is not eligible for restoration. Current moderation status is 'approved'. Only 'suspended' or 'rejected' services can be restored."
    }
    ```
  - `400 Bad Request` (Provider Unapproved):
    ```json
    {
      "success": false,
      "message": "Cannot restore service: Provider is not currently approved or their verification has been revoked."
    }
    ```

---

## 4. Service Lifecycle, Editing, Re-Moderation & Booking Rules

### 1. Service Editing & Re-Moderation Policy
When a Provider updates an existing service via `PUT /api/services/:id`:
- **Minor Changes (No Re-moderation):** Adjusting pricing (`price`), currency, or service thumbnail does not compromise patient safety. The service's current moderation status is preserved, and the edit is recorded as `service_updated`.
- **Material Changes (Triggers Re-moderation):** Material changes to clinical scope, treatment title (`title`), medical description (`description`), session duration (`durationMinutes`), medical category (`categoryId`), or geographic coverage (`serviceAreas`) automatically:
  1. Increment the service's `version` counter (`version += 1`).
  2. Reset `moderationStatus` to `pending_review`.
  3. Create an immutable `service_re_moderation_triggered` audit entry.
  4. Preserve all historical review comments, reviewer IDs, and timestamps in `ServiceAuditLog`.

### 2. Impact on Existing `ServiceRequests` When a Service State Changes
When a service is rejected, suspended, hidden, or archived:
- **New Bookings Blocked:** The discovery API immediately filters out the service, and `POST /api/service-requests` rejects any new booking attempts with `400 Bad Request`.
- **Historical Data Preserved:** All existing `ServiceRequest` records remain intact for legal, clinical, and financial accounting.
- **Confirmed Bookings Protection (No Silent Cancellation):** Active or confirmed bookings (`pending`, `accepted`, `confirmed`, `in_progress`) are **never silently deleted or cancelled**.
- **Cancellation & Notification Policy:**
  - If a service suspension is due to imminent medical danger or fraud, an Admin or Provider must explicitly cancel the affected bookings via authenticated status endpoints, supplying a documented `cancellationReason`.
  - The cancellation is recorded in `ServiceAuditLog` with `actorType: "admin"` or `"system"`.
  - Out-of-band notifications (SMS / Push / Email) alert the affected patient and provider immediately.

### 3. Independence of Provider Verification and Service Moderation
- **Strict Hierarchy:** Provider verification and Service moderation operate on independent state models, but **Provider Verification is a mandatory prerequisite for Service availability**.
- **Automated Cascade on Revocation:** If a Provider's verification is revoked, suspended, or rejected (e.g. through credential change or admin disciplinary action):
  - `ProviderProfile.isApproved` is set to `false`.
  - `syncProviderServiceStatusOnRevocation` automatically sets `publicationStatus = "hidden"` on all active services of that provider.
  - The discovery engine enforces `provider.isApproved === true` on every lookup. Even if a service has `moderationStatus: "approved"`, it is mathematically impossible for patients to discover or book it if the provider is unverified or disqualified.

### 4. Admin Role-Based Access Control (RBAC) Specification
The Admin Backend must enforce the following permission boundaries before issuing HMAC-signed requests to the Client Backend:

| Admin RBAC Role | Permitted Actions | Endpoints Accessible |
|---|---|---|
| **Support / Viewer** (`support_agent`) | View services, inspect moderation history, stream provider credentials. Cannot change states. | `GET /services`, `GET /services/:id`, `GET /services/:id/history`, `GET /documents/:id/download` |
| **Clinical Moderator** (`clinical_moderator`) | Review medical scope, approve or reject newly published services. | `GET /services`, `PATCH /services/:id/review` |
| **Trust & Safety Lead** (`safety_officer`) | Temporarily suspend services for investigation; restore eligible services after compliance clearance. | `PATCH /services/:id/suspend`, `PATCH /services/:id/restore` |
| **System Superadmin** (`superadmin`) | Full authority across provider applications, verification stages, document decisions, and service lifecycles. | All endpoints (`/applications/*`, `/providers/*`, `/documents/*`, `/services/*`) |

---

### 5. Exceptional Cancellation Requests & Support Intervention Endpoints

When a Patient or Provider requires cancellation under 60 minutes prior to session start, or when intervention is needed for in-progress sessions, they submit an exceptional request. The Admin Backend reviews and decides on these requests via service-to-service endpoints:

#### A. List Exceptional Cancellation Requests
- **Method:** `GET`
- **Path:** `/api/internal/reviews/exceptional-cancellations`
- **Query Params:** `?page=1&limit=20&status=pending_review` (or `approved`, `rejected`)
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "6741df...",
      "serviceRequestId": { ... },
      "requesterId": { "email": "patient@example.com", "role": "patient" },
      "requesterRole": "patient",
      "reason": "Sudden medical hospitalization",
      "supportingDetails": "Admitted to St. Mary ER",
      "status": "pending_review",
      "requestBookingStatusAtSubmission": "confirmed",
      "createdAt": "2026-11-24T00:00:00.000Z"
    }
  ],
  "pagination": { "total": 1, "page": 1, "limit": 20, "pages": 1 }
}
```

#### B. Get Exceptional Cancellation Details
- **Method:** `GET`
- **Path:** `/api/internal/reviews/exceptional-cancellations/:id`
- **Response `200 OK`:** Detailed request with populated booking, patient, provider, and service info.

#### C. Decide Exceptional Cancellation Request
- **Method:** `PATCH`
- **Path:** `/api/internal/reviews/exceptional-cancellations/:id/decide`
- **Request Body:**
```json
{
  "decision": "approve", // or "reject"
  "decisionReason": "Hospitalization records verified; full waiver approved"
}
```
- **Response `200 OK` (when approved):**
```json
{
  "success": true,
  "message": "Exceptional cancellation request approved successfully.",
  "data": {
    "exceptionalRequest": {
      "_id": "6741df...",
      "status": "approved",
      "decidedByAdminId": "admin_reviewer_1",
      "adminDecisionReason": "Hospitalization records verified; full waiver approved",
      "decidedAt": "2026-11-24T00:05:00.000Z"
    },
    "booking": {
      "_id": "6741de...",
      "status": "cancelled",
      "cancelledBy": "admin",
      "cancellationReason": "Admin approved exceptional cancellation (patient): Hospitalization records verified; full waiver approved",
      "cancelledAt": "2026-11-24T00:05:00.000Z"
    }
  }
}
```
- **Response `200 OK` (when rejected):**
  - Booking status remains unchanged.
  - `exceptionalRequest.status` updated to `rejected`.
  - Rejection reason recorded with Admin ID.

---

## 5. Required Environment Configuration for Admin Backend

Add these to your Admin Backend's `.env`:

```env
CLIENT_BACKEND_INTERNAL_URL=http://localhost:5000/api/internal/reviews
INTERNAL_SERVICE_SECRET=<strong_shared_hmac_secret>
INTERNAL_API_KEY=<strong_shared_api_key>
```
