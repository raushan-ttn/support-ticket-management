# Auth Module — Authentication, Validation & Security Middleware

> **Status:** Implemented
> **Branch:** auth_setup
> **Date:** 2026-07-16
> **Requirements:** RBAC-1, RBAC-2, RBAC-6, DM-1, DM-2, VAL-1, ERR-1, ERR-2, ERR-3, ERR-4, ERR-5, NFR-4, NFR-5, NFR-6, TS-5

---

## Overview

The Auth module implements the full authentication and identity-resolution layer for the Support Ticket Management API. It covers email/password login via Passport's LocalStrategy, stateless JWT issuance and verification via Passport's JwtStrategy, and a `GET /me` endpoint that returns the currently authenticated user's profile. No user registration endpoint exists: per requirements §3.1 (DM-1), user accounts are created exclusively via the seed script (`npm run db:seed`), never through the public API.

Alongside the two auth endpoints, this phase introduced four pieces of shared middleware that every downstream module depends on: `authenticate` (JWT guard), `requireRole` (RBAC enforcement), `validateBody` and `validateQuery` (Zod-powered request validation), and the global `errorHandler`. These middleware files live in `src/middlewares/` because they carry no module-specific imports; they are documented briefly here and tested independently of the auth endpoints.

Security hardening applied in this phase includes bcrypt at 12 salt rounds for password comparison (SEC), `helmet` for HTTP security headers, CORS with an explicit origin list, gzip compression, request logging via `morgan`, and `express-rate-limit` on the auth routes only (20 requests per 15-minute window by default). All connection secrets and configuration values are read exclusively from `src/config/index.ts`, which is the only file permitted to access `process.env`.

---

## Architecture

| File | Role |
|------|------|
| `src/modules/auth/auth.routes.ts` | Route definitions: `POST /login` and `GET /me`; middleware chain attachment |
| `src/modules/auth/auth.controller.ts` | `login()` — calls `signToken`, sends `success()`; `getMe()` — returns `req.user` directly |
| `src/modules/auth/auth.service.ts` | `signToken()` — updates `last_logged_in` timestamp, signs and returns JWT + safe user object |
| `src/modules/auth/auth.schemas.ts` | `loginSchema` (Zod), `AuthUser` interface, `LoginPayload` + `UserRole` inferred types |
| `src/modules/auth/auth.middleware.ts` | `authenticateLocal` — Passport LocalStrategy custom callback wrapper for the login route |
| `src/config/passport.ts` | Registers `LocalStrategy` (email/password) and `JwtStrategy` (Bearer token) on the global Passport instance |
| `src/types/express.d.ts` | Global `Express.User` namespace augmentation — types `req.user` as `AuthUser` throughout the codebase |

**Shared middleware introduced in this phase (cross-module, no module-specific imports):**

| File | Role |
|------|------|
| `src/middlewares/authenticate.ts` | JWT guard: wraps `passport.authenticate('jwt')`, sets `req.user`, returns `401` if token is absent/invalid/expired or user is blocked |
| `src/middlewares/requireRole.ts` | RBAC guard: variadic `requireRole(...roles)` factory; returns `403` if `req.user.role` is not in the allowed set |
| `src/middlewares/validateBody.ts` | `validateBody(schema)` factory — runs `schema.safeParse(req.body)`; returns `400 VALIDATION_ERROR` on failure; replaces `req.body` with parsed output on success |
| `src/middlewares/validateQuery.ts` | `validateQuery(schema)` factory — same pattern against `req.query`; uses `z.coerce.number()` for numeric params |
| `src/middlewares/errorHandler.ts` | Global 4-arg error handler (last middleware in `src/app.ts`); branches on `multer.MulterError`, `ZodError`, domain errors (`err.statusCode`), and generic `Error`; masks 5xx messages in production |

The auth router is mounted in `src/app.ts` at `/api/v1/auth` with the `authLimiter` rate limiter applied at mount time (not inside the router itself). All other module routers are mounted after it; `errorHandler` is always last.

---

## Auth Flows

### Login Flow

```
POST /api/v1/auth/login
  │
  ├─ authLimiter                      → 429 if rate limit exceeded
  │
  ├─ validateBody(loginSchema)         → 400 VALIDATION_ERROR if email/password invalid shape
  │
  ├─ authenticateLocal (auth.middleware.ts)
  │     └─ passport.authenticate('local', { session: false }, callback)
  │           LocalStrategy queries DB:
  │             SELECT id, name, email, password_hash, role, status
  │             FROM users WHERE email = $1
  │           ├─ user not found         → 401 "Invalid email or password"
  │           ├─ status = 'BLOCKED'     → 401 "Account is blocked"
  │           ├─ bcrypt.compare fails   → 401 "Invalid email or password"
  │           └─ match: strips password_hash → done(null, safeUser) → req.user set
  │
  └─ controller.login
        └─ authService.signToken(req.user)
              ├─ UPDATE users SET last_logged_in = NOW() WHERE id = $1
              └─ jwt.sign({ sub: id, role }, secret, { expiresIn })
                    → 200 { token, user }
```

