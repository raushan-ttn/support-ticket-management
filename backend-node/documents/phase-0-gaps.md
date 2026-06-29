# Phase 0 Infrastructure Corrections

> **Status:** Implemented  
> **Branch:** auth_setup  
> **Date:** 2026-06-29  
> **Requirements:** ERR-1, ERR-3, RBAC-1, TS-5, NFR-5, TS-1, TEST-1, TEST-2, TEST-3, TEST-4, TEST-5

---

## Overview

Phase 0 (Infrastructure & Tooling) was marked complete after the initial Express/TypeScript scaffold, PostgreSQL and Redis wiring, auth middleware, and Zod validation were put in place. A subsequent review identified four concrete gaps that, left unaddressed, would have broken every downstream module: the `error()` response utility lacked a machine-readable `code` field that all later modules depend on; the role type was lowercase (`'admin' | 'agent'`) in TypeScript while the codebase convention and requirements define it as uppercase (`'ADMIN' | 'AGENT'`); three environment variables consumed by `src/config/index.ts` were absent from `.sample.env`; and the Jest/ts-jest test infrastructure was not installed, meaning `npm test` could not run at all.

These four corrections are infrastructure-only changes. No new API endpoints, no new tables, and no changes to business logic were introduced. The fixes are deliberately minimal — each targets one gap with the least-invasive change that unblocks the phases that follow.

The Postgres ENUM (`user_role`) still stores lowercase values (`admin`, `agent`) as of this phase. Role normalisation at the auth boundary — applied in both Passport strategies with `.toUpperCase()` — bridges that gap at runtime. The ENUM migration to uppercase is deferred to Phase 1 (`schema-alignment.md`).

---

## Architecture

The changes touch infrastructure files only; no new module directories were created.

| File | Role | What changed |
|------|------|--------------|
| `src/utils/response.ts` | Universal response helpers used by every controller | Added optional `code` 4th parameter to `error()` |
| `src/config/passport.ts` | Passport LocalStrategy + JwtStrategy | Added `.toUpperCase() as 'ADMIN' \| 'AGENT'` cast in both strategies |
| `src/modules/auth/auth.schemas.ts` | Zod schemas and TypeScript types for the auth module | Added `UserRole` type alias export; interface types corrected to uppercase |
| `.sample.env` | Environment variable documentation | Added `CORS_ORIGIN`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` |
| `jest.setup.ts` | Global Jest setup entry point | Created (empty bootstrapper; per-file teardown owns pool cleanup) |
| `tsconfig.test.json` | TypeScript config for the test environment | Created; extends `tsconfig.json`, sets `module: commonjs` for ts-jest + TypeScript 6 compatibility |
| `package.json` | Project manifest | Added `jest`, `ts-jest`, `supertest`, `@types/jest`, `@types/supertest` to devDependencies; added `test`, `test:watch`, `test:coverage` scripts; added `jest` config block |
| `eslint.config.js` | ESLint flat config | Added `tsconfig.test.json` to `parserOptions.project` so test files are linted correctly |

---

## Gap 1 — `error()` Utility Code Parameter (ERR-1, ERR-3)

### Problem

`src/utils/response.ts` originally had the signature:

```ts
error(res, message, statusCode?)
```

ERR-1 and ERR-3 require a stable, machine-readable `code` string in every error response (e.g. `INVALID_STATUS_TRANSITION`, `NOT_FOUND`, `FORBIDDEN`). Without a fourth parameter, every later module would have had to bypass the utility — violating the non-negotiable that `error()` is the only way to send error responses.

### Fix

The signature is now:

```ts
export const error = (
  res: Response,
  message: string,
  statusCode = 500,
  code?: string,
): Response =>
  res.status(statusCode).json({
    success: false,
    message,
    ...(code !== undefined && { code }),
  });
