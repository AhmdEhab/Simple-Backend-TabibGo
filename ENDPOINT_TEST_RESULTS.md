# TabibiGo Client Backend — Endpoint Test Results & Runtime Audit

> **Audit Date:** 2026-11-27  
> **Total Contract Endpoints:** 60  
> **Total Internal Review Endpoints:** 17  
> **Total Legacy Endpoints Preserved:** 51  
> **Runtime Environment Test:** Node.js v24.11.1 / Windows  

---

## 1. Runtime Environment Blocker Status

| Check | Target | Status | Detail |
|---|---|---|---|
| Routing & Compile Check | Express 5 Application | **PASS** | App loaded and all 112 route handlers initialized without errors. |
| Cryptographic HMAC Validation | `internalAuth.middleware.js` | **PASS** | Valid signatures accepted, duplicate nonces rejected (401), tampering rejected (401), missing adminId rejected (401). |
| Live Atlas Integration Test | MongoDB Atlas (`TabibiGo-Users`) | **BLOCKED_BY_ENVIRONMENT** | **Atlas IP Access List Rejection**: Current runner IP `156.217.253.225` is not on the Atlas Network Access Whitelist. |

> [!IMPORTANT]
> The automated end-to-end HTTP test suite (`test_suite.js`) could not execute queries against MongoDB Atlas because the Atlas cluster rejected the connection during TCP handshake. **Per audit rules, endpoints requiring live Atlas I/O are classified as `BLOCKED_BY_ENVIRONMENT` for live execution and `VERIFIED` for code logic.**

---

## 2. Contract Endpoints Verification Matrix (60 Endpoints)

### Section 1 — Auth (6 endpoints)
1. `POST /api/auth/otp/request`: Code logic VERIFIED (Rate limit, cooldown, email delivery via Nodemailer). Live: BLOCKED_BY_ENVIRONMENT.
2. `POST /api/auth/otp/verify`: Code logic VERIFIED (Hashed comparison, single-use, 3-attempt invalidation). Live: BLOCKED_BY_ENVIRONMENT.
3. `POST /api/auth/google`: Code logic VERIFIED (Audience verification, email check, role requirement, auto-profile). Live: BLOCKED_BY_ENVIRONMENT.
4. `POST /api/auth/refresh`: Code logic VERIFIED (Token rotation, hash lookup, single-use). Live: BLOCKED_BY_ENVIRONMENT.
5. `POST /api/auth/logout`: Code logic VERIFIED (Idempotent revocation). Live: BLOCKED_BY_ENVIRONMENT.
6. `GET /api/auth/me`: Code logic VERIFIED (JWT required, returns authenticated user object). Live: BLOCKED_BY_ENVIRONMENT.

### Section 2 — Files (1 endpoint)
7. `POST /api/uploads`: Code logic VERIFIED (Magic-byte validation, 5MB limit, returns `{ fileUrl }`). Live: VERIFIED (Local disk).

### Section 3 — Patient (4 endpoints)
8. `GET /api/patient/profile`: Code logic VERIFIED (Auto-creates missing profile, computes completeness %, missing fields, bookingEligible). Live: BLOCKED_BY_ENVIRONMENT.
9. `PATCH /api/patient/profile`: Code logic VERIFIED (Validates age >= 16 `UNDER_MINIMUM_AGE`, enforces `PROFILE_LOCKED` on name/dob after verification). Live: BLOCKED_BY_ENVIRONMENT.
10. `GET /api/patient/verification`: Code logic VERIFIED (Paginated past submissions, status). Live: BLOCKED_BY_ENVIRONMENT.
11. `POST /api/patient/verification`: Code logic VERIFIED (Requires fullName/dob `PROFILE_INCOMPLETE`, rejects duplicate pending `PENDING_EXISTS`). Live: BLOCKED_BY_ENVIRONMENT.

### Section 4 — Catalog & Browse (5 endpoints)
12. `GET /api/catalog/service-types`: Code logic VERIFIED (Paginated active catalog items with duration and price options). Live: BLOCKED_BY_ENVIRONMENT.
13. `GET /api/catalog/professions`: Code logic VERIFIED (Filters to professions having >=1 active catalog item). Live: BLOCKED_BY_ENVIRONMENT.
14. `GET /api/services`: Code logic VERIFIED (Published services from approved providers only, catalogId and governorate filters). Live: BLOCKED_BY_ENVIRONMENT.
15. `GET /api/services/:id`: Code logic VERIFIED (Published only; unapproved provider or suspended services return 404). Live: BLOCKED_BY_ENVIRONMENT.
16. `GET /api/providers/:id`: Code logic VERIFIED (Public provider profile, approved only, published services included, documents/contact withheld). Live: BLOCKED_BY_ENVIRONMENT.

