# Plan: Phase 9 — Tests

> **Requirements:** TEST-1, TEST-2, TEST-3, TEST-4, TEST-5, TEST-7, TEST-9, NFR-2, NFR-3, NFR-8, NFR-11, NFR-12, VAL-2, VAL-3, VAL-6, FR-1, FR-1a, FR-2a, FR-7, FR-10, FR-11, FR-13, FR-14, RBAC-1, RBAC-3, RBAC-4, RBAC-5
> **Date:** 2026-07-09
> **Predecessor:** `.claude/plans/testing-strategy.md` (Phase 9 strategy — this plan supersedes it with current state analysis)

## Problem

Phase 9 requires test coverage across all modules: state machine (TEST-1), ticket creation auto-assign (TEST-2), RBAC scoping (TEST-3), assignment guard (TEST-4), input validation (TEST-5), direct-call email notifications (TEST-7), and the full attachments lifecycle (TEST-9). The test infrastructure was built incrementally by module implementers. As of 2026-07-09, seven `*.test.ts` files already exist covering substantial TEST-1 through TEST-5 ground, and two of the TEST-9 integration cases are partially covered inside the ticket and comment controller tests. However, four entire files are absent — `tests/factories.ts` (shared helpers), `src/jobs/notifications.test.ts` (TEST-7), `src/modules/attachments/attachment.controller.test.ts` (TEST-9 standalone attachment routes which do not yet exist in `app.ts`), and four middleware unit-test files — creating gaps against the 100%-middleware and 80%-job-worker coverage targets. This plan documents exactly what is already done, what gaps remain, and which new files to create or extend.

## Current State: What Exists

### Already-existing test files and their coverage

**`src/middlewares/authenticate.test.ts`** — Complete. Covers: no header → 401; malformed token → 401; expired token → 401; user not in DB → 401; blocked user → 401; valid token + DB hit → 200 + `req.user`; wrong-secret token → 401. No gaps against authenticate.ts.

**`src/modules/auth/auth.controller.test.ts`** — Complete. Covers POST /auth/login (valid, wrong password, non-existent email, blocked, missing email, invalid email, empty password) and GET /auth/me (no token, invalid token, valid token). No gaps for auth.

**`src/modules/tickets/ticket.service.test.ts`** — Substantially complete. Covers:
- TEST-2 (unit): `createTicket` auto-assigns to admin, ignores caller status; no-admin throws 500.
- TEST-5 (schema unit): `createTicketSchema` rejects missing/empty title, missing/empty description, invalid priority enum; defaults priority to MEDIUM.
- TEST-1 (unit): `transitionStatus` allows all 5 valid transitions; rejects 7 invalid pairs with `{ statusCode: 409, code: 'INVALID_STATUS_TRANSITION' }`; 404 when ticket not found; 403 when agent is not assignee.
- TEST-4 (unit): `assignTicket` throws 400 `USER_NOT_FOUND`; throws 404 when ticket not found.
- `getTicketById` cache hit, cache miss + populate, 404, 403 agent scope.
- `listTickets` SQL: no scope clause for ADMIN; scope clause `assigned_to`/`created_by` for AGENT.
- **Gaps**: The service test verifies the 409 payload shape has `statusCode` and `code` but does NOT assert a `from`/`to` field in the error payload. Check whether `transitionStatus` actually includes `from`/`to` in the thrown error (see ticket.service.ts). If the service does not include them, this gap is a spec vs. implementation discrepancy that the plan notes but does not require retrofitting — the integration test in `ticket.controller.test.ts` likewise does not assert `from`/`to` fields.

**`src/modules/tickets/ticket.controller.test.ts`** — Substantially complete. Covers:
- TEST-2 (integration): create sets status OPEN, assigns to admin, admin can also create, 401 without token, 400 missing title, 400 empty description.
- TEST-9 (integration): create with PNG+JPG → 201 + attachments array with `url`, no `storageKey`; disallowed MIME on create → 415; over file-count on create → 400.
- TEST-3 (integration): admin sees all tickets (total=2); agent sees only own 2 of 3 tickets.
- GET /:id: admin fetches any, agent fetches own, 404, 403 agent out-of-scope, 400 invalid UUID.
- TEST-9 (integration): GET /:id embeds attachments array, no `storageKey`; 403 for out-of-scope agent even with attachments.
- TEST-1 (integration): `it.each` for all 5 valid transitions → 200 + correct status; `it.each` for 5 invalid transitions → 409 + `INVALID_STATUS_TRANSITION` code (does NOT assert `from`/`to` body fields).
- TEST-4 (integration): agent assign → 403; non-existent target → 400 `USER_NOT_FOUND`; admin + valid agent → 200 + correct `assignedTo`.
- PATCH /:id: updates title/priority → 200; empty body → 400.
- TEST-9 (integration): PATCH accumulates attachments across create + update.
- **Gaps**: Does not test an invalid `status` enum value in PATCH /:id/status body (e.g. `{ status: 'INVALID' }` → 400 `VALIDATION_ERROR`). Does not test `assignedTo` as non-UUID in POST /:id/assign body → 400. The `from`/`to` payload assertion in 409 is absent (same as service test).