```

The `code` field is conditionally spread: it appears in the JSON body only when a value is provided. Callers that omit the fourth argument get an identical response to before — no existing call sites break.

### Response shape

Without code (e.g. generic 401):
```json
{
  "success": false,
  "message": "Unauthorized"
}
```

With code (e.g. state machine violation):
```json
{
  "success": false,
  "message": "Invalid status transition",
  "code": "INVALID_STATUS_TRANSITION"
}
```

### Documented error codes

| Code | HTTP Status | When emitted |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Zod parse failure |
| `NOT_FOUND` | 404 | Resource does not exist |
| `FORBIDDEN` | 403 | Caller lacks permission |
| `USER_NOT_FOUND` | 400 | `assignedTo` UUID references no user |
| `INVALID_STATUS_TRANSITION` | 409 | Transition outside the state machine |
| `INVALID_COMMENT_REFERENCE` | 400 | `commentId` does not belong to the parent ticket |

---

## Gap 2 — Role Type Consistency (RBAC-1)

### Problem

The initial implementation used lowercase TypeScript literals (`'admin' | 'agent'`) in Passport strategy typings and the auth schemas. Requirements §4 (RBAC-1), `db-conventions.md`, and `express.d.ts` all define the role union as `'ADMIN' | 'AGENT'`. The mismatch would have caused TypeScript type errors and runtime comparison failures in `requireRole` middleware once the tickets module used the convention-correct form.

### Fix

Both Passport strategies now normalise the role value at the auth boundary before it enters the request context:

```ts
// LocalStrategy — after bcrypt passes
const safeUser = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role.toUpperCase() as 'ADMIN' | 'AGENT',
  status: user.status,
};

// JwtStrategy — after user row lookup
return done(null, {
  ...user,
  role: user.role.toUpperCase() as 'ADMIN' | 'AGENT',
});
```

`auth.schemas.ts` exports the canonical type alias:

```ts
export type UserRole = 'ADMIN' | 'AGENT';
```

`requireRole.ts` derives its `Role` type transitively from `Express.User['role']` (declared in `express.d.ts`) and required no changes.

### Caveat — Postgres ENUM is still lowercase

The `user_role` ENUM in the database currently stores `admin` and `agent` (lowercase). The `.toUpperCase()` cast in both strategies ensures the value exposed to application code is always uppercase, masking the DB discrepancy. The ENUM will be migrated to `ADMIN` / `AGENT` in Phase 1 (`schema-alignment.md`). Until then, every code path that reads `role` from Postgres must go through one of the two Passport strategies — never queried raw and compared directly to `'ADMIN'` or `'AGENT'` without normalisation.

---

## Gap 3 — `.sample.env` Missing Variables (TS-5, NFR-5)

### Problem

`src/config/index.ts` already read three variables at startup that were absent from `.sample.env`, making the file an incomplete contract for new developers and CI environments.

### Variables added

| Variable | Example value | Purpose |
|----------|--------------|---------|
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed origin for the CORS middleware in `src/app.ts` |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate-limiter window in milliseconds (15 minutes) for `/api/v1/auth/*` |
| `RATE_LIMIT_MAX` | `20` | Maximum requests per window per IP on auth routes |

These variables carry defaults inside `src/config/index.ts` so the application starts without them set, but the absence from `.sample.env` violated TS-5 and NFR-5.

---

## Gap 4 — Jest / ts-jest Test Infrastructure (TS-1, TEST-1 through TEST-5)

### Problem

`npm test` exited with a "jest: command not found" error. The test runner (`jest`), the TypeScript transform (`ts-jest`), the HTTP integration helper (`supertest`), and their type declarations were absent from `devDependencies`. There was also no `jest` configuration block in `package.json` and no `tsconfig.test.json` — ts-jest requires a CommonJS module resolution config when used with TypeScript 6, which defaults to bundler mode.

### Packages installed

| Package | Version constraint | Purpose |
|---------|-------------------|---------|
| `jest` | `^30.4.2` | Test runner |
| `ts-jest` | `^29.4.11` | TypeScript transform for Jest |
| `supertest` | `^7.2.2` | HTTP integration testing against Express app |
| `@types/jest` | `^30.0.0` | TypeScript types for Jest globals (`describe`, `it`, `expect`, …) |
| `@types/supertest` | `^7.2.0` | TypeScript types for supertest |

### Configuration

`package.json` jest block:

```json
"jest": {
  "preset": "ts-jest",
  "testEnvironment": "node",
  "globals": {
    "ts-jest": {
      "tsconfig": "./tsconfig.test.json"
    }
  },
  "setupFilesAfterEnv": ["./jest.setup.ts"],
  "testMatch": ["**/*.test.ts"],
  "collectCoverageFrom": ["src/**/*.ts", "!src/db/**"]
}
```

`tsconfig.test.json` extends `tsconfig.json` and overrides `module` and `moduleResolution` so ts-jest can emit CommonJS output regardless of the base config's bundler settings:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node"
  },
  "include": ["src/**/*", "bin/**/*", "jest.setup.ts", "**/*.test.ts"]
}
```

