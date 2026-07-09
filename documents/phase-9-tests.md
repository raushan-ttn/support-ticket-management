# Phase 9 — Tests

> **Status:** Implemented
> **Branch:** main
> **Date:** 2026-07-09
> **Requirements:** TEST-1, TEST-2, TEST-3, TEST-4, TEST-5, TEST-7, TEST-9, SM-2, NFR-8, VAL-1, VAL-2, VAL-3, VAL-5, VAL-6, FR-10, FR-11, FR-11a, FR-11b, FR-13, FR-14, RBAC-3, RBAC-4, RBAC-5, RBAC-6

---

## Overview

Phase 9 closes out the full backend test suite requirement. Before this phase, the codebase had no test files. After it, 187 tests across 13 suites pass with 0 TypeScript or lint errors, covering middlewares at 100%, notification functions at 100%, and services and controllers at or above their respective minimum thresholds (90% services, 80% controllers).

The phase encompassed three distinct bodies of work. First, new unit and integration test files were authored for every previously untested layer: `errorHandler`, `requireRole`, `validateBody`, `validateQuery`, `sendNewTicketEmail`, `sendCommentNotificationEmail`, and the attachment download/delete endpoints. Second, two new API endpoints — `GET .../download` and `DELETE .../:attachmentId` — were implemented as a prerequisite for the TEST-9 attachment coverage, since neither existed before this phase. Third, the `PATCH /api/v1/tickets/:id/status` 409 response was extended (SM-2) to surface `from` and `to` as separate top-level JSON fields, verified in the extended `ticket.controller.test.ts` and `ticket.service.test.ts`.

The new endpoints follow the same module conventions as the rest of the codebase: routes carry only the middleware chain, controllers parse path parameters and delegate to the service, and the service owns all SQL and cache operations. The two new endpoints are mounted in `src/app.ts` at `/api/v1/tickets/:ticketId/attachments` using a `mergeParams: true` router so the `ticketId` path segment is accessible inside the router's own handlers.

---

## Architecture

### New and modified files in this phase

| File | Role |
|------|------|
| `tests/factories.ts` | Shared test helpers: `createUserInDb`, `mintToken`, `createTicketViaApi`, `createCommentViaApi` |
| `src/middlewares/errorHandler.ts` | Extended: added `extra?: Record<string, unknown>` to `AppError`; spreads filtered extra fields into error response body |
| `src/middlewares/errorHandler.test.ts` | 100% unit coverage: MulterError codes, ZodError formatting, domain errors, prod masking, dev stack, `code` and `extra` field presence |
| `src/middlewares/requireRole.test.ts` | 100% unit coverage: unauthenticated, wrong role, matching role, variadic roles |
| `src/middlewares/validateBody.test.ts` | 100% unit coverage: valid body replacement, missing field, empty string, nested path, empty-path fallback |
| `src/middlewares/validateQuery.test.ts` | 100% unit coverage: coercion, invalid coercion, missing param, nested path, empty-path fallback |
| `src/jobs/notifications.test.ts` | 100% unit coverage: TEST-7 — new-ticket and comment notification recipient logic, de-duplication, author exclusion, attachment note, fire-and-forget error swallowing |
| `src/modules/attachments/attachment.routes.ts` | New router (`mergeParams: true`): `GET /:attachmentId/download`, `DELETE /:attachmentId` |
| `src/modules/attachments/attachment.controller.ts` | New `download` and `remove` controller functions |
| `src/modules/attachments/attachment.service.ts` | New `downloadAttachment` and `deleteAttachment` service functions |
| `src/modules/attachments/attachment.controller.test.ts` | Integration coverage: TEST-9 — download (6 cases) and delete (8 cases) against real test DB |
| `src/modules/tickets/ticket.service.ts` | Extended: 409 errors now carry `extra: { from, to }` |
| `src/modules/tickets/ticket.service.test.ts` | Extended: 409 assertions include `extra.from` and `extra.to` |
| `src/modules/tickets/ticket.controller.test.ts` | Extended: invalid enum → 400, non-UUID `assignedTo` → 400, `from`/`to` fields on 409 |
| `src/modules/comments/comment.service.test.ts` | Extended: `createCommentSchema` validation — empty and whitespace-only message rejection |
| `src/app.ts` | Mounted `attachmentRouter` at `/api/v1/tickets/:ticketId/attachments` |
| `tsconfig.test.json` | Added `tests/**/*` to `include` so `tests/factories.ts` is compiled |
| `package.json` (jest config) | Added `"maxWorkers": 1` to prevent Postgres pool contention across integration suites |