**`src/modules/comments/comment.service.test.ts`** — Substantially complete. Covers:
- `addComment`: inserts + returns `CommentRow`, invalidates cache, sends email with correct payload, does NOT re-throw on notification failure (NFR-8/11), throws 500 on DB insert failure, propagates 403 from `getTicketById`.
- `listComments`: cache hit returns without DB query; cache miss queries DB + populates cache; Redis read error graceful degrades.
- `getCommentById`: returns comment + both `commentId` and `ticketId` in query params; throws 404 `INVALID_COMMENT_REFERENCE`; propagates 403 from `getTicketById`.
- **Gaps**: Does not test that `createCommentSchema` rejects empty/whitespace message (schema-level unit test).

**`src/modules/comments/comment.controller.test.ts`** — Substantially complete. Covers:
- POST /:ticketId/comments: 201 with valid message + response shape; 400 empty message; 401 no token; 400 non-UUID ticketId; 404 non-existent ticket; 403 agent commenting on un-assigned ticket.
- TEST-9 (integration): comment with PNG+JPG → 201 + attachments array with `url`, `commentId`, no `storageKey`; disallowed MIME → 415; over file-count → 400.
- GET /:ticketId/comments: 200 empty array; ordered by createdAt ASC; 401; 403 out-of-scope agent.
- TEST-9 (integration): per-comment attachments array, no cross-comment leakage; no `storageKey`.
- GET /:ticketId/comments/:commentId: 200 single comment; 404 `INVALID_COMMENT_REFERENCE`; 400 non-UUID commentId; 401.
- TEST-9 (integration): single comment fetch embeds attachments, no `storageKey`.
- **Gaps**: Does not verify that `createCommentSchema` itself rejects invalid input (schema unit test, mirrors TEST-5 for comments). Does not test the `from`/`to` assertion in status transitions (comment module does not own that endpoint).

**`src/modules/attachments/attachment.service.test.ts`** — Substantially complete. Covers:
- `toAttachmentUrl`: returns absolute URL using `config.appUrl`.
- `uploadAttachments`: empty files → []; disallowed MIME → 415 `UNSUPPORTED_MEDIA_TYPE`; invalid `commentId` → 400 `INVALID_COMMENT_REFERENCE`; happy path → saves file + inserts metadata + returns `AttachmentRow[]` without `storageKey` + invalidates cache; with `commentId` → scoped insert; storage save failure → skip file, no DB row; metadata insert failure → deletes stored file, returns [].
- `getAttachmentsByTicket`: cache hit; cache miss + strips `storageKey` + computes `url` + writes cache; Redis read error degrades gracefully.
- `getAttachmentsByComment`: scoped query by `commentId`, no `storageKey`.
- **Gaps**: No coverage of the `deleteAttachment` function (if one exists), and no integration test for the standalone attachment routes (`/api/v1/tickets/:ticketId/attachments`, download, delete). However, reviewing `src/app.ts` shows no standalone attachment router is mounted — attachments are only accessible as embedded fields in tickets/comments or via the ticket/comment routes. The standalone attachment routes (`GET /attachments/:id/download`, `DELETE /attachments/:id`) are not yet implemented/mounted. The TEST-9 requirement for download and delete still applies and requires both the source implementation AND the tests.

## Gap Summary

| Gap | Severity | Affects Target |
|-----|----------|----------------|
| `tests/factories.ts` does not exist — all existing tests use inline `createUser` helpers and raw `request(app)` calls | Medium — convention violation, tech debt | N/A (non-functional) |
| `src/jobs/notifications.test.ts` does not exist | Critical — TEST-7 fully uncovered | 80% job-worker target at risk |
| `src/modules/attachments/attachment.controller.test.ts` does not exist AND standalone attachment routes (download/delete) are not mounted in `app.ts` | Critical — TEST-9 download/delete uncovered; no routes to test yet | 80% controller target |
| `src/middlewares/errorHandler.test.ts` does not exist | Critical — 100% middleware target unachievable | 100% middleware target |
| `src/middlewares/requireRole.test.ts` does not exist | Critical — 100% middleware target unachievable | 100% middleware target |
| `src/middlewares/validateBody.test.ts` does not exist | Critical — 100% middleware target unachievable | 100% middleware target |
| `src/middlewares/validateQuery.test.ts` does not exist | Critical — 100% middleware target unachievable | 100% middleware target |
| `ticket.service.test.ts` / `ticket.controller.test.ts`: 409 payload does not assert `from`/`to` fields | Low — spec says `from`/`to` in payload; service throws without those fields (implementation gap, not test gap) | N/A |
| `ticket.controller.test.ts`: missing test for invalid `status` enum → 400 and non-UUID `assignedTo` → 400 | Low — TEST-5 partially uncovered | 80% controller target |
| `comment.service.test.ts` / `comment.controller.test.ts`: no schema-level test for empty `message` → 400 | Low — TEST-5 partially uncovered (integration test for empty message field exists in controller test) | 90% service target |

