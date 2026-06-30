# Plan: Phase 0 Gaps

> **Requirements:** TS-1, TS-5, RBAC-1, ERR-1, ERR-2, ERR-3, NFR-5, TEST-1, TEST-2, TEST-3, TEST-4, TEST-5
> **Date:** 2026-06-29

## Problem

Phase 0 is marked complete in `task.md`, but four concrete gaps prevent later phases from proceeding correctly:

1. **`error()` missing `code` param (ERR-1, ERR-3).** `src/utils/response.ts` exports `error(res, message, statusCode?)` but `api-conventions.md` requires a 4th optional `code` parameter so callers can emit machine-readable error codes (`INVALID_STATUS_TRANSITION`, `NOT_FOUND`, `FORBIDDEN`, etc.). Every later module calls `error(res, '...', 409, 'INVALID_STATUS_TRANSITION')` — that 4th argument is silently dropped today, making ERR-3 impossible to satisfy.

2. **Jest / ts-jest test infrastructure absent (TEST-1 through TEST-5).** `package.json` has no `jest`, `ts-jest`, `supertest`, `@types/jest`, or `@types/supertest` in devDependencies; no `test`, `test:watch`, or `test:coverage` scripts; and no `jest` config block. `jest.setup.ts` does not exist.

3. **`.sample.env` missing variables (TS-5, NFR-5).** `src/config/index.ts` reads `CORS_ORIGIN`, `RATE_LIMIT_WINDOW_MS`, and `RATE_LIMIT_MAX` from `process.env`, but none appear in `.sample.env`. Developers who copy the file receive the hardcoded fallbacks with no documentation.

4. **Role type inconsistency (RBAC-1).** `src/config/passport.ts` and `src/modules/auth/auth.schemas.ts` use `'admin' | 'agent'` TypeScript literals. Requirements §3.1 and RBAC-1 mandate `'ADMIN' | 'AGENT'`. The Postgres ENUM currently stores lowercase — that migration belongs to Phase 1 (`schema-alignment.md`) — so the fix here is to cast the DB value to uppercase at the passport layer boundary only.

## Approach

All four gaps are surgical fixes to existing files plus two new artifacts (`jest.setup.ts` and updated `package.json`). No new modules, no new routes, no schema changes.

**Gap 1** — add an optional fourth parameter `code?: string` to `error()` and include it in the JSON body only when defined. Strictly additive; all existing callers continue to work.

**Gap 2** — install five devDependencies, add three npm scripts, add a `jest` config block to `package.json`, and create `jest.setup.ts`. The jest config lives in `package.json` as specified by `api-conventions.md`.

**Gap 3** — append three variables to `.sample.env` with defaults matching the fallbacks already in `src/config/index.ts`.

**Gap 4** — change every `'admin' | 'agent'` literal in `passport.ts` and `auth.schemas.ts` to `'ADMIN' | 'AGENT'`. In both passport strategies (Local and JWT), cast the DB row's `role` field via `.toUpperCase() as 'ADMIN' | 'AGENT'` before returning the user object. `requireRole.ts` already uses `type Role = Express.User['role']` with no hardcoded literals — no change needed. `src/types/express.d.ts` extends `AuthUser` transitively — no change needed.

## Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/utils/response.ts` | Modify | Add optional `code?: string` 4th param to `error()`; include in response JSON via conditional spread |
| `package.json` | Modify | Add jest/ts-jest/supertest devDeps; add `test`, `test:watch`, `test:coverage` scripts; add `jest` config block |
| `jest.setup.ts` | Create | Minimal global test setup |
| `.sample.env` | Modify | Append `CORS_ORIGIN`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` with documented defaults |
| `src/config/passport.ts` | Modify | Change all `'admin' \| 'agent'` to `'ADMIN' \| 'AGENT'`; add `.toUpperCase() as 'ADMIN' \| 'AGENT'` cast in both strategies |
| `src/modules/auth/auth.schemas.ts` | Modify | Change `AuthUser.role` to `'ADMIN' \| 'AGENT'`; export `UserRole` type alias |

Files confirmed to need NO changes:
- `src/middlewares/requireRole.ts` — uses `type Role = Express.User['role']`; no literals
- `src/types/express.d.ts` — `interface User extends AuthUser {}` picks up the fix transitively
- `src/db/schema.sql` — ENUM value migration is Phase 1 (`schema-alignment.md`)

## Schema Changes

None. The Postgres ENUM `user_role` currently stores `'admin'` and `'agent'` in lowercase. Migrating those to uppercase is tracked in Phase 1 under `schema-alignment.md`.

## Error Cases

| Scenario | HTTP | Code |
|----------|------|------|
| `error()` called with a `code` argument | matches `httpCode` param | `code` appears in body |
| `error()` called without a `code` argument | matches `httpCode` param | `code` key absent from body entirely |

The `code` field must be omitted from JSON entirely when not provided — not serialized as `"code": null` or `"code": undefined`. Use a conditional spread: `{ success: false, message, ...(code !== undefined && { code }) }`.

## Risks

**Role cast timing.** Casting `.toUpperCase()` in passport strategies is safe for the current DB state (lowercase) and will remain correct after Phase 1 migrates DB values to uppercase (`.toUpperCase()` on an already-uppercase string is a no-op). No risk of double-transformation.

**Jest / TypeScript version compatibility.** `ts-jest@29` supports TypeScript up to 5.x. The project has `typescript: ^6.0.3`. The implementer must verify compatibility and may need `ts-jest@latest` or a `tsconfig.test.json`. This is the most operationally risky step.

**Backward compatibility of `error()`.** All existing callers pass at most 3 arguments. The 4th param is optional and additive.

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Cast `.toUpperCase()` in passport strategies rather than a DB migration | DB migration is Phase 1; mixing concerns makes rollback harder |
| Keep jest config in `package.json` (not `jest.config.ts`) | `api-conventions.md` is explicit |
| Omit `code` key entirely when not provided | ERR-1 specifies optional field; clients should use key presence, not null-checks |
| Do not change `requireRole.ts` or `express.d.ts` | Both are already correct by construction |
| Do not change `src/db/schema.sql` | ENUM value migration is tracked in `schema-alignment.md` (Phase 1) |

## Next Steps (ordered implementation sequence)

1. Fix `src/utils/response.ts` — add `code?: string` to `error()` and include it via conditional spread.
2. Fix `src/config/passport.ts` — update role types to `'ADMIN' | 'AGENT'`; add `.toUpperCase()` cast in both strategies.
3. Fix `src/modules/auth/auth.schemas.ts` — update `AuthUser.role`; export `UserRole` type alias.
4. Append variables to `.sample.env`.
5. Set up Jest infrastructure — install devDependencies; add scripts and jest config to `package.json`; create `jest.setup.ts`; run `npm test -- --passWithNoTests`.
6. Run `npx tsc --noEmit && npm run lint` — must both pass with zero errors.