### JWT Verification Flow (all protected routes)

```
GET|POST|PATCH /api/v1/... (Authorization: Bearer <token>)
  │
  └─ authenticate (src/middlewares/authenticate.ts)
        └─ passport.authenticate('jwt', { session: false }, callback)
              JwtStrategy:
                ExtractJwt.fromAuthHeaderAsBearerToken()
                Verify signature with config.jwt.secret
                SELECT id, name, email, role, status FROM users WHERE id = $1 (payload.sub)
                ├─ invalid/expired/missing token → 401 "Unauthorized"
                ├─ user not found                → 401 "Unauthorized"
                ├─ status = 'BLOCKED'            → 401 "Unauthorized"
                └─ success → req.user populated → next()
```

---

## API Endpoints

### POST /api/v1/auth/login

**Auth required:** No (public endpoint, rate-limited)
**Purpose:** Authenticate with email and password. Returns a signed JWT and the safe user object (no `password_hash`). Updates `last_logged_in` on success.

**Request body:**
```json
{
  "email": "valid email address — required",
  "password": "string — required, min 1 character"
}
```

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "uuid",
      "name": "Super Admin",
      "email": "admin@ttn.com",
      "role": "ADMIN",
      "status": "ACTIVE"
    }
  }
}
```

`password_hash` is never included in the `user` object. The token payload carries `{ sub: id, role }` and expires per `config.jwt.expiresIn` (default `7d`). Callers must supply it as `Authorization: Bearer <token>` on subsequent requests — never in a query string.

**Error cases:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | `email` missing or not a valid email format; `password` missing or empty string |
| 401 | — | Email not found in database |
| 401 | — | Correct email but wrong password (`bcrypt.compare` returned false) |
| 401 | — | Account exists but `status = 'BLOCKED'`; message reads "Account is blocked" |
| 429 | — | Rate limit exceeded (20 requests per 15-minute window) |

**401 error body example:**
```json
{
  "success": false,
  "message": "Invalid email or password"
}
```

---

### GET /api/v1/auth/me

**Auth required:** Yes — any authenticated role (ADMIN or AGENT)
**Purpose:** Return the current user's profile as resolved from the verified JWT. No database write is performed. The response shape is the `AuthUser` object already populated in `req.user` by the `authenticate` middleware.

**Request:** No body, no query parameters. Requires `Authorization: Bearer <token>` header.

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Test Agent",
    "email": "agent@example.com",
    "role": "AGENT",
    "status": "ACTIVE"
  }
}
```

**Error cases:**

| Status | Code | Condition |
|--------|------|-----------|
| 401 | — | `Authorization` header absent or token is malformed |
| 401 | — | Token is valid but the user no longer exists in the database |
| 401 | — | Token is valid but the user's `status` is `BLOCKED` |

> The JwtStrategy re-queries Postgres on every request (`SELECT id, name, email, role, status FROM users WHERE id = $1`) rather than trusting the token payload alone. This means a blocked user is denied access immediately after an admin updates their status, without waiting for the token to expire.

---

## Data Model Changes

No new tables are introduced by the auth module. The `users` table was defined in the initial schema. The `last_logged_in` column (updated by `signToken` on every successful login) was part of the original DDL:

```sql
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('ADMIN', 'AGENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('ACTIVE', 'BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Seeded only. No sign-up UI — admin/agent accounts are created by an admin.
CREATE TABLE IF NOT EXISTS users (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(255) NOT NULL,
  email          VARCHAR(255) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  role           user_role    NOT NULL DEFAULT 'AGENT',
  status         user_status  NOT NULL DEFAULT 'ACTIVE',
  last_logged_in TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

**Key schema facts for this module:**

- `password_hash` is stored; it is never returned in any API response or query result passed to a controller. All `SELECT` statements on `users` explicitly omit it.
- `status = 'BLOCKED'` is the mechanism for disabling an account; the Passport strategies check this on every login attempt (LocalStrategy) and on every protected request (JwtStrategy).
- `last_logged_in` is nullable (NULL until first successful login). It is updated with `UPDATE users SET last_logged_in = NOW() WHERE id = $1` inside `signToken()`.
- The `users` table has no `updated_at` trigger — `last_logged_in` is the only mutable timestamp column.
- ENUM values are uppercase to match the `schema-alignment.md` Phase 1 migration. TypeScript mirrors these as:
  ```ts
  type UserRole   = 'ADMIN' | 'AGENT'
  type UserStatus = 'ACTIVE' | 'BLOCKED'
  ```

---

## RBAC

| Action | ADMIN | AGENT | Enforcement |
|--------|:-----:|:-----:|-------------|
| Login (`POST /login`) | ✅ | ✅ | Open endpoint — no role check; Passport LocalStrategy checks credentials only |
| Get own profile (`GET /me`) | ✅ | ✅ | `authenticate` middleware only; any authenticated user |
| Access any protected route | ✅ | ✅ (own scope) | `authenticate` on every route; `requireRole('ADMIN')` gates admin-only routes |

Authorization is always derived from the verified JWT payload (`req.user.id`, `req.user.role`). The `requireRole` middleware accepts variadic role arguments (`requireRole('ADMIN')`, `requireRole('ADMIN', 'AGENT')`) so single or multi-role gates are expressed identically. Role assertions in `req.body` are ignored — the caller cannot self-assign a role (RBAC-6).

`req.user` is typed globally via `src/types/express.d.ts`, which extends `Express.User` with the `AuthUser` interface. This guarantees that every file accessing `req.user` sees the correct shape without ad hoc casts.

---

## Global Error Handler

`src/middlewares/errorHandler.ts` is the single, centralized 4-arg Express error handler. It is always the last middleware registered in `src/app.ts`. All controllers call `next(err)` in their `catch` block — they never format error responses directly.

The handler branches in this priority order:

1. **`multer.MulterError`** — maps `LIMIT_FILE_SIZE` → `400 "File exceeds the maximum allowed size"`, `LIMIT_FILE_COUNT` → `400 "Too many files in a single request"`, `LIMIT_UNEXPECTED_FILE` → `400 "Unexpected file field name"`, any other Multer code → `400 err.message`. All use `code: 'VALIDATION_ERROR'`.

2. **`ZodError`** — thrown by `.parse()` calls (e.g. `uuidParam.parse(req.params.id)`). Formats `err.issues` as `"path: message; path2: message2"` (path falls back to `"body"` if empty). Returns `400 VALIDATION_ERROR`.

3. **Domain errors** — plain `Error` objects with `err.statusCode` set by service layer. Messages are passed through as-is for `4xx`; masked to `"Internal Server Error"` for `5xx` in production. An optional `err.code` string is included in the response (e.g. `NOT_FOUND`, `FORBIDDEN`). An optional `err.extra` object can carry additional fields (e.g. `{ from, to }` for `INVALID_STATUS_TRANSITION` responses).

4. **Generic `Error`** — no `statusCode` → `500`; message masked in production.

Stack traces are included in the response only when `config.env === 'development'`.

---

## Rate Limiting

The `authLimiter` middleware is applied in `src/app.ts` at mount time:

```ts
app.use('/api/v1/auth', authLimiter, authRoutes);
```

It uses `express-rate-limit` with `standardHeaders: true` and `legacyHeaders: false`. No other route group has a rate limiter; the restriction is intentionally scoped to the auth namespace to protect credential endpoints without penalizing the rest of the API.

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `JWT_SECRET` | `changeme` | HMAC signing key for all JWTs; must be a long random string in production |
| `JWT_EXPIRES_IN` | `7d` | Token expiry duration (any `jsonwebtoken`-valid string, e.g. `1h`, `7d`) |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed CORS origin; never use `*` in production |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate-limit window in milliseconds (default: 15 minutes) |
| `RATE_LIMIT_MAX` | `20` | Maximum auth requests per caller per window |

No `BCRYPT_SALT_ROUNDS` environment variable exists — the value is hardcoded as `12` in the seed script (`src/db/admin-seed.ts`). The `bcrypt.compare` call in `src/config/passport.ts` does not need the rounds value; bcrypt extracts it from the stored hash automatically.

---

## Testing

### How to run

```bash
# Run the auth controller integration tests (requires ttn_stm_test database)
npm run db:setup
npm test -- --runInBand --testPathPattern="auth"

# Run all shared middleware unit tests (no database required)
npm test -- --testPathPattern="middlewares"