## Approach

Three categories of work:

1. **Create `tests/factories.ts`** — shared factory functions + JWT minting used by all integration tests. Existing tests already work with inline helpers; `factories.ts` is a new shared module that implementers will reference in newly created files. Do not refactor existing test files to use factories (too risky for working tests).

2. **Create four middleware unit-test files** — pure `supertest`-on-minimal-`express` style matching the existing `authenticate.test.ts` pattern. No real DB, no pool, no Redis. These are fast unit tests.

3. **Create two new integration/unit test files** — `src/jobs/notifications.test.ts` (unit, direct function calls with `jsonTransport`) and `src/modules/attachments/attachment.controller.test.ts` (integration, requires standalone attachment routes to be mounted first — see dependency note below).

4. **Extend two existing files** — add 2-3 missing test cases to `ticket.controller.test.ts` (invalid enum → 400, non-UUID assignedTo → 400) and 1 case to `comment.service.test.ts` (schema rejects empty message).

**Dependency note:** `attachment.controller.test.ts` requires standalone attachment routes for download (`GET /api/v1/tickets/:ticketId/attachments/:attachmentId/download`) and delete (`DELETE /api/v1/tickets/:ticketId/attachments/:attachmentId`). These routes do not currently exist in `app.ts` or any routes file. The implementer must create `attachment.controller.ts`, `attachment.routes.ts`, and mount the router in `app.ts` as a prerequisite before writing the controller integration test. This is the only Phase 9 item that requires new source code (not just test code).

All test files follow the pattern established in `authenticate.test.ts`: named exports for helpers, `beforeEach(jest.clearAllMocks)` or `afterEach(TRUNCATE + flushdb)`, `afterAll(pool.end + redis.quit)`.

## Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `tests/factories.ts` | Create | Shared factory fns: `createUserInDb`, `mintToken`, `createTicketViaApi`, `createCommentViaApi` |
| `src/middlewares/errorHandler.test.ts` | Create | 100%-coverage unit tests for all branches in `errorHandler.ts` |
| `src/middlewares/requireRole.test.ts` | Create | 100%-coverage unit tests for `requireRole` |
| `src/middlewares/validateBody.test.ts` | Create | 100%-coverage unit tests for `validateBody` |
| `src/middlewares/validateQuery.test.ts` | Create | 100%-coverage unit tests for `validateQuery` |
| `src/jobs/notifications.test.ts` | Create | TEST-7: direct-call unit tests for `sendNewTicketEmail` and `sendCommentNotificationEmail` using `jsonTransport` |
| `src/modules/attachments/attachment.controller.ts` | Create (source, prerequisite) | Download and delete controller methods for standalone attachment routes |
| `src/modules/attachments/attachment.routes.ts` | Create (source, prerequisite) | `GET /:ticketId/attachments/:id/download`, `DELETE /:ticketId/attachments/:id` routes |
| `src/app.ts` | Modify (source, prerequisite) | Mount `attachmentRoutes` at `/api/v1/tickets` alongside ticket/comment routers |
| `src/modules/attachments/attachment.service.ts` | Modify (source, prerequisite) | Add `downloadAttachment(id, callerId, callerRole)` and `deleteAttachment(id, callerId, callerRole)` functions |
| `src/modules/attachments/attachment.controller.test.ts` | Create | TEST-9: integration tests for download and delete (requires above source changes) |
| `src/modules/tickets/ticket.controller.test.ts` | Extend | Add 2 missing TEST-5 cases: invalid status enum → 400; non-UUID `assignedTo` body → 400 |
| `src/modules/comments/comment.service.test.ts` | Extend | Add 1 missing TEST-5 case: `createCommentSchema` rejects empty/whitespace message |

## Schema Changes

None. All tables and columns required by Phase 9 tests already exist in `src/db/schema.sql`.

## Zod Schemas

No new Zod schemas needed. All schemas already exist:
- `createTicketSchema`, `statusTransitionSchema`, `assignSchema`, `updateTicketSchema`, `listTicketsQuerySchema` in `ticket.schemas.ts`
- `createCommentSchema` in `comment.schemas.ts`

## `tests/factories.ts` Design

This file lives at the project root `tests/` directory (not inside `src/`). It exports four helper functions used by integration tests.