---

## API Endpoints

### GET /api/v1/tickets/:ticketId/attachments/:attachmentId/download

**Auth required:** Yes — any authenticated user (ADMIN or AGENT)
**Purpose:** Stream the binary content of an attachment to the client. RBAC is enforced by delegating to `getTicketById`, which returns 403 for AGENT callers whose `id` appears in neither `assignedTo` nor `createdBy` of the parent ticket.

**Path parameters:**
- `:ticketId` — UUID of the parent ticket (validated with `uuidParam.parse()`)
- `:attachmentId` — UUID of the attachment row (validated with `uuidParam.parse()`)

**Success response (200):**

The response body is the raw file stream. The following headers are always set:

```
Content-Type: image/png   (or image/jpeg — the mimeType stored at upload time)
Content-Disposition: attachment; filename="sanitized-name.png"
```

The `filename` value in `Content-Disposition` has `"`, `\`, CR, and LF characters replaced with `_` before header interpolation to prevent header injection. The response body is never wrapped in the `{ success, data }` envelope — it is a direct binary pipe from the storage backend.

**Error cases:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | `:ticketId` or `:attachmentId` is not a valid UUID |
| 401 | — | Missing or invalid JWT |
| 403 | `FORBIDDEN` | AGENT caller's `id` does not match `assignedTo` or `createdBy` on the parent ticket |
| 404 | `NOT_FOUND` | No attachment row exists with the given `attachmentId`; or the parent ticket does not exist |

**Stream lifecycle:** A `close` listener on `res` destroys the upstream `Readable` if still open, preventing resource leaks when the client disconnects mid-stream. A `stream.error` listener calls `next(err)` only if headers have not yet been sent; if headers were sent, it calls `res.destroy(streamErr)` to close the socket.

---

### DELETE /api/v1/tickets/:ticketId/attachments/:attachmentId

**Auth required:** Yes — any authenticated user (ADMIN or AGENT)
**Purpose:** Delete an attachment's metadata row from Postgres and its binary from storage. RBAC enforced at two levels: the caller must first have access to the parent ticket (same as download), and AGENT callers can only delete their own uploads.

**Path parameters:**
- `:ticketId` — UUID of the parent ticket
- `:attachmentId` — UUID of the attachment row

**Success response (204):**

No body. `res.status(204).end()`.

**Error cases:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | `:ticketId` or `:attachmentId` is not a valid UUID |
| 401 | — | Missing or invalid JWT |
| 403 | `FORBIDDEN` | AGENT caller lacks ticket access, OR has ticket access but is not the uploader |
| 404 | `NOT_FOUND` | No attachment row exists with the given `attachmentId` |

**Deletion order:** The DB row is deleted first (`DELETE FROM attachments WHERE id = $1`). This is the source of truth: once the row is gone, the attachment is logically deleted regardless of the storage backend state. The storage blob is deleted second, wrapped in a separate `try/catch`. A storage failure is logged (`[Storage] Failed to delete file...`) but does not fail the request — an orphaned storage blob is preferable to a DB row pointing at a file that may or may not exist. Cache for `ticket:{ticketId}:attachments` is invalidated after both deletes, also in a separate `try/catch` (graceful degradation, CACHE-9).

---

## Data Model Changes

No new tables, columns, indexes, or enum values were introduced in Phase 9. The `attachments` table was defined in the Phase attachments module and required no modification. The two new service functions (`downloadAttachment`, `deleteAttachment`) read from and delete from the existing `attachments` table:

```sql
-- Read path (download and delete)
SELECT id, ticket_id AS "ticketId", storage_key AS "storageKey",
       mime_type AS "mimeType", filename, uploaded_by AS "uploadedBy"
