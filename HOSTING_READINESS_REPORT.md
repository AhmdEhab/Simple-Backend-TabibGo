# TabibiGo Client Backend — Hosting Readiness Report

> **Target Environment:** Node.js 18+ / Linux or Containerized Cloud (Render, Railway, AWS, DigitalOcean)  
> **Database:** MongoDB Atlas (`TabibiGo-Users`)  
> **Audit Date:** 2026-11-27

---

## 1. Hosting Readiness Verdict

> [!WARNING]
> **VERDICT: READY FOR STAGING / NOT YET READY FOR HIGH-SCALE MULTI-CONTAINER PRODUCTION WITHOUT TWO CRITICAL INFRASTRUCTURE FIXES.**

The codebase application logic, API routing, HMAC cryptographic integration, and database models are fully complete. However, two infrastructure requirements must be resolved prior to production deployment:

1. **Persistent Cloud Storage (BLOCKER FOR EPHEMERAL HOSTS):** Local disk uploads in `storage/documents/` do not persist across container redeployments.
2. **MongoDB Atlas IP Whitelisting (BLOCKER FOR LIVE TESTING):** Atlas cluster network rules currently reject non-whitelisted IPs.

---

## 2. Infrastructure Checklist & Action Items

### 2.1 File Storage (High Priority)
- **Current State:** Files are written to `./storage/documents` via `multer.diskStorage`.
- **Hosting Impact:** On cloud PaaS providers (Render, Railway, Heroku, Fly.io), the container filesystem is ephemeral. Deploying code or restarting dynos permanently wipes all uploaded patient IDs, provider licenses, and profile photos.
- **Remediation Plan:**
  - In development/staging: Run on a VPS or attach a persistent volume to `./storage/documents`.
  - In production: Implement an S3-compatible cloud storage adapter (AWS S3, Cloudinary, or Google Cloud Storage) so files are uploaded directly to private object buckets and served via presigned URLs.

### 2.2 MongoDB Atlas Network Access (High Priority)
- **Current State:** Atlas connection failed with:
  `Could not connect to any servers in your MongoDB Atlas cluster... Make sure your current IP address is on your Atlas cluster's IP whitelist.`
- **Remediation Plan:**
  - In MongoDB Atlas Console -> Security -> Network Access:
  - Add the static outbound IP of your hosting environment.
  - Or add `0.0.0.0/0` (Allow Access from Anywhere) combined with strong database user credentials and TLS/SSL enforcement.

### 2.3 Multi-Instance Scaling & In-Memory Nonce Cache (Medium Priority)
- **Current State:** The HMAC replay protection cache (`usedNonceCache`) lives in Node.js process memory (`Map()`).
- **Hosting Impact:** If the backend runs with multiple replicas (e.g. 2+ containers behind a load balancer), a replay attack could be routed to a different instance that has not seen the nonce.
- **Remediation Plan:**
  - For single-instance deployments: Fully secure.
  - For multi-instance clustered deployments: Back `usedNonceCache` with Redis (`SET nonce 1 EX 300 NX`).

### 2.4 Security Headers & Rate Limiting (Recommended)
- Install and configure `helmet` for HTTP security headers (HSTS, CSP, X-Frame-Options).
- Install `express-rate-limit` for global public route protection against brute-force attacks.

---

## 3. Environment Variable Checklist for Production

Before launching on your hosting platform, ensure the following variables are configured in the cloud dashboard:

| Variable | Recommended Production Value | Verified in Code |
|---|---|---|
| `PORT` | `5000` (or platform default `$PORT`) | YES |
| `NODE_ENV` | `production` | YES |
| `MONGO_URI` | `mongodb+srv://...` (Atlas connection string) | YES |
| `JWT_ACCESS_SECRET` | 64+ random hex characters | YES |
| `JWT_REFRESH_SECRET` | 64+ random hex characters | YES |
| `JWT_PENDING_SECRET` | 64+ random hex characters | YES |
| `INTERNAL_SERVICE_SECRET` | Shared 64+ hex key with Admin Backend | YES |
| `ALLOW_INSECURE_INTERNAL_API_KEY` | `false` (forces HMAC signing) | YES |
| `SMTP_EMAIL` | Verified Google Workspace / SMTP email | YES |
| `SMTP_APP_PASSWORD` | 16-character Google App Password | YES |
| `OTP_SECRET` | 32+ random hex characters | YES |