**`createUserInDb(pool, opts)`**
- Parameters: `pool` from `src/config/postgres.ts`, `opts: { name?: string; email: string; role: 'ADMIN' | 'AGENT'; password?: string }`
- Behavior: `bcrypt.hash(password, 12)`, then `INSERT INTO users (name, email, password_hash, role) RETURNING id`
- Returns: `{ id: string; email: string; role: 'ADMIN' | 'AGENT' }`

**`mintToken(userId, role)`**
- Parameters: `userId: string`, `role: 'ADMIN' | 'AGENT'`
- Behavior: `jwt.sign({ sub: userId, role }, config.jwt.secret, { expiresIn: '1h' })`
- Returns: `string` (the JWT)
- Rationale: avoids hitting the rate-limited `/auth/login` endpoint in integration tests (same pattern as all existing tests)

**`createTicketViaApi(app, token, overrides?)`**
- Parameters: `app` (Express app), `token: string`, `overrides?: { title?: string; description?: string; priority?: string }`
- Behavior: `request(app).post('/api/v1/tickets').set('Authorization', 'Bearer ' + token).send({ title: 'Test Ticket', description: 'Test description', ...overrides })`
- Returns: `supertest.Response` (caller asserts `.body.data.id`)

**`createCommentViaApi(app, ticketId, token, message?)`**
- Parameters: `app`, `ticketId: string`, `token: string`, `message?: string`
- Behavior: `request(app).post('/api/v1/tickets/${ticketId}/comments').set(...).field('message', message ?? 'Test comment')`
- Returns: `supertest.Response`

Note: `tests/factories.ts` imports `config` and `pool` from the `src/` tree. It does NOT close the pool itself. Each test file closes its own pool in `afterAll`.

## Business Logic for Missing Source Code (attachment.service.ts additions)

Two new functions must be added to `src/modules/attachments/attachment.service.ts` before the controller test can be written.

**`downloadAttachment(id, callerId, callerRole)`**
- Fetch attachment row (`id`, `ticketId`, `storageKey`, `mimeType`, `filename`) from DB — named columns only, no `SELECT *`
- If not found: throw `{ statusCode: 404, code: 'NOT_FOUND' }`
- Check ticket access: call `getTicketById(ticketId, callerId, callerRole)` from `ticket.service.ts`; if it throws 403/404, propagate
- Get storage backend via `getStorageBackend()`
- Return `{ stream: Readable, mimeType: string, filename: string }` — controller pipes stream to response

**`deleteAttachment(id, callerId, callerRole)`**
- Fetch attachment row including `uploadedBy` and `storageKey`
- If not found: throw `{ statusCode: 404, code: 'NOT_FOUND' }`
- Check ticket access via `getTicketById`
- Authorization: if `callerRole !== 'ADMIN'` AND `uploadedBy !== callerId` → throw `{ statusCode: 403, code: 'FORBIDDEN' }`
- Delete from storage backend (fire-and-forget on storage failure — log, continue)
- Delete DB row: `DELETE FROM attachments WHERE id = $1`
- Invalidate cache: `deleteCache('ticket:' + ticketId + ':attachments')`

## Test Cases Per File

### `tests/factories.ts` (New)
Not a test file — no `describe`/`it` blocks. Just the four factory functions described above.

### `src/middlewares/errorHandler.test.ts` (New — 100% coverage target)

Uses a minimal Express app (`express()` + `errorHandler`) with no DB mock needed. Tests pass errors via `next(err)`.

Test cases:
1. `multer.MulterError` with code `LIMIT_FILE_SIZE` → 400 `VALIDATION_ERROR` + message "File exceeds the maximum allowed size"
2. `multer.MulterError` with code `LIMIT_FILE_COUNT` → 400 `VALIDATION_ERROR` + message "Too many files in a single request"
3. `multer.MulterError` with code `LIMIT_UNEXPECTED_FILE` → 400 `VALIDATION_ERROR` + message "Unexpected file field name"
4. `multer.MulterError` with any other code → 400 `VALIDATION_ERROR` + `err.message` as the message
5. `ZodError` (from `z.parse` failure) → 400 `VALIDATION_ERROR` + formatted issue string `"path: message"`
6. `ZodError` with no path on an issue → 400 `VALIDATION_ERROR` + `"body: message"` (the `|| 'body'` branch)
7. Domain error with `statusCode: 404` and `code: 'NOT_FOUND'` → 404 response with `code` in body
8. Domain error with `statusCode: 409` and `code: 'INVALID_STATUS_TRANSITION'` → 409 response
9. Error with no `statusCode` (generic `new Error('boom')`) → 500
10. Error with `statusCode >= 500` in `NODE_ENV=production` → message is "Internal Server Error" (not `err.message`) — set `NODE_ENV` for this test only and restore
11. Error with `statusCode < 500` in `NODE_ENV=production` → message is `err.message` (client errors are not masked)
12. Error in `NODE_ENV=development` → `stack` field present in response body
13. Error with no `code` property → response body does NOT include `code` key
14. Error with `code` present → response body DOES include `code` key