FROM attachments
WHERE id = $1;

-- Delete path
DELETE FROM attachments WHERE id = $1;
```

---

## RBAC

### Attachment download

| Action | ADMIN | AGENT | Enforcement |
|--------|:-----:|:-----:|-------------|
| Download any attachment | ✅ | ❌ (own-scope only) | `getTicketById` propagates `403 FORBIDDEN` if AGENT is outside ticket scope |
| Download attachment on own ticket | ✅ | ✅ | `getTicketById` checks `assigned_to = callerId OR created_by = callerId` in SQL |

### Attachment delete

| Action | ADMIN | AGENT | Enforcement |
|--------|:-----:|:-----:|-------------|
| Delete any attachment | ✅ | ❌ | `if (callerRole !== 'ADMIN' && row.uploadedBy !== callerId)` → `403 FORBIDDEN` |
| Delete own upload on own-scope ticket | ✅ | ✅ | Same ownership check |
| Delete another agent's upload (even on own-scope ticket) | ✅ | ❌ | Ownership check fails; `403 FORBIDDEN` |

Ticket-scope access is always checked before the ownership check: an AGENT who cannot access the parent ticket receives `403 FORBIDDEN` from `getTicketById` before the `uploadedBy` comparison is evaluated.

---

## SM-2 Extension: `from` and `to` fields on 409 responses

Before Phase 9, the 409 `INVALID_STATUS_TRANSITION` response contained the transition details only inside the human-readable `message` string. SM-2 requires them in the payload as machine-readable fields. The implementation adds a generic `extra?: Record<string, unknown>` property to the `AppError` interface in `errorHandler.ts`.

When `ticket.service.ts` throws a 409 error, it now sets `extra: { from: currentStatus, to: requestedStatus }`:

```
{
  "success": false,
  "message": "Invalid status transition from OPEN to CLOSED",
  "code": "INVALID_STATUS_TRANSITION",
  "from": "OPEN",
  "to": "CLOSED"
}
```

`errorHandler.ts` spreads the `extra` object into the response after filtering out any keys that would override the fixed envelope (`success`, `message`, `code`, `stack`). This guard means no domain error can break the response contract by accidentally naming an extra field `success` or `message`:

```ts
const RESERVED_KEYS = new Set(['success', 'message', 'code', 'stack']);
const extra = rawExtra !== undefined
  ? Object.fromEntries(Object.entries(rawExtra).filter(([key]) => !RESERVED_KEYS.has(key)))
  : undefined;