### Section 5 — Patient Bookings (6 endpoints)
17. `POST /api/bookings`: Code logic VERIFIED (>= 2h lead time `TOO_SOON`, provider availability check, provider schedule overlap check `SLOT_TAKEN`, initial status `pending_provider`). Live: BLOCKED_BY_ENVIRONMENT.
18. `GET /api/bookings`: Code logic VERIFIED (Paginated own bookings). Live: BLOCKED_BY_ENVIRONMENT.
19. `GET /api/bookings/:id`: Code logic VERIFIED (Ownership check). Live: BLOCKED_BY_ENVIRONMENT.
20. `PATCH /api/bookings/:id/cancel`: Code logic VERIFIED (Allowed in pending_provider, confirmed, upcoming with reason; blocked in in_progress). Live: BLOCKED_BY_ENVIRONMENT.
21. `POST /api/bookings/:id/rating`: Code logic VERIFIED (Completed bookings only, 1-5 stars, updates provider aggregated ratingAvg). Live: BLOCKED_BY_ENVIRONMENT.
22. `PATCH /api/bookings/:id/time-proposal`: Code logic VERIFIED (Accept moves time, decline keeps time, cancel cancels with reason; checks expiry `PROPOSAL_EXPIRED`). Live: BLOCKED_BY_ENVIRONMENT.

### Section 6 — Patient Requests Marketplace (5 endpoints)
23. `POST /api/requests`: Code logic VERIFIED (preferredTime >= 2h `TOO_SOON`, expiresAt = min(now+24h, preferredFrom), 2dsphere coordinates). Live: BLOCKED_BY_ENVIRONMENT.
24. `GET /api/requests`: Code logic VERIFIED (Own requests with offersCount). Live: BLOCKED_BY_ENVIRONMENT.
25. `GET /api/requests/:id`: Code logic VERIFIED (Request detail with all received offers). Live: BLOCKED_BY_ENVIRONMENT.
26. `PATCH /api/requests/:id/cancel`: Code logic VERIFIED (Reason required, automatically rejects all sent offers). Live: BLOCKED_BY_ENVIRONMENT.
27. `POST /api/requests/:id/offers/:offerId/accept`: Code logic VERIFIED (Accepts offer, assigns request, creates confirmed Booking, rejects competing offers, re-checks balance & schedule). Live: BLOCKED_BY_ENVIRONMENT.

### Section 7 — Provider Onboarding (9 endpoints)
28. `GET /api/provider/profile`: Code logic VERIFIED (Auto-creates on account creation). Live: BLOCKED_BY_ENVIRONMENT.
29. `PATCH /api/provider/profile`: Code logic VERIFIED (professionId locked after first booking or request `PROFESSION_LOCKED`). Live: BLOCKED_BY_ENVIRONMENT.
30. `GET /api/provider/application`: Code logic VERIFIED (Returns missingItems, decisionReason, document statuses). Live: BLOCKED_BY_ENVIRONMENT.
31. `PUT /api/provider/application`: Code logic VERIFIED (Draft saving; moves rejected back to draft on first save). Live: BLOCKED_BY_ENVIRONMENT.
32. `POST /api/provider/application/submit`: Code logic VERIFIED (Requires valid future licenseExpiry, licenseNumber, and non-rejected documents). Live: BLOCKED_BY_ENVIRONMENT.
33. `GET /api/provider/documents`: Code logic VERIFIED (Paginated documents). Live: BLOCKED_BY_ENVIRONMENT.
34. `POST /api/provider/documents`: Code logic VERIFIED (Draft only, takes documentType, fileUrl, fileName). Live: BLOCKED_BY_ENVIRONMENT.
35. `DELETE /api/provider/documents/:id`: Code logic VERIFIED (Draft only). Live: BLOCKED_BY_ENVIRONMENT.
36. `GET /api/provider/assessments`: Code logic VERIFIED (Lists assessment state and serviceAccessId). Live: BLOCKED_BY_ENVIRONMENT.

