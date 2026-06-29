# Changelog

All notable changes to the backend API are documented here.
Each entry is added after a feature or fix is completed.

---

## 2026-06-29 — Phase 0 Gaps: Error Codes, RBAC Normalization, Test Infrastructure

**Branch:** auth_setup
**Requirements:** RBAC-1 (role type case), TEST-1 (test infrastructure)

### What was built
Fixed foundational issues discovered in phase 0 testing: added optional `code` parameter to `error()` for machine-readable error codes (e.g. `INVALID_STATUS_TRANSITION`, `NOT_FOUND`); normalised all user roles from lowercase to uppercase in Passport strategies and schemas (ADMIN | AGENT per RBAC-1); added missing environment variables to `.sample.env`; and set up Jest, ts-jest, and supertest with dedicated test TypeScript config and global setup file.

### Files added / modified
- `src/utils/response.ts` — Added optional `code?: string` 4th parameter to `error()` function; response envelope conditionally includes code field
- `src/config/passport.ts` — Updated LocalStrategy and JwtStrategy to cast user roles to uppercase (`ADMIN` | `AGENT`) for normalisation at the boundary
- `src/modules/auth/auth.schemas.ts` — Updated `AuthUser.role` type to uppercase; exported `UserRole` type alias
- `.sample.env` — Added `CORS_ORIGIN`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` environment variables with defaults
- `jest.setup.ts` (new) — Global test setup file for Jest
- `tsconfig.test.json` (new) — Test-specific TypeScript configuration extending main tsconfig
- `package.json` — Added jest, ts-jest, supertest, @types/jest, @types/supertest as devDependencies; added test, test:watch, test:coverage scripts; configured jest block with ts-jest preset
- `eslint.config.js` — Added `tsconfig.test.json` to ESLint `parserOptions.project` array

### New API endpoints
None

### New environment variables
- `CORS_ORIGIN` — Explicit CORS origin (never wildcard `*` in production); default `http://localhost:3000`
- `RATE_LIMIT_WINDOW_MS` — Time window for rate limiting in milliseconds; default `900000` (15 minutes)
- `RATE_LIMIT_MAX` — Maximum requests per window; default `100`

### Breaking changes
**Minor:** All user roles in responses and payloads are now uppercase (`ADMIN`, `AGENT`). If your client expects lowercase roles, update the mapping. Database enum values were already uppercase; this change normalises the Passport layer at the boundary.

---