Setup: `const testApp = express(); testApp.use(express.json()); testApp.get('/trigger', (_req, _res, next) => next(err)); testApp.use(errorHandler)`; build a fresh testApp per test or parameterize the route.

### `src/middlewares/requireRole.test.ts` (New — 100% coverage target)

Uses a minimal Express app with `authenticate` mocked OR with `req.user` set manually. Best approach: create a test middleware that sets `req.user` before `requireRole` runs, so no JWT/DB involvement.

Test cases:
1. `req.user` is undefined (unauthenticated) + `requireRole('ADMIN')` → 403 `{ success: false, message: 'Forbidden' }` — no `code` field (requireRole does not pass a code)
2. User with role `'AGENT'` + `requireRole('ADMIN')` → 403
3. User with role `'ADMIN'` + `requireRole('ADMIN')` → calls `next()`, proceeds to handler → 200
4. User with role `'AGENT'` + `requireRole('AGENT')` → calls `next()` → 200
5. User with role `'ADMIN'` + `requireRole('ADMIN', 'AGENT')` (variadic roles) → 200 (covers the `roles.includes` branch with multiple values)
6. User with role `'AGENT'` + `requireRole('ADMIN', 'AGENT')` → 200

Setup: build a minimal `express()` app with a route `testApp.get('/test', setUserMiddleware(role), requireRole(...roles), (req, res) => res.json({ ok: true }))` where `setUserMiddleware` simply does `req.user = { id: 'x', role, ... }; next()`.

### `src/middlewares/validateBody.test.ts` (New — 100% coverage target)

Uses `z.object({ name: z.string().min(1) })` as a minimal test schema. No DB.

Test cases:
1. Valid body `{ name: 'Alice' }` → body replaced with parsed result, `next()` called → 200
2. Missing required field `{}` → 400 `VALIDATION_ERROR` + message containing `"name"` path and `"Required"` or similar
3. Empty string fails `min(1)` → 400 `VALIDATION_ERROR`
4. `safeParse` error with nested path (e.g. `z.object({ user: z.object({ name: z.string() }) })` with `{}`) → message contains `"user.name"` (covers `path.join('.')` branch)
5. `safeParse` error with empty path (top-level `z.string()` schema on a body object) → message contains `"body:"` (covers `|| 'body'` branch)
6. Extra fields in body with a schema that does not strip → extra fields may pass through (coverage of `result.data` assignment)

### `src/middlewares/validateQuery.test.ts` (New — 100% coverage target)

Mirror of `validateBody.test.ts` but parses `req.query`. Use `z.object({ page: z.coerce.number().int().min(1) })`.

Test cases:
1. Valid query string `?page=2` → `req.query.page` is `2` (coerced number), `next()` called
2. Invalid query `?page=abc` → 400 `VALIDATION_ERROR` + message with `"page"` path
3. Missing required query param → 400 `VALIDATION_ERROR`
4. Error with nested path → message uses `"path.join('.')"` (covers that branch)
5. Error with empty path → message uses `"query:"` (covers `|| 'query'` branch — note: `validateQuery.ts` uses `'query'` not `'body'` as the fallback)

### `src/jobs/notifications.test.ts` (New — 80% job-worker coverage target, TEST-7)

This is a unit test that calls `sendNewTicketEmail` and `sendCommentNotificationEmail` directly. The `jsonTransport` is activated automatically because `NODE_ENV=test` (see `mailer.ts` line 11). However, the functions call `query` from postgres to resolve emails and call `getTransport().sendMail`. We must mock `query` but let `getTransport()` use the real `jsonTransport` singleton (which does not send real mail).

Alternative and safer approach: mock `query` to return controlled email addresses, then let `sendMail` execute on the real `jsonTransport`. Assert on the nodemailer `info.envelope` or `info.message` object returned by `sendMail` — the `jsonTransport` returns the serialized mail as `info.message` (JSON string). Capture this by spying on `getTransport().sendMail`.

Setup:
```
jest.mock('../config/postgres', () => ({ query: jest.fn() }))
// Do NOT mock jobs/mailer — let jsonTransport run
```

**`sendNewTicketEmail` test cases (TEST-7):**

1. **Creator and admin are different users** → `resolveEmails` called with `[creatorId, adminId]`, query returns two distinct emails → `sendMail` called once with `to` containing both emails
2. **Creator and admin are the SAME person** → `resolveEmails` called with `[id, id]`; the `new Set(ids)` de-duplicates to one ID; query returns one email → `sendMail` called once with one recipient (de-duplication test, FR-10)
3. **No users found** (query returns empty rows) → `sendMail` is NOT called (the `if (recipients.length === 0) return` branch)
4. **`sendMail` throws** (simulate by making `jsonTransport` error — spy on `sendMail` to throw) → function resolves without re-throwing (fire-and-forget, NFR-8)
5. **`query` throws** (simulate DB error in `resolveEmails`) → function resolves without re-throwing (NFR-8)

