# TabibiGo Client Backend — Database & Model Verification Checklist

> **Database:** MongoDB Atlas (`TabibiGo-Users`)  
> **ORM:** Mongoose  
> **Audit Date:** 2026-11-27

---

## 1. Model Inventory & Schema Audits

### 1.1 `Booking` (`Bookings` collection) — NEW
- **Schema & References:**
  - `patientId`: `ObjectId -> PatientProfile` (Indexed)
  - `patientUserId`: `ObjectId -> User` (Indexed)
  - `providerId`: `ObjectId -> ProviderProfile` (Indexed)
  - `providerUserId`: `ObjectId -> User` (Indexed)
  - `serviceId`: `ObjectId -> Service` (Indexed)
  - `catalogId`: `ObjectId -> ServiceCatalog` (Optional)
  - `ratingId`: `ObjectId -> Rating`
  - `timeProposalId`: `ObjectId -> TimeProposal`
- **Statuses:** `pending_provider`, `confirmed`, `upcoming`, `in_progress`, `completed`, `provider_rejected`, `cancelled`
- **Snapshots:** `priceSnapshot`, `currencySnapshot`, `commissionRateSnapshot`, `commissionAmountSnapshot`, `durationMinutes`
- **Compound Indexes:**
  - `{ providerId: 1, scheduledAt: 1, status: 1 }` (Calendar overlap detection)
  - `{ patientUserId: 1, createdAt: -1 }`
  - `{ providerUserId: 1, createdAt: -1 }`
- **Integrity Status:** VERIFIED.

---

### 1.2 `ServiceRequest` (`Service_Requests` collection) — LEGACY PRESERVED
- **Schema & References:** Preserved without modification.
- **Statuses:** `pending`, `accepted`, `rejected`, `cancelled`, `confirmed`, `in_progress`, `completed`
- **Backward Compatibility:** All existing booking records remain accessible through legacy routes `/api/service-requests/*`.
- **Integrity Status:** VERIFIED.

---

### 1.3 `PatientRequest` (`Patient_Requests` collection) — NEW
- **Schema & References:**
  - `patientId`: `ObjectId -> PatientProfile` (Indexed)
  - `catalogId`: `ObjectId -> ServiceCatalog` (Indexed)
  - `coordinates`: GeoJSON Point with `2dsphere` index
  - `preferredTime`: `{ from: Date, to: Date }`
  - `status`: `open`, `assigned`, `cancelled`, `expired`
- **Compound Indexes:**
  - `{ status: 1, expiresAt: 1, "address.governorate": 1 }`
  - `{ coordinates: "2dsphere" }` (sparse)
- **Integrity Status:** VERIFIED.

---

### 1.4 `Offer` (`Offers` collection) — NEW
- **Schema & References:**
  - `requestId`: `ObjectId -> PatientRequest` (Indexed)
  - `providerId`: `ObjectId -> ProviderProfile` (Indexed)
  - `providerUserId`: `ObjectId -> User` (Indexed)
- **Unique Constraint:**
  - Compound index `{ requestId: 1, providerId: 1 }, { unique: true }` strictly enforces one active offer per provider per request (`ALREADY_OFFERED`).
- **Statuses:** `sent`, `accepted`, `rejected`, `withdrawn`, `locked`
- **Integrity Status:** VERIFIED.

---

### 1.5 `ServiceCatalog` (`Service_Catalog` collection) — NEW
- **Schema:**
  - `professionId`: `ObjectId -> Profession` (Indexed)
  - `name`: String, required, trimmed
  - `durationOptions`: `[Number]` (e.g. `[30, 60, 90]`)
  - `priceReference`: `{ type, min, max }`
- **Unique Constraint:**
  - `{ professionId: 1, name: 1 }, { unique: true }` prevents duplicate catalog names under the same profession.
- **Integrity Status:** VERIFIED.

---

### 1.6 `ServiceAccess` (`Service_Access` collection) — NEW
- **Schema:**
  - `providerId`: `ObjectId -> ProviderProfile` (Indexed)
  - `catalogId`: `ObjectId -> ServiceCatalog` (Indexed)
  - `status`: `not_requested`, `requested`, `in_assessment`, `approved`, `rejected`, `revoked`
  - `rejectionCooldownUntil`: Date (enforces 30-day re-request cooldown)
- **Unique Constraint:**
  - `{ providerId: 1, catalogId: 1 }, { unique: true }` guarantees unique access record per provider and catalog item.
- **Integrity Status:** VERIFIED.

---

### 1.7 `ProviderBalance` (`Provider_Balances` collection) — NEW
- **Schema:**
  - `providerId`: `ObjectId -> ProviderProfile` (Unique index)
  - `balance`: Number (default `0`)
  - `commissionRate`: Number (default `0.15`, 15%)
  - `isPaused`: Boolean (true when balance <= 0)
- **Integrity Status:** VERIFIED.

---

### 1.8 `Ledger` (`Ledger_Entries` collection) — NEW
- **Schema:**
  - `providerId`: `ObjectId -> ProviderProfile` (Indexed)
  - `type`: `commission_deducted`, `topup_applied`, `adjustment`, `payout`
  - `amount`: Number
  - `balanceAfter`: Number
- **Append-Only Immutability:**
  - Pre-hooks on `updateOne`, `updateMany`, `findOneAndUpdate`, `deleteOne`, `deleteMany`, `findOneAndDelete` unconditionally throw an Error. Deletions and modifications are impossible at application level.
- **Integrity Status:** VERIFIED.

---

### 1.9 `TopUpNotice` (`Top_Up_Notices` collection) — NEW
- **Schema:**
  - `providerId`: `ObjectId -> ProviderProfile` (Indexed)
  - `transferReference`: String, unique (enforces duplicate prevention)
  - `amount`: Number, minimum 200 EGP
  - `status`: `pending`, `matched`, `rejected`
- **Integrity Status:** VERIFIED.

---

## 2. Backward Compatibility & Migration Checklist

| Item | Action Required | Risk Level | Details |
|---|---|---|---|
| Existing `UserDocument` records | None | None | Added optional `fileUrl` field. Existing documents use `storageKey` disk path. |
| Existing `Service` records | Optional Catalog backfill | Low | Added optional `catalogId`. Existing services remain active with legacy fields. |
| Existing `ProviderProfile.balance` | Lazy initialization | Low | Handled automatically in `getOrCreateProviderBalance()` — seeds `ProviderBalance` with existing balance on first access. |
| Existing `ServiceRequest` records | None | None | Preserved in `Service_Requests` collection. New contract traffic routes to `Bookings`. |
| Initial Service Catalog Seed | **Required for Go-Live** | Medium | Admin or startup script must insert initial `ServiceCatalog` items for each profession to allow provider access requests. |