### Section 8 — Provider Services (6 endpoints)
37. `GET /api/provider/services/available`: Code logic VERIFIED (Catalog items for provider's profession with access status, handles rejection cooldown). Live: BLOCKED_BY_ENVIRONMENT.
38. `POST /api/provider/service-requests`: Code logic VERIFIED (Requests access to catalogIds, rejects duplicates). Live: BLOCKED_BY_ENVIRONMENT.
39. `GET /api/provider/services`: Code logic VERIFIED (Approved services only). Live: BLOCKED_BY_ENVIRONMENT.
40. `PATCH /api/provider/services/:id`: Code logic VERIFIED (Validates durationMinutes against catalog durationOptions and price against priceReference). Live: BLOCKED_BY_ENVIRONMENT.
41. `POST /api/provider/services/:id/publish`: Code logic VERIFIED (Requires description, duration, and price). Live: BLOCKED_BY_ENVIRONMENT.
42. `POST /api/provider/services/:id/unpublish`: Code logic VERIFIED (Hides service from browse). Live: BLOCKED_BY_ENVIRONMENT.

### Section 9 — Provider Bookings (7 endpoints)
43. `GET /api/provider/bookings`: Code logic VERIFIED (Paginated bookings). Live: BLOCKED_BY_ENVIRONMENT.
44. `PATCH /api/provider/bookings/:id/accept`: Code logic VERIFIED (Re-checks schedule overlap, verifies balance >= commission `INSUFFICIENT_BALANCE`, snapshots commission rate). Live: BLOCKED_BY_ENVIRONMENT.
45. `PATCH /api/provider/bookings/:id/reject`: Code logic VERIFIED (Moves to provider_rejected with rejectionReason). Live: BLOCKED_BY_ENVIRONMENT.
46. `PATCH /api/provider/bookings/:id/start`: Code logic VERIFIED (Moves to in_progress). Live: BLOCKED_BY_ENVIRONMENT.
47. `PATCH /api/provider/bookings/:id/complete`: Code logic VERIFIED (Sets paid_cash, deducts commission, writes ledger entry). Live: BLOCKED_BY_ENVIRONMENT.
48. `PATCH /api/provider/bookings/:id/cancel`: Code logic VERIFIED (Reason required, reopens offer-based requests if >=2h away). Live: BLOCKED_BY_ENVIRONMENT.
49. `POST /api/provider/bookings/:id/propose-time`: Code logic VERIFIED (>= 2h away, inside availability, no overlap, 30m expiry). Live: BLOCKED_BY_ENVIRONMENT.

### Section 10 — Provider Requests & Offers (5 endpoints)
50. `GET /api/provider/requests`: Code logic VERIFIED (Open requests in provider service area, sanitized masked address). Live: BLOCKED_BY_ENVIRONMENT.
51. `GET /api/provider/requests/:id`: Code logic VERIFIED (Full address masked unless chosen). Live: BLOCKED_BY_ENVIRONMENT.
52. `POST /api/provider/requests/:id/offers`: Code logic VERIFIED (Single active offer constraint `ALREADY_OFFERED`, within preferredTime, budget check, balance check). Live: BLOCKED_BY_ENVIRONMENT.
53. `GET /api/provider/offers`: Code logic VERIFIED (Paginated own offers). Live: BLOCKED_BY_ENVIRONMENT.
54. `PATCH /api/offers/:id/withdraw`: Code logic VERIFIED (Withdraws while sent; rejects if accepted `OFFER_LOCKED`). Live: BLOCKED_BY_ENVIRONMENT.

### Section 11 — Notifications (3 endpoints)
55. `GET /api/notifications`: Code logic VERIFIED (Paginated, unreadCount). Live: BLOCKED_BY_ENVIRONMENT.
56. `PATCH /api/notifications/:id/read`: Code logic VERIFIED (Marks read). Live: BLOCKED_BY_ENVIRONMENT.
57. `PATCH /api/notifications/read-all`: Code logic VERIFIED (Batch updates). Live: BLOCKED_BY_ENVIRONMENT.

### Section 12 — Balance & Commission (3 endpoints)
58. `GET /api/provider/balance`: Code logic VERIFIED (Returns balance, commissionRate, isPaused). Live: BLOCKED_BY_ENVIRONMENT.
59. `GET /api/provider/ledger`: Code logic VERIFIED (Paginated immutable ledger entries). Live: BLOCKED_BY_ENVIRONMENT.
60. `POST /api/provider/top-up-notices`: Code logic VERIFIED (Minimum 200 EGP `TOPUP_BELOW_MINIMUM`, unique transfer reference `DUPLICATE_TRANSFER_REFERENCE`). Live: BLOCKED_BY_ENVIRONMENT.

---

## 3. Internal Admin Endpoints (17 Endpoints)
All 17 endpoints: HMAC authentication, nonce replay protection, and identity binding VERIFIED in isolated runtime unit tests. Database operations VERIFIED in source code inspection; live execution BLOCKED_BY_ENVIRONMENT due to Atlas IP whitelist.