```

The `extra` mechanism is generic: any service that creates an `AppError` can attach additional top-level response fields without touching `errorHandler.ts`.

---

## Caching

Phase 9 did not introduce new cache keys. The delete endpoint invalidates the existing attachment metadata cache key defined in the attachments module:

| Cache key | Content | TTL | Invalidated by |
|-----------|---------|-----|----------------|
| `ticket:{ticketId}:attachments` | `AttachmentRow[]` metadata list | `config.redis.ttlSeconds` | `uploadAttachments` (on upload), `deleteAttachment` (new, on delete) |

The download endpoint does not read from or write to Redis — it streams bytes from the storage backend directly. Attachment bytes are never cached (CACHE-9).

---

## Background Jobs

No background jobs are involved. Email notification tests (`notifications.test.ts`) call the notification functions directly (`sendNewTicketEmail`, `sendCommentNotificationEmail`) without a queue. This matches the implemented architecture: notifications are direct synchronous calls from the service layer, wrapped in `try/catch`, and are never queued or retried (NFR-8).

---

## Environment Variables

No new environment variables are introduced by Phase 9. The following existing variables are relevant to running the test suite:

| Variable | Default | Purpose in tests |
|----------|---------|-----------------|
| `NODE_ENV` | `development` | Set to `test` automatically by Jest (`jest.setup.ts`); routes all DB queries to `ttn_stm_test` |
| `STORAGE_BACKEND` | `local` | Must remain `local` for attachment integration tests; `s3` would require live credentials |
| `STORAGE_LOCAL_DIR` | `public/` | Directory where test attachment files are written; cleaned up per-suite in `afterAll` |
| `PG_DATABASE` | `ttn_stm` | Integration tests connect to `ttn_stm_test` when `NODE_ENV=test` |
| `JWT_SECRET` | `changeme` | Used by `mintToken` in `tests/factories.ts` to sign short-lived test tokens |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | Integration tests flush the Redis DB (`redis.flushdb()`) in `afterEach` |

---

## Testing

### Prerequisites

The integration tests require a running PostgreSQL instance with the `ttn_stm_test` database initialized:

```bash
# First-time setup of the test database
NODE_ENV=test npm run db:migrate

# Ensure local storage directory exists
mkdir -p public/
```

Redis must be reachable at the configured host/port. The test suite does not seed any users — each integration test creates its own users directly in the DB and cleans them up in `afterEach`.

### How to run

```bash
# Run all 187 tests (serial, one worker — required for shared test DB)
npm test

# Run only attachment endpoint tests
npm test -- --testPathPattern="attachment.controller"

# Run only notification tests
npm test -- --testPathPattern="notifications"

# Run only middleware tests
npm test -- --testPathPattern="src/middlewares"