# Full suite with coverage
npm run test:coverage
```

Integration tests for the auth controller run against the real `ttn_stm_test` database. They seed users directly via `bcrypt.hash` + `INSERT INTO users` — they do not call the auth endpoints to create users, which avoids any circular dependency. Each test suite truncates the `users` table (and its dependents) in `afterEach` and calls `pool.end()` in `afterAll`.

### Test coverage

| Test file | What it covers |
|-----------|----------------|
| `src/modules/auth/auth.controller.test.ts` | Integration: `POST /login` happy path (token returned, `password_hash` absent), wrong password `401`, unknown email `401`, blocked account `401`, missing email field `400`, invalid email format `400`, empty password `400`; `GET /me` with no header `401`, invalid token `401`, valid token `200` |
| `src/middlewares/authenticate.test.ts` | Unit: no header `401`, malformed token `401`, expired token `401`, user not found `401`, blocked user `401`, wrong signing secret `401`, valid token populates `req.user` and calls `next` — all with mocked `query` |
| `src/middlewares/requireRole.test.ts` | Unit: unauthenticated (no `req.user`) `403`, AGENT on ADMIN-only route `403`, ADMIN on ADMIN-only route `200`, AGENT on AGENT-only route `200`, variadic multi-role gates for both ADMIN and AGENT |
| `src/middlewares/validateBody.test.ts` | Unit: valid body calls `next` with parsed output; missing field `400`; `min(1)` violation `400`; nested path in error message; empty-path refinement falls back to `"body:"`; extra fields stripped by schema |
| `src/middlewares/validateQuery.test.ts` | Unit: `z.coerce.number()` coerces string param; non-numeric string `400`; missing required param `400`; nested path error message; top-level refinement falls back to `"query:"` |
| `src/middlewares/errorHandler.test.ts` | Unit: `LIMIT_FILE_SIZE` → `400`; `LIMIT_FILE_COUNT` → `400`; `LIMIT_UNEXPECTED_FILE` → `400`; `ZodError` → `400 VALIDATION_ERROR` with path; `NOT_FOUND` domain error `404`; `INVALID_STATUS_TRANSITION` domain error `409`; generic `Error` `500`; production masks 5xx; production does not mask 4xx; development includes `stack` field; `code` key omitted when absent, included when present |

### Key test scenarios

- Login success: `POST /login` with valid credentials returns `200`, a JWT string in `data.token`, and a `data.user` object that explicitly does not contain `password_hash`.
- Blocked account: seeded user's status is `UPDATE`d to `'BLOCKED'` then login is attempted; response is `401` with message matching `/blocked/i`.
- `GET /me` round-trip: a token obtained from `POST /login` is used as `Authorization: Bearer <token>` on `GET /me`; the returned user matches the seeded account and again has no `password_hash` field.
- Authenticate middleware expired token: a token signed with `expiresIn: -1` (already expired) is sent to a protected route; the handler returns `401` without reaching the controller.
- `requireRole` variadic: a route guarded by `requireRole('ADMIN', 'AGENT')` accepts both roles independently; a route guarded by `requireRole('ADMIN')` rejects AGENT.

---

## Known Limitations / Future Work

- **No token refresh endpoint.** The JWT is issued with a fixed expiry (`JWT_EXPIRES_IN`, default 7 days). When the token expires the caller must log in again. A `/auth/refresh` endpoint with a separate long-lived refresh token was not implemented and is not in scope.

- **No logout / token revocation.** JWTs are stateless; there is no server-side token blacklist. Signing out on the client side by discarding the token is the only mechanism. If immediate revocation is required (e.g. after a role change), the `status = 'BLOCKED'` mechanism provides the closest equivalent — the JwtStrategy re-queries Postgres on every request so blocking a user takes effect without waiting for the token to expire.

- **BLOCKED status set by seeding only.** No API endpoint exists to block or unblock a user (DM-1 — no user-management API). The `status` column can only be changed by direct database mutation. If an admin-facing user-management API is added in future, `status` transitions would need to be ADMIN-only and should invalidate any active tokens.

- **`last_logged_in` is updated on every `signToken` call.** Because `signToken` is called from `controller.login` only (and there is no session-based flow), this is safe. If a token-refresh endpoint is added in future, `signToken` would need to be called there too, and `last_logged_in` semantics would need to be revisited.

- **Rate limiter is in-process (memory store).** The default `express-rate-limit` memory store is per-process and is reset on restart. In a multi-instance deployment, a Redis store (e.g. `rate-limit-redis`) should be used to share the counter across instances.

- **`registerSchema` and `register()` were deliberately not built.** The plan (`auth-validation-upload.md`) originally specified a `POST /register` endpoint, a `registerSchema`, and a `register()` service function. These were excluded because `requirements.md` §3.1 (DM-1) explicitly states that users are seeded only. The schemas file intentionally contains only `loginSchema` and the `AuthUser` / `LoginPayload` types.
