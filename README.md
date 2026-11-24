# TabibiGo Backend – Authentication, Profiles & Secure Documents

TabibiGo Backend provides healthcare service matching between patients and licensed providers (e.g., Nurses, Physical Therapists). This implementation encompasses full JWT authentication with refresh token rotation, profile management, secure identity and credential document management, and provider verification application workflows.

---

## 1. Technology Stack

- **Runtime & Framework**: Node.js, Express.js (CommonJS)
- **Database**: MongoDB Atlas (`TabibiGo-Users`) via Mongoose
- **Authentication**: JWT (`jsonwebtoken`) & Refresh Token rotation via SHA-256 hashes stored in MongoDB
- **Password Hashing**: `bcryptjs`
- **File Uploads**: `multer` with MIME type, extension, and file signature / magic number verification
- **Validation**: `express-validator`

---

## 2. Environment Variables

Create a `.env` file in the project root containing the following variable names:

```env
PORT=5000
MONGO_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net
SMTP_EMAIL=your-email@gmail.com
SMTP_APP_PASSWORD=your-app-password
OTP_SECRET=your_hmac_secret_for_otp
JWT_ACCESS_SECRET=your_jwt_access_secret_key
JWT_REFRESH_SECRET=your_jwt_refresh_secret_key
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
STORAGE_PATH=./storage/documents
```

> **Security Note**: Never commit actual secret keys or database credentials to version control.

---

## 3. Workflows & Architecture

### A. Authentication Workflow
1. **Registration**: `POST /api/auth/register` with `{ email, password, role }`. Users are created with `emailVerified: false`.
2. **OTP Dispatch**: `POST /api/auth/send-verification-otp` generates a 6-digit OTP hashed using HMAC-SHA256 and sent via Nodemailer.
3. **OTP Verification**: `POST /api/auth/verify-email` verifies the OTP and sets `emailVerified: true`.
4. **Login**: `POST /api/auth/login` checks credentials, validates `emailVerified === true` and `isActive === true`, and generates an **Access Token** (JWT, 15m) and a cryptographically secure random **Refresh Token** (SHA-256 hashed and persisted in `Refresh_Tokens`).
5. **Token Refresh (Rotation)**: `POST /api/auth/refresh-token` validates the refresh token, revokes the previous token, and issues a new access/refresh pair.
6. **Logout**: `POST /api/auth/logout` revokes the refresh token.

### B. Profile Workflow
- **Patient Profile**: `POST /api/profiles/patient` allows authenticated patients to submit their full name, date of birth, gender, location, and health info.
- **Provider Profile**: `POST /api/profiles/provider` allows authenticated providers to complete their professional background, linked to an active `Profession` document (seeded initially with "Nurse" and "Physical Therapist").
- **My Profile**: `GET /api/profiles/me` and `PUT /api/profiles/me` retrieve and update profile information without allowing arbitrary user ID tampering.

### C. Secure Document Management Workflow
- Documents are stored in private local storage (`./storage/documents/<userId>/`) with randomly generated secure names.
- Files are **never** exposed through a public static URL. Private authenticated streaming/download is handled via `GET /api/documents/:documentId/download`.
- **Validation Pipeline**:
  - MIME type and file extension check.
  - Magic number/signature inspection (e.g. verifying PNG, JPEG, PDF bytes).
  - Maximum file size: 5 MB.
  - Role-based document type restrictions.
  - Safe replacement of previous file revisions and orphaned file cleanup upon database error.
### C. Secure Document Management Workflow & Profession Configurations
- Documents are stored in private local storage (`./storage/documents/<userId>/`) with randomly generated secure names.
- Files are **never** exposed through a public static URL. Private authenticated streaming/download is handled via `GET /api/documents/:documentId/download`.
- **Validation Pipeline**:
  - MIME type and file extension check.
  - Magic number/signature inspection (verifying PNG, JPEG, WebP, PDF bytes).
  - Maximum file size: 5 MB.
  - Role and profession-based document type restrictions.
  - Safe replacement of previous file revisions and orphaned file cleanup upon database error.
- **Document Categories**:
  1. `legal_mandatory`: Required by Egyptian healthcare law to practice the profession.
  2. `platform_policy`: Required by TabibiGo verification, quality assurance, and patient safety policies.

#### Configured Document Requirements by Role & Profession

1. **Patient**:
   - `profile_photo` (Platform Policy, Image only)
   - `national_id_front` (Platform Policy, ID front)
   - `national_id_back` (Platform Policy, ID back)
   - `proof_of_address` (Platform Policy, Utility bill or residence evidence)

2. **Nurse**:
   - `nursing_graduation_certificate` (*Legal Mandatory* – Egyptian Accredited Faculty / Institute of Nursing)
   - `nursing_practice_license` (*Legal Mandatory* – Egyptian Ministry of Health and Population / MOHP)
   - `nursing_syndicate_card` (*Legal Mandatory* – Egyptian Syndicate of Nursing)
   - `bls_certificate` (*Platform Policy* – Basic Life Support certification e.g. AHA/ERC)
   - `national_id_front` (*Platform Policy* – Identity verification)
   - `national_id_back` (*Platform Policy* – Identity verification)