**`sendCommentNotificationEmail` test cases (TEST-7):**

6. **Comment author is the creator** (same ID) → `commentAuthorId === creatorId`; recipient list excludes author; admin and assignee receive email (covers the `.filter(id => id && id !== data.commentAuthorId)` exclusion)
7. **Comment author is the assignee** → assignee excluded from recipients; creator and admin receive email
8. **Comment author is the admin** → admin excluded; creator and assignee receive email
9. **All three (creator, assignee, admin) are distinct from author** → all three receive email
10. **Creator, assignee, and admin are all the same person and are also the author** → no recipients → `sendMail` NOT called
11. **With `attachmentCount > 0` and `attachmentFilenames`** → email text includes the attachment note string
12. **With `attachmentCount` undefined** → no attachment note in email text
13. **`sendMail` throws** → resolves without re-throwing (NFR-8)
14. **`query` throws in `resolveEmails`** → resolves without re-throwing (NFR-8)

For tests 6–12, the spy on `sendMail` should capture the `to` field of the sent mail to assert recipients precisely. The `jsonTransport` does not deliver email but does execute the `sendMail` flow and resolve — calling the callback with `null, info` (or resolving the promise).

**Mock strategy:** `jest.mock('../config/postgres', () => ({ query: jest.fn() }))`. For each test, configure `mockQuery` to return the `{ id, email }` rows appropriate to the scenario. Use `jest.spyOn(mailer, 'getTransport')` to intercept `sendMail` only for the error/no-call tests; let it run on real `jsonTransport` for content assertion tests.

Imports: `import { sendNewTicketEmail, sendCommentNotificationEmail } from './notifications'` — direct call, no queue involvement.

### `src/modules/attachments/attachment.controller.test.ts` (New — TEST-9, prerequisite source changes required)

This file can only be written after the source additions: `downloadAttachment`/`deleteAttachment` in `attachment.service.ts`, `attachment.controller.ts`, `attachment.routes.ts`, and the router mount in `app.ts`.

Assumed routes (to be confirmed with the source implementation):
- `GET /api/v1/tickets/:ticketId/attachments/:attachmentId/download`
- `DELETE /api/v1/tickets/:ticketId/attachments/:attachmentId`

Setup: same pattern as `ticket.controller.test.ts` — real test DB + `afterEach(TRUNCATE + redis.flushdb())` + `afterAll(pool.end + redis.quit)`. Set `STORAGE_LOCAL_DIR=.tmp/test-uploads` in test env and clean up in `afterAll` with `fs.rm('.tmp/test-uploads', { recursive: true, force: true })`.

Test cases:

**Download (`GET /api/v1/tickets/:ticketId/attachments/:attachmentId/download`):**

1. **Admin downloads own-ticket attachment** → 200 + `Content-Type: image/png` + `Content-Disposition: attachment; filename="a.png"` header + binary body (TEST-9)
2. **Agent downloads attachment on their assigned ticket** → 200 (RBAC-4, accessible tickets only)
3. **Agent downloads attachment on ticket NOT assigned to them** → 403 `FORBIDDEN` (TEST-9, RBAC-4)
4. **Non-existent `attachmentId`** → 404 `NOT_FOUND`
5. **Non-UUID `attachmentId`** → 400 (path param validation)
6. **No auth token** → 401

**Delete (`DELETE /api/v1/tickets/:ticketId/attachments/:attachmentId`):**

7. **Uploader deletes their own attachment** → 204 no body (TEST-9, RBAC-5)
8. **Admin deletes any attachment (not uploader)** → 204 (TEST-9, RBAC-5)
9. **Agent who is NOT the uploader and NOT admin** → 403 `FORBIDDEN` (TEST-9, RBAC-5)
10. **Non-existent `attachmentId`** → 404 `NOT_FOUND`
11. **Non-UUID `attachmentId`** → 400
12. **No auth token** → 401
13. **Agent on out-of-scope ticket** → 403 (ticket access check before ownership check)
14. **Verify DB row is deleted** → after 204, a follow-up GET download of the same attachment returns 404

### Extensions to `src/modules/tickets/ticket.controller.test.ts`

Add to the existing `PATCH /api/v1/tickets/:id/status` describe block:

15. **Invalid status enum value** (`{ status: 'INVALID' }` on PATCH /:id/status) → 400 `VALIDATION_ERROR` (covers the `statusTransitionSchema` enum rejection path, completes TEST-5 for status)

Add to the existing `POST /api/v1/tickets/:id/assign` describe block:

16. **Non-UUID `assignedTo` in body** (`{ assignedTo: 'not-a-uuid' }`) → 400 `VALIDATION_ERROR` (covers `assignSchema` UUID validation, completes TEST-5 for assign)

### Extensions to `src/modules/comments/comment.service.test.ts`

Add a new `describe('createCommentSchema validation')` block (mirroring `createTicketSchema validation` in the ticket service test):

17. **`createCommentSchema` rejects empty string message** → `result.success` is `false`
18. **`createCommentSchema` rejects whitespace-only message** → `result.success` is `false`
19. **`createCommentSchema` accepts valid message** → `result.success` is `true`

These use `jest.requireActual('./comment.schemas')` — same pattern as the ticket schema tests.

## RBAC and Authorization

| Endpoint | ADMIN | AGENT | Enforcement |
|----------|:-----:|:-----:|-------------|
| `GET /:ticketId/attachments/:id/download` | ✅ | ✅ (accessible ticket only) | `getTicketById` in service throws 403 if out-of-scope |
| `DELETE /:ticketId/attachments/:id` | ✅ (any) | ✅ (own uploads only) | `uploadedBy === callerId` check in service; throws 403 otherwise |

## Cache Strategy

No new cache keys are introduced by Phase 9. The tests validate existing cache behavior:
- `ticket:{id}:attachments` is invalidated by `deleteAttachment` (assert `deleteCache` was called in the service unit tests for `deleteAttachment`)
- The ticket controller integration tests indirectly validate cache via `redis.flushdb()` in `afterEach`

## State Machine (TEST-1 — analysis of `from`/`to` in 409 payload)

Review `src/modules/tickets/ticket.service.ts` `transitionStatus` function: it throws `createHttpError('Invalid status transition: ' + from + ' → ' + to, 409, 'INVALID_STATUS_TRANSITION')`. The error message includes `from` and `to` in the text but they are NOT separate response body fields. The spec says "with `from`/`to` in payload" — this is an implementation gap in the service, not a test gap. The plan flags it but does NOT require adding tests for `from`/`to` as separate body fields, because the implementation does not produce them. If the implementer adds `from`/`to` fields to the error, the integration test in `ticket.controller.test.ts` should be extended to assert `res.body.from` and `res.body.to`.

## Error Cases for New Tests

| Scenario | HTTP | Code | File |
|----------|------|------|------|
| Download: attachment not found | 404 | `NOT_FOUND` | `attachment.controller.test.ts` |
| Download: agent out-of-scope | 403 | `FORBIDDEN` | `attachment.controller.test.ts` |
| Delete: non-uploader non-admin agent | 403 | `FORBIDDEN` | `attachment.controller.test.ts` |
| Delete: attachment not found | 404 | `NOT_FOUND` | `attachment.controller.test.ts` |
| Invalid status enum in body | 400 | `VALIDATION_ERROR` | `ticket.controller.test.ts` (extend) |
| Non-UUID `assignedTo` in body | 400 | `VALIDATION_ERROR` | `ticket.controller.test.ts` (extend) |
| `MulterError.LIMIT_FILE_SIZE` | 400 | `VALIDATION_ERROR` | `errorHandler.test.ts` |
| `ZodError` | 400 | `VALIDATION_ERROR` | `errorHandler.test.ts` |
| Generic Error, no statusCode | 500 | (none) | `errorHandler.test.ts` |
| requireRole role mismatch | 403 | (none) | `requireRole.test.ts` |
| validateBody schema failure | 400 | `VALIDATION_ERROR` | `validateBody.test.ts` |
| validateQuery schema failure | 400 | `VALIDATION_ERROR` | `validateQuery.test.ts` |

## Coverage Target Analysis

| Layer | Current State | Files Needed | Achievability |
|-------|--------------|-------------|---------------|
| Middleware (100%) | `authenticate.ts` covered; `errorHandler.ts`, `requireRole.ts`, `validateBody.ts`, `validateQuery.ts` uncovered | 4 new test files | Achievable once all 4 new files are written |
| Services (90%) | `ticket.service.ts`, `comment.service.ts`, `attachment.service.ts` substantially covered; `notifications.ts` 0% | `notifications.test.ts` + 3 new service functions in attachment.service.ts | Achievable |
| Controllers (80%) | `auth.controller.ts` covered; `ticket.controller.ts` covered; `comment.controller.ts` covered; `attachment.controller.ts` does not exist yet | Create `attachment.controller.ts` + `attachment.controller.test.ts` | Achievable only after source is created |
| Job workers (80%) | `notifications.ts` has 0% coverage | `notifications.test.ts` | Achievable — 14 test cases cover all 3 branches in each function |

## Risks