`jest.setup.ts` is intentionally minimal — it acts as the `setupFilesAfterEnv` entry point. Per-file `afterAll` blocks handle pool teardown.

`eslint.config.js` lists both `tsconfig.json` and `tsconfig.test.json` in `parserOptions.project` so ESLint type-aware rules apply to test files:

```js
project: ['./tsconfig.json', './tsconfig.test.json'],
```

### Scripts added

| Script | Command | Purpose |
|--------|---------|---------|
| `npm test` | `jest` | Run all `*.test.ts` files once |
| `npm run test:watch` | `jest --watch` | Re-run on file change |
| `npm run test:coverage` | `jest --coverage` | Collect coverage from `src/**/*.ts` (excluding `src/db/**`) |

### How to run tests

```bash
# All tests (pass through with no test files yet)
npm test -- --passWithNoTests

# Watch mode during development
npm run test:watch

# Coverage report
npm run test:coverage
```

When writing new tests, place them co-located with the source file they cover:

```
src/modules/tickets/
  tickets.service.ts
  tickets.service.test.ts      ← unit tests (mock query)
  tickets.controller.test.ts   ← integration tests (supertest + real test DB)
```

Always use `NODE_ENV=test` (or the `ttn_stm_test` database) — never run tests against the development database.

### Test database teardown pattern

Each integration test file must include:

```ts
afterEach(async () => {
  await query('TRUNCATE attachments, comments, tickets, users RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});
```

### Coverage targets

| Layer | Minimum |
|-------|---------|
| Services | 90% |
| Controllers | 80% |
| Middleware / Utils | 100% |
| Job workers | 80% |

---

## RBAC

No new RBAC rules were introduced. This phase corrected the type representation of existing roles so that `requireRole` middleware enforces them reliably.

| Middleware | File | Enforces |
|------------|------|----------|
| `requireRole('ADMIN')` | `src/middlewares/requireRole.ts` | Blocks any caller whose `req.user.role` is not in the provided list; returns `403` without a `code` field (generic forbidden) |

---

## Environment Variables

| Variable | Default in `config/index.ts` | Purpose |
|----------|------------------------------|---------|
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origin |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Auth rate-limit window in ms |
| `RATE_LIMIT_MAX` | `20` | Max auth requests per window per IP |

These were already read by the application before this phase. The only change is their addition to `.sample.env` for documentation completeness.

---

## Known Limitations / Future Work

- **Postgres ENUM is still lowercase.** The `user_role` ENUM stores `admin` / `agent`. The `.toUpperCase()` cast in both Passport strategies normalises values at the auth boundary. Any future query that reads `role` from Postgres outside of a Passport strategy must apply the same normalisation until the ENUM migration in Phase 1 (`schema-alignment.md`) is complete.
- **`jest.setup.ts` is empty.** Global setup (e.g. database provisioning, test-schema creation) will be added as integration tests are written in later phases.
- **No test files exist yet.** `npm test -- --passWithNoTests` exits 0, confirming the runner is wired correctly. Actual test files are authored module-by-module per TEST-1 through TEST-9.
- **`requireRole` emits `403` without a `code` field.** This is consistent with the current implementation. If a `FORBIDDEN` code is required on role-guard rejections, `requireRole.ts` should be updated to pass `'FORBIDDEN'` as the fourth argument to `error()`.