3. **Physical Therapist**:
   - `pt_graduation_certificate` (*Legal Mandatory* – Accredited Faculty of Physical Therapy)
   - `pt_practice_license` (*Legal Mandatory* – Egyptian Ministry of Health and Population / MOHP)
   - `pt_syndicate_card` (*Legal Mandatory* – General Syndicate of Physical Therapy)
   - `bls_certificate` (*Platform Policy* – Basic Life Support certification e.g. AHA/ERC)
   - `national_id_front` (*Platform Policy* – Identity verification)
   - `national_id_back` (*Platform Policy* – Identity verification)

- **Statuses**: `pending_review`, `approved`, `rejected`. Uploading a document does not auto-approve it.

### D. Egyptian Legal Verification Context & Notes
- **Nursing (Law No. 115 of 1976)**: In Egypt, practice of nursing requires registration in the General Register of Nurses at the Ministry of Health and Population (MOHP) and active membership in the Egyptian Nursing Syndicate (نقابة التمريض المصرية).
- **Physical Therapy (Law No. 209 of 1994)**: Physical therapy practitioners are governed under Law 209 of 1994. They are licensed by the MOHP Medical Licensing Administration and must be registered with the General Syndicate of Physical Therapy (النقابة العامة للعلاج الطبيعي).
- **Syndicate & License Separation**: The syndicate membership card proves current active standing, while the MOHP License permits medical practice. Both are distinct legal documents issued by different governing bodies.
- **National ID & BLS**: While Egyptian clinical practice laws mandate graduation, licensing, and syndicate registration, National ID verification and BLS certification are enforced as TabibiGo platform verification and patient safety policies.

### E. Provider Application Workflow
1. Provider registers, verifies email, and completes their `ProviderProfile`.
2. Provider uploads all required documents according to their profession configuration.
3. Provider calls `POST /api/provider-applications/submit`. The backend verifies all profession-specific documents are uploaded and none are rejected.
4. Active duplicate applications are prevented (`draft`, `submitted`, `under_review`, `approved`). If an application is rejected, the provider is allowed to reapply with updated credentials.

---

## 4. API Endpoints Reference

### Authentication (`/api/auth`)
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/auth/register` | Register new user (`patient` or `provider`) | No |
| `POST` | `/api/auth/login` | Login user and issue tokens | No |
| `POST` | `/api/auth/refresh-token` | Rotate refresh token | No |
| `POST` | `/api/auth/logout` | Revoke refresh token | No |
| `GET` | `/api/auth/me` | Get current authenticated user details | Yes (Bearer) |
| `POST` | `/api/auth/send-verification-otp` | Request email verification OTP | No |
| `POST` | `/api/auth/verify-email` | Verify email OTP | No |
| `POST` | `/api/auth/forgot-password` | Request password reset OTP | No |
| `POST` | `/api/auth/verify-password-reset`| Verify reset OTP and obtain reset token | No |
| `POST` | `/api/auth/reset-password` | Set new password with reset token | No |

### Profiles (`/api/profiles`)
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/profiles/professions` | List active professions | No / Optional |
| `GET` | `/api/profiles/me` | Get current user's profile | Yes (Bearer) |
| `PUT` | `/api/profiles/me` | Update current user's profile | Yes (Bearer) |
| `POST` | `/api/profiles/patient` | Create or complete patient profile | Yes (Patient) |
| `POST` | `/api/profiles/provider` | Create or complete provider profile | Yes (Provider) |

### Documents (`/api/documents`)
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/documents/requirements` | Get required document types and upload status | Yes (Bearer) |
| `POST` | `/api/documents/upload` | Upload or replace a document (`multipart/form-data`) | Yes (Bearer) |
| `GET` | `/api/documents/my-documents` | List all uploaded documents for user | Yes (Bearer) |
| `GET` | `/api/documents/:documentId` | Get single document metadata | Yes (Owner) |
| `GET` | `/api/documents/:documentId/download` | Privately view or download document stream | Yes (Owner) |
| `DELETE` | `/api/documents/:documentId` | Delete document (pending or rejected only) | Yes (Owner) |

### Provider Applications (`/api/provider-applications`)
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/provider-applications/status` | Get application status and history | Yes (Provider) |
| `POST` | `/api/provider-applications/submit` | Submit application for admin review | Yes (Provider) |

---

## 5. How to Run & Test

### Run Development Server
```bash
npm run dev
# or
npm start
```

### Run Comprehensive Automated Test Suite
```bash
npm test
```

The test suite covers 33 integration test scenarios covering registration, OTP verification, login guards, token rotation, profile validation, secure uploads, magic numbers, document authorization, and provider application submissions.