1. **`attachment.controller.ts` does not exist** — this is the most significant risk. The TEST-9 download/delete scenarios are specified in requirements but the source code and routes have not been implemented. The implementer must write source code (not just tests) for this feature. The plan treats this as the final step and marks it as a prerequisite dependency.

2. **`jsonTransport` singleton** — `mailer.ts` uses a module-level singleton `transporter`. If tests import `notifications.ts` and the first test creates the singleton in test mode, subsequent tests will reuse it correctly. However, if any test sets `process.env.NODE_ENV` to something other than `'test'` mid-run (for `errorHandler` production-mode tests), the singleton will already be set and will stay as `jsonTransport`. Use `jest.resetModules()` and re-import in those tests that change `NODE_ENV`, or avoid changing `NODE_ENV` globally and instead mock the `config.env` property directly.

3. **Open handles** — the attachment controller integration test adds a new `afterAll` with `fs.rm` for local storage cleanup. Ensure this runs even on test failure by wrapping in try/catch.

4. **`tests/factories.ts` path** — Jest's `testMatch: ["**/*.test.ts"]` does not pick up `factories.ts` as a test file. The `tests/` directory at the repo root is outside `src/` so it will NOT be included in `collectCoverageFrom: ["src/**/*.ts"]`. No jest config change needed.

5. **`afterEach` truncation order** — existing tests truncate `attachments, comments, tickets, users` in that order (CASCADE). The new attachment controller test must use the same order. If local storage files were written in a test, they must be cleaned up in `afterAll`, not `afterEach` (to avoid race conditions with concurrent cleanup).

6. **`from`/`to` in 409 response** — as noted above, the current service implementation does not include `from`/`to` as separate response body fields. The plan does not require tests for fields that don't exist, but notes this as a spec discrepancy.

7. **`disconnectPostgres` vs `pool.end()`** — `auth.controller.test.ts` uses `disconnectPostgres()` (named export from `postgres.ts`); the ticket and comment tests use the default export `pool.end()`. Both are correct. New tests should use `pool.end()` and `redis.quit()` to match the majority pattern.

## Non-Negotiables Checklist

- [ ] No `process.env` outside `src/config/index.ts` — tests reference `config.jwt.secret`, `config.attachment.maxFilesPerRequest`, `config.appUrl` through the imported `config` object, never `process.env` directly
- [ ] All SQL uses `$1, $2` placeholders — test files do not write SQL; only `tests/factories.ts` inserts SQL, which already follows the pattern from existing tests
- [ ] No `SELECT *` — `tests/factories.ts` uses `RETURNING id` only
- [ ] SQL only in `*.service.ts` — test helper SQL in `factories.ts` is seeding-only, not business logic
- [ ] `success()`/`error()` — test files do not call these; they assert on the response shape
- [ ] `next(err)` in controller catch — existing controllers already comply; `attachment.controller.ts` must follow the same pattern
- [ ] `return` after every `error()` call — applies to `attachment.controller.ts` source code
- [ ] TypeScript `strict: true` — all new test files must not use `any`; use `unknown` + type assertions where needed
- [ ] Unused params prefixed with `_` — `_req`, `_res`, `_next` in test middleware stubs
- [ ] Notification sends are fire-and-forget — `notifications.test.ts` specifically asserts this (test case 4 and 13 above)

## Next Steps (ordered implementation sequence)

1. Create `tests/factories.ts` with the four factory functions
2. Create `src/middlewares/errorHandler.test.ts` (14 test cases — fastest to write, no DB dependency)
3. Create `src/middlewares/requireRole.test.ts` (6 test cases)
4. Create `src/middlewares/validateBody.test.ts` (6 test cases)
5. Create `src/middlewares/validateQuery.test.ts` (5 test cases)
6. Run `npm test -- --testPathPattern=middlewares` to confirm 100% middleware coverage
7. Create `src/jobs/notifications.test.ts` (14 test cases, mock `query`, real `jsonTransport`)
8. Run `npm test -- --testPathPattern=notifications` to confirm 80%+ job-worker coverage
9. Extend `src/modules/tickets/ticket.controller.test.ts` (add 2 test cases: invalid status enum → 400, non-UUID assignedTo → 400)
10. Extend `src/modules/comments/comment.service.test.ts` (add `createCommentSchema` validation describe block with 3 cases)
11. Add `downloadAttachment` and `deleteAttachment` to `src/modules/attachments/attachment.service.ts`
12. Create `src/modules/attachments/attachment.controller.ts` (download and delete controller methods)
13. Create `src/modules/attachments/attachment.routes.ts` (two routes with authenticate middleware)
14. Mount `attachmentRoutes` in `src/app.ts` at `/api/v1/tickets`
15. Create `src/modules/attachments/attachment.controller.test.ts` (14 test cases, real test DB)
16. Run `npm run test:coverage` and verify all targets met: middleware 100%, services 90%, controllers 80%, job workers 80%