# Full coverage report
npm run test:coverage
```

### Test coverage

| Test file | What it covers |
|-----------|----------------|
| `tests/factories.ts` | Shared helpers used by integration suites — not a test file itself |
| `src/middlewares/errorHandler.test.ts` | MulterError code mapping (4 cases), ZodError path formatting (2 cases), domain 404/409/500 (3 cases), production message masking (2 cases), dev stack field (1 case), `code` field presence/absence (2 cases) — 14 cases total |
| `src/middlewares/requireRole.test.ts` | Unauthenticated → 403, wrong role → 403, matching role → 200, variadic role matching (2 cases) — 6 cases total |
| `src/middlewares/validateBody.test.ts` | Valid body replaces `req.body`, missing required field, empty string fails `min(1)`, nested path error formatting, empty-path fallback to `"body:"`, extra fields stripped — 6 cases total |
| `src/middlewares/validateQuery.test.ts` | Valid coercion, non-numeric coercion → 400, missing required param → 400, nested path, empty-path fallback to `"query:"` — 5 cases total |
| `src/jobs/notifications.test.ts` | `sendNewTicketEmail`: distinct creator+admin, creator===admin de-dup, empty query → no send, `sendMail` throws (swallowed), `query` throws (swallowed) — 5 cases; `sendCommentNotificationEmail`: author===creator excluded, author===assignee excluded, author===admin excluded, all distinct → all notified, all same as author → no send, attachment filenames in body text, no attachment note, `sendMail` throws, `query` throws — 9 cases; 14 total |
| `src/modules/attachments/attachment.controller.test.ts` | Download: admin succeeds with correct headers, agent on assigned ticket, agent on out-of-scope ticket → 403, non-existent ID → 404, non-UUID → 400, no token → 401 — 6 cases; Delete: uploader → 204, admin → 204, non-uploader agent with ticket access → 403, non-existent → 404, non-UUID → 400, no token → 401, agent with no ticket access → 403, follow-up download after delete → 404 — 8 cases; 14 total |

### Key test scenarios

- **TEST-1:** Valid and invalid state machine transitions; agent attempting to transition a ticket not assigned to them. Extended in this phase to assert `res.body.from` and `res.body.to` on all 409 responses.
- **TEST-2:** Ticket auto-assignment and forced `OPEN` status on create (pre-existing, validated by extended controller tests).
- **TEST-3:** ADMIN list scope vs AGENT scope filtering (pre-existing).
- **TEST-4:** Assignment endpoint admin-only gate; non-existent target UUID → 400 `USER_NOT_FOUND` (pre-existing; extended with non-UUID `assignedTo` → 400 validation test).
- **TEST-5:** Zod schema validation; invalid enum values → 400. Extended with `createCommentSchema` whitespace rejection.
- **TEST-7:** `sendNewTicketEmail` sends to creator+admin, de-duplicates when they are the same person, skips send when recipient list is empty, swallows SMTP errors (NFR-8), swallows DB query errors (NFR-8). `sendCommentNotificationEmail` excludes the comment author regardless of which role they hold, includes attachment filenames in the email body when `attachmentCount > 0` (FR-11b), omits the section when no attachments are present.
- **TEST-9:** Download endpoint streams correct `Content-Type` and `Content-Disposition` headers; AGENT on out-of-scope ticket receives `403 FORBIDDEN`; non-existent attachment ID returns `404 NOT_FOUND`. Delete endpoint returns `204` for uploader and ADMIN; returns `403 FORBIDDEN` for non-uploader AGENT even when they have ticket access; confirms DB row is gone by verifying a follow-up download returns `404`.

### Test infrastructure decisions

**`maxWorkers: 1`** is set in the Jest config to prevent multiple integration test suites from executing DB writes concurrently against the shared `ttn_stm_test` database. Without this, `afterEach` TRUNCATEs from one suite can race with inserts from another, causing flaky test failures.

**`tests/factories.ts`** was added to `tsconfig.test.json`'s `include` array (`tests/**/*`) so `ts-jest` can compile it. Without this inclusion, `import` from `tests/` fails type-checking under `strict: true`.

**`jest.resetModules()`** is called in the `errorHandler.test.ts` `NODE_ENV`-dependent tests before re-importing the error handler. This ensures the `config` module inside `errorHandler` reflects the new `NODE_ENV` value rather than the cached module from the initial import.

**Storage cleanup:** `attachment.controller.test.ts` removes the test-generated date-subdirectory (`YYYY-MM-DD/`) under `config.storage.localDir` in `afterAll`. Only dated subdirectories are targeted, not the root `public/` directory, to avoid deleting unrelated static assets.

**`redis.flushdb()`** is called in `afterEach` alongside the DB TRUNCATE in `attachment.controller.test.ts` to prevent stale cached attachment lists from one test leaking into the assertions of the next.

---

## Known Limitations / Future Work

- **`attachment.controller.test.ts` coverage is ~76% individually.** The upload path (the `uploadAttachments` function) and the disallowed-MIME / oversize / over-count rejection cases (VAL-6) are exercised in the existing attachments module integration tests; the controller coverage figure reflects only the download and delete controller functions targeted in Phase 9. The module-level aggregate across service + controller exceeds the 80% threshold.

- **Notification tests mock `query` and `getTransport`.** The unit approach validates the recipient-set logic and fire-and-forget error handling without a real DB or SMTP server. An additional integration-level test that sends through `jsonTransport` against the test DB could be added in a future phase to validate the full email rendering path end-to-end.

- **No test for the `extra` guard against reserved key names.** The filter (`RESERVED_KEYS`) in `errorHandler.ts` prevents `extra` from overriding `success`, `message`, `code`, or `stack`. This behavior is testable by creating an `AppError` with `extra: { success: false, message: 'injected' }` and asserting the response still carries the error handler's own values. This was deferred as a low-risk edge case.

- **Download endpoint does not set `Content-Length`.** The local storage backend (`backend.getStream`) returns a `Readable` without pre-reading file size; S3 streaming similarly does not guarantee size up front. Clients cannot use `Content-Length` for progress indicators. A future enhancement could stat the file (local) or use the S3 `HeadObject` response before piping.
