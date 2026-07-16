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

## 2026-06-29 — Phase 1: Database Schema Gap Closure

**Branch:** auth_setup
**Requirements:** DM-3, DM-8, DM-9, DM-10, DM-11, SM-1, SM-3, §3.2, RBAC-1

### What was built
Closed five structural gaps in `src/db/schema.sql` blocking Phases 4, 6, and 8. Added `URGENT` to the `ticket_priority` ENUM (alongside existing `CRITICAL` for backwards compatibility); added `CANCELLED` to `ticket_status` ENUM as the terminal state machine state; made `tickets.description` and `tickets.assigned_to` NOT NULL to match requirements; replaced the `assigned_to` FK with `ON DELETE RESTRICT` to prevent orphaning; and created the `attachments` metadata table with columns for ticket reference, comment reference, filename, storage key, MIME type, file size, uploader, and timestamp, plus supporting indexes.

### Files added / modified
- `src/db/schema.sql` — Appended versioned 2026-06-29 migration block with 5 idempotent gap-closure statements (ALTER TYPE, UPDATE, ALTER TABLE, CREATE TABLE, CREATE INDEX)

### New API endpoints
None

### New environment variables
None

### Breaking changes
None (schema-only migration; all changes are additive)

---

## 2026-06-29 — Tickets Module (Phase 4)

**Branch:** ticket_module
**Requirements:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, SM-2, RBAC-1

### What was built
Implemented the core ticket lifecycle: creation (auto-assigned to first ADMIN), listing with role-based filtering (ADMIN sees all; AGENT sees only assigned or created tickets), retrieval with 403 scope protection, partial updates (title/description/priority), and state machine-driven status transitions. Added state machine validation rejecting invalid transitions (e.g., RESOLVED→IN_PROGRESS). Implemented ticket assignment (ADMIN only) with user existence validation returning 404 for missing users. All operations cache-invalidate ticket records and related lists. Unit tests mock postgres/redis; integration tests use `ttn_stm_test` database with full endpoint coverage including 401/403/404/409 scenarios.

### Files added / modified
- `src/modules/tickets/ticket.schemas.ts` — Zod schemas (createTicketSchema, updateTicketSchema, statusTransitionSchema, assignSchema, listTicketsQuerySchema); inferred types; TicketRow and TicketListResult interfaces
- `src/modules/tickets/ticket.service.ts` — 7 service functions: createTicket, listTickets, getTicketById, updateTicket, transitionStatus, assignTicket, systemCloseTicket (internal)
- `src/modules/tickets/ticket.controller.ts` — 6 HTTP handlers: create, list, getById, update, transitionStatus, assign
- `src/modules/tickets/ticket.routes.ts` — 6 routes mounted at `/api/v1/tickets`
- `src/modules/tickets/ticket.service.test.ts` — Unit tests with mocked postgres and redis
- `src/modules/tickets/ticket.controller.test.ts` — Integration tests with supertest and real test database
- `src/app.ts` — Mounted tickets router at `/api/v1/tickets`
- `src/middlewares/errorHandler.ts` — Added optional `code?: string` field to AppError interface and response envelope
- `src/config/index.ts` — NODE_ENV=test routes to ttn_stm_test database

### New API endpoints
- `POST /api/v1/tickets` — Create new ticket (auto-assigns to first ADMIN, status=OPEN)
- `GET /api/v1/tickets` — List tickets (ADMIN: all; AGENT: assigned/created only); supports ?status, ?priority, ?assignedTo, ?search, ?page, ?limit, ?sortBy, ?order
- `GET /api/v1/tickets/:id` — Fetch ticket by ID (returns 404/403 on miss/scope violation)
- `PATCH /api/v1/tickets/:id` — Update ticket title, description, or priority
- `PATCH /api/v1/tickets/:id/status` — Transition ticket through valid state machine paths (OPEN→IN_PROGRESS→RESOLVED→CLOSED or to CANCELLED)
- `POST /api/v1/tickets/:id/assign` — Assign ticket to user (ADMIN only; returns 404 if user not found)

### New environment variables
None

### Breaking changes
None

---

## 2026-07-01 — Comments Module (Phase 5)

**Branch:** master
**Requirements:** FR-8, FR-8a, FR-8b, FR-9, FR-9a, FR-11, FR-11a, FR-11b, FR-12, FR-12a, FR-12b, FR-12c, FR-12d, FR-12e, FR-12f, DM-6, DM-7, DM-13, DM-13a, VAL-1, VAL-2, RBAC-3, RBAC-4, RBAC-6, CACHE-2, CACHE-5, CACHE-7, SM-6, SM-7, TEST-7, TEST-8

### What was built
Implemented three comment endpoints enabling users to add comments with optional screenshot uploads (jpg/png only, stored via configured storage backend), list ticket comments ordered by creation time, and retrieve individual comments. Screenshot upload accepts binary files via multipart/form-data and stores the file via the storage backend (local or S3) without passing client-supplied URLs. Comments trigger two async side effects: email notifications to all ticket participants (via BullMQ emailQueue, deduplicating if creator/assignee/admin are the same person), and delayed auto-close job scheduling (FR-12) with job ID keying ensuring only one pending close per ticket; assignee comments schedule a delayed job while creator replies cancel it. RBAC scoping mirrors tickets: ADMIN sees all comments, AGENT sees comments only on assigned or created tickets (enforced in SQL via `getTicketById`). Comment lists are Redis-cached. Includes full unit and integration test coverage including file upload validation (MIME type, size limits) and role-based access control.

### Files added / modified
- `src/modules/comments/comment.schemas.ts` — Zod schema for message text only; CommentRow response interface with screenshot storage key
- `src/modules/comments/comment.service.ts` — Business logic: addComment (with file upload to storage backend), listComments (Redis-cached), getCommentById; fire-and-forget queue enqueue for email and auto-close jobs
- `src/modules/comments/comment.controller.ts` — HTTP handlers: add (file upload handling), list, getById
- `src/modules/comments/comment.routes.ts` — Three routes under `/api/v1/tickets/:ticketId/comments` with multer single-file upload middleware and validateBody for message
- `src/middlewares/upload.ts` — Multer configuration (memoryStorage, mime type allowlist jpg/jpeg/png, per-file size limit)
- `src/types/jobs.ts` — TypeScript interfaces: CommentNotificationJobData, AutoCloseJobData, NewTicketJobData for BullMQ payloads
- `src/config/queue.ts` — BullMQ ConnectionOptions singleton for dedicated ioredis connection (separate from cache redis)
- `src/jobs/queues.ts` — Exported emailQueue and autoCloseQueue BullMQ Queue instances with default job options
- `src/modules/comments/comment.service.test.ts` — Unit tests with mocked postgres, redis, storage, and queue
- `src/modules/comments/comment.controller.test.ts` — Integration tests with supertest, real test database, and file upload assertions

### New API endpoints
- `POST /api/v1/tickets/:ticketId/comments` — Add comment with optional screenshot file (multipart/form-data; jpg/png only); triggers email notification and auto-close job scheduling
- `GET /api/v1/tickets/:ticketId/comments` — List ticket comments ordered by createdAt ASC; RBAC-scoped; Redis-cached
- `GET /api/v1/tickets/:ticketId/comments/:commentId` — Fetch single comment by ID; RBAC-scoped via parent ticket validation

### New environment variables
- `STORAGE_BACKEND` — Storage backend for file uploads: `local` or `s3` (default: `local`)
- `STORAGE_LOCAL_DIR` — Local filesystem directory for uploads (default: `.uploads`)
- `AUTO_CLOSE_DELAY_MS` — Delay before auto-close job executes (default: `86400000`, 24 hours)
- `QUEUE_AUTO_CLOSE_DELAY_MS` — Alternative env var name for auto-close delay (read from config.queue.autoCloseDelayMs)

### Breaking changes
None

---

## 2026-07-08 — Attachments Module (Phase 6)

**Branch:** attachments_setup
**Requirements:** TS-9, FR-13, FR-13a, FR-13b, FR-13c, FR-15, VAL-6, DM-8, DM-10, DM-11, CACHE-9, NFR-12, NFR-13

### What was built
Introduced a pluggable file storage abstraction (`IStorageBackend`, local-filesystem and S3-compatible implementations, selected via `STORAGE_BACKEND`) and wired attachment uploads inline into the ticket and comment mutation endpoints — `POST`/`PATCH /api/v1/tickets` and `POST /api/v1/tickets/:ticketId/comments` now accept optional `files` (`image/jpeg`/`image/png` only, per-file size and per-request count limits) via `multipart/form-data`. Per FR-15, there are no standalone `/api/v1/attachments/*` endpoints at this stage — uploaded files are persisted to the storage backend, metadata-only rows are recorded in Postgres, and an `attachments[]` array (with a directly browser-openable, absolute `url`; `storageKey` never exposed) is embedded inline in ticket and comment responses. Fixed a broken multer chain on the comment route where two separate multer instances could not be chained on a single multipart request, by parsing `screenshot` and `files` in one `multer().fields()` pass.

### Files added / modified
- `src/modules/attachments/attachment.schemas.ts` — `AttachmentRow` response interface, upload validation schema
- `src/modules/attachments/attachment.service.ts` — `uploadAttachments()`, `toAttachmentUrl()`, `withAttachments()` helper for embedding metadata into ticket/comment responses
- `src/modules/attachments/attachment.service.test.ts` — unit tests for upload validation and metadata embedding
- `src/middlewares/uploadAttachments.ts` — multer config (memoryStorage, `image/jpeg`/`image/png` allowlist, configurable size/count limits)
- `src/middlewares/uploadCommentFiles.ts` — multer `.fields()` config combining `screenshot` + `files` in one pass
- `src/modules/tickets/ticket.service.ts`, `ticket.controller.ts`, `ticket.routes.ts`, `ticket.schemas.ts` — accept optional `files` on create/update; embed `attachments[]` via `withAttachments()`
- `src/modules/comments/comment.service.ts`, `comment.controller.ts`, `comment.routes.ts`, `comment.schemas.ts` — accept optional `files` on comment creation; embed `attachments[]`
- `src/app.ts` — storage backend static serving for local dev

### New API endpoints
None — attachments are accepted inline via existing ticket/comment mutation endpoints (FR-15); no standalone attachment routes at this stage (download/delete endpoints were added later in Phase 9, see the 2026-07-09 entry below).

### New environment variables
- `STORAGE_BACKEND` — `local` (default) or `s3`
- `STORAGE_LOCAL_DIR` — local storage root (default: `public`)
- `S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_ENDPOINT` — S3-compatible storage config
- `ATTACHMENT_MAX_FILE_SIZE_BYTES` / `ATTACHMENT_MAX_FILES_PER_REQUEST` — upload limits (VAL-6)

### Breaking changes
None

---

## 2026-07-08 — Decision: Drop BullMQ, Email Sent Directly, Auto-Close Removed From Scope

**Branch:** attachments_setup
**Requirements:** `requirements.md` §1.2 Out of Scope (removed TS-8, former §5.5/FR-12/SM-6/SM-7/NFR-9/NFR-10/TEST-8)

### What changed
Email notifications (Phase 7) will be sent via a **direct, non-queued call** from the service layer instead of through a BullMQ `email` queue/worker. The auto-close-on-stale-reply feature (formerly Phase 8 / FR-12), which required a Redis-backed BullMQ delayed-job queue, is **removed from scope** rather than deferred. See `requirements.md` §1.2, `.claude/plans/notifications-email.md`, and `task.md` Phase 7/8.

This is a planning/documentation change only — no source files were modified in this entry. The comments module entry above (2026-07-01) predates this decision: `comment.service.ts` still contains the `emailQueue.add()` / `autoCloseQueue.add()` calls it describes, `ticket.service.ts` still contains `systemCloseTicket()` (SM-6), and `src/config/queue.ts` / `src/jobs/queues.ts` / `src/types/jobs.ts`'s `AutoCloseJobData` still exist. All of this is now **dead code pending removal** — tracked in `task.md` Phase 7/8 cleanup items, to be removed alongside the direct-email implementation.

### Breaking changes
None yet (docs/plans only). The pending code cleanup will remove `bullmq` as a dependency and delete `src/config/queue.ts`, `src/jobs/queues.ts`, and `AutoCloseJobData`.

---

## 2026-07-08 — Swagger/OpenAPI Integration

**Branch:** main
**Requirements:** None (documentation/tooling)

### What was built
Added interactive API documentation via Swagger UI and OpenAPI 3.0.3 spec generation. JSDoc `@openapi` blocks documenting all existing API routes are scanned at startup by `swagger-jsdoc` and combined into a complete OpenAPI schema. Swagger UI is served at `GET /api-docs` for interactive endpoint exploration, and the raw OpenAPI JSON is available at `GET /api-docs.json` for client SDKs and tooling. The schema defines 9 documented paths (auth login/me, ticket CRUD and assignment, comment CRUD), 6 reusable component schemas (ErrorResponse, AuthUser, TicketRow, TicketListResult, CommentRow, AttachmentRow), JWT bearer-token security scheme, and shared error response definitions (Unauthorized, Forbidden, NotFound, ValidationError).

### Files added / modified
- `src/config/swagger.ts` (new) — `swagger-jsdoc` configuration; OpenAPI 3.0.3 definition with reusable schemas and security schemes; globs `src/app.ts` and `src/modules/**/*.routes.ts` for JSDoc `@openapi` blocks
- `src/app.ts` — Added `@openapi` JSDoc block for `GET /health`; mounted Swagger UI at `/api-docs` and raw spec at `/api-docs.json`
- `src/modules/auth/auth.routes.ts` — Added `@openapi` JSDoc blocks for `POST /api/v1/auth/login` and `GET /api/v1/auth/me`
- `src/modules/tickets/ticket.routes.ts` — Added `@openapi` JSDoc blocks for all 6 ticket endpoints (POST create, GET list, GET by ID, PATCH update, PATCH status transition, POST assign)
- `src/modules/comments/comment.routes.ts` — Added `@openapi` JSDoc blocks for all 3 comment endpoints (POST add, GET list, GET by ID); documented multipart/form-data file upload for screenshot/attachments
- `package.json` — Added `swagger-jsdoc` (^6.3.0) and `swagger-ui-express` (^5.0.1) as runtime dependencies; `@types/swagger-jsdoc` (^6.0.4) and `@types/swagger-ui-express` (^4.1.8) as devDependencies

### New API endpoints
- `GET /api-docs` — Swagger UI interface for interactive API documentation
- `GET /api-docs.json` — Raw OpenAPI 3.0.3 JSON schema

### New environment variables
None

### Breaking changes
None

---

## 2026-07-09 — Bug Fixes: List Attachments & Absolute URLs; CR: Remove `screenshot` Columns

**Branch:** main
**Requirements:** `requirements.md` DM-13/DM-13a (removed), FR-8/FR-8b (updated), FR-14 (list endpoint), TS-9/FR-13c/FR-15 (corrected)

### What was built
Two bug fixes plus a change request:

1. **Bug fix — `GET /api/v1/tickets` missing attachments.** `listTickets()` hardcoded `attachments: []` on every row instead of fetching them. Now maps each row through the same `withAttachments()` helper used by the other ticket endpoints, so list responses match detail responses.
2. **Bug fix — attachment `url` not directly openable.** For the local storage backend, `toAttachmentUrl()` returned a bare relative path (`/{storageKey}`). Added a new `APP_URL` config var (default `http://localhost:{PORT}`) and updated `toAttachmentUrl()` to return `${APP_URL}/${storageKey}`, an absolute URL that opens directly in a browser. S3 URLs were already absolute and are unaffected.
3. **CR — remove `tickets.screenshot` and `comments.screenshot`.** Both columns predated the `attachments` system and served the same purpose (linking an image to a ticket/comment) — `tickets.screenshot` as a plain client-supplied URL string, `comments.screenshot` as a single-file upload. Both are now redundant with the `attachments` system (multi-file, metadata-only in Postgres, bytes in the pluggable storage backend) and have been dropped in favor of it exclusively. Comment file uploads now go through the same `files` field / `uploadAttachmentFiles` middleware as ticket uploads; the dedicated `comment.middleware.ts` (which multiplexed a `screenshot` field alongside `files`) was deleted.

### Files added / modified
- `src/db/schema.sql` — new dated migration: `ALTER TABLE tickets DROP COLUMN IF EXISTS screenshot;` / `ALTER TABLE comments DROP COLUMN IF EXISTS screenshot;`
- `src/config/index.ts` — added `appUrl` config field, sourced from `APP_URL` env var
- `src/modules/attachments/attachment.service.ts` — `toAttachmentUrl()` now returns an absolute URL for the local backend
- `src/modules/tickets/ticket.service.ts` — `listTickets()` now populates `attachments`; removed `screenshot` from `TicketDbRow`, `TICKET_SELECT`, `TICKET_RETURNING`, `withAttachments()`, `createTicket()`, `updateTicket()`
- `src/modules/tickets/ticket.schemas.ts` — removed `screenshot` from `createTicketSchema`, `updateTicketSchema`, `TicketRow`
- `src/modules/tickets/ticket.routes.ts` — removed `screenshot` from Swagger request schemas
- `src/modules/comments/comment.schemas.ts` — removed `screenshot` from `CommentRow`
- `src/modules/comments/comment.service.ts` — removed `ALLOWED_SCREENSHOT_MIMES`, `toScreenshotUrl()`, and all `screenshot` SQL/mapping; `addComment()` no longer takes a single-file `file` parameter, only a `files` array
- `src/modules/comments/comment.controller.ts` — `add()` reads `req.files` as a flat array (same pattern as `ticket.controller.ts`)
- `src/modules/comments/comment.routes.ts` — switched from `uploadCommentFiles` to the shared `uploadAttachmentFiles`; removed `screenshot` from the Swagger multipart schema
- `src/modules/comments/comment.middleware.ts` — deleted (redundant with `attachment.middleware.ts`)
- `src/config/swagger.ts` — removed `screenshot` from `TicketRow` and `CommentRow` component schemas
- `.sample.env` — added `APP_URL`
- Test files updated to match: `ticket.service.test.ts`, `comment.service.test.ts`, `comment.controller.test.ts`
- `requirements.md`, `.claude/task.md`, `.claude/plans/tickets-module.md`, `.claude/plans/comments-module.md`, `.claude/plans/attachments-module.md`, `README.md` updated/annotated to match

### New environment variables
- `APP_URL` — base URL used to build absolute attachment URLs for the local storage backend; default `http://localhost:{PORT}`

### Breaking changes
**Yes.** `tickets.screenshot` and `comments.screenshot` are dropped from the database schema and from all request/response payloads (`TicketRow`, `CommentRow`). Clients that read or wrote these fields must migrate to the `attachments` system (`files` on upload, `attachments[]` on read). `POST /api/v1/tickets/:ticketId/comments` no longer accepts a `screenshot` multipart field — use `files` instead. Attachment `url` values for the local storage backend are now absolute instead of relative; clients that concatenated their own base URL onto a previously-relative `url` must stop doing so.

---

## 2026-07-09 — Phase 9: Complete Test Suite & Attachment Download/Delete Endpoints

**Branch:** main
**Requirements:** TEST-1, TEST-2, TEST-3, TEST-4, TEST-5, TEST-7, TEST-9

### What was built
Implemented a comprehensive backend test suite achieving 100% middleware coverage, ~90%+ service coverage, ~80%+ controller coverage across 13 test suites with 187 passing tests. Created shared test factory functions (`tests/factories.ts`) for common operations (user creation, JWT minting, API-based ticket/comment creation). Added middleware test suites for `errorHandler`, `requireRole`, `validateBody`, and `validateQuery` with full edge-case coverage including MulterError handling, ZodError, domain error code mapping, production stack masking, and reserved JSON field guarding. Implemented direct email notification tests (TEST-7) verifying new-ticket and comment-notification sends, recipient de-duplication, comment-author exclusion, and fire-and-forget failure handling. Extended ticket controller tests to validate invalid enum values and malformed UUID payloads returning 400; ticket service tests now assert `from`/`to` fields on 409 status transition errors. As a required prerequisite for TEST-9 attachment coverage, implemented two new API endpoints for download and delete: `GET /api/v1/tickets/:ticketId/attachments/:attachmentId/download` (streams file with correct headers, RBAC-scoped to ADMIN or ticket-accessible AGENT) and `DELETE /api/v1/tickets/:ticketId/attachments/:attachmentId` (deletes from storage and DB, 204 response; RBAC: ADMIN can delete any, AGENT can delete only own uploads). Implemented a generic domain-error `extra` field mechanism in `errorHandler.ts` to expose optional extra JSON fields (e.g., `from`/`to` for status transition errors) while preventing field collisions with the fixed envelope keys. Extended `tsconfig.test.json` to include `tests/**/*` for type checking shared factories; added `maxWorkers: 1` to jest config to prevent DB pool contention during integration tests.

### Files added / modified
- `tests/factories.ts` (new) — Shared factory functions: `createUserInDb()`, `mintToken()`, `createTicketViaApi()`, `createCommentViaApi()`
- `src/middlewares/errorHandler.test.ts` (new) — 14 test cases, 100% coverage (MulterError, ZodError, domain errors, status code mapping, stack field handling, production masking, reserved field filtering)
- `src/middlewares/requireRole.test.ts` (new) — 6 test cases, 100% coverage (ADMIN/AGENT role checks, 403 responses)
- `src/middlewares/validateBody.test.ts` (new) — 6 test cases, 100% coverage (Zod validation, 400 responses on parse failure)
- `src/middlewares/validateQuery.test.ts` (new) — 5 test cases, 100% coverage (query string coercion, defaults, validation)
- `src/jobs/notifications.test.ts` (new) — 14 test cases (TEST-7): `sendNewTicketEmail()` and `sendCommentNotificationEmail()`, recipient deduplication (creator + assignee + admin), comment-author exclusion, fire-and-forget error handling
- `src/modules/attachments/attachment.controller.ts` (new) — `download()` and `remove()` controller functions with RBAC scope checks
- `src/modules/attachments/attachment.routes.ts` (new) — Router with `GET /:attachmentId/download` and `DELETE /:attachmentId` routes
- `src/modules/attachments/attachment.service.ts` — Added `downloadAttachment()` and `deleteAttachment()` service functions
- `src/modules/attachments/attachment.controller.test.ts` (new) — 14 test cases (TEST-9): download and delete integration tests with full RBAC coverage (ADMIN, AGENT, non-accessible agent), file streaming assertions, 204/403/404 scenarios
- `src/modules/tickets/ticket.controller.test.ts` — Extended with invalid enum and malformed UUID validation tests; added from/to assertions on 409 responses
- `src/modules/tickets/ticket.service.test.ts` — Extended 409 transition error assertions to verify from/to fields
- `src/modules/tickets/ticket.service.ts` — Added optional `extra?: Record<string, unknown>` field to domain errors, implemented in status transition 409 responses as `{ from, to }`
- `src/middlewares/errorHandler.ts` — Implemented `extra` field support with reserved-key filtering to prevent collisions with envelope keys (success, message, code, stack)
- `src/modules/comments/comment.service.test.ts` — Extended with `createCommentSchema` validation tests (empty/whitespace message rejection)
- `tsconfig.test.json` — Added `tests/**/*` to include array for type checking
- `package.json` — Added `"maxWorkers": 1` to jest config; added `db:seed:tickets` script for test data
- `src/app.ts` — Mounted attachments router

### New API endpoints
- `GET /api/v1/tickets/:ticketId/attachments/:attachmentId/download` — Download attachment file; streams with correct `Content-Type` and `Content-Disposition: attachment` headers; RBAC: accessible to ADMIN or ticket-accessible AGENT (assigned or creator); returns 404 if attachment not found, 403 if caller lacks access
- `DELETE /api/v1/tickets/:ticketId/attachments/:attachmentId` — Delete attachment from storage and database; returns 204; RBAC: ADMIN can delete any, AGENT can delete only own uploads (checked via `uploadedBy`); returns 404 if attachment not found, 403 if caller lacks permission

### New environment variables
None

### Breaking changes
None (additive feature only)

---
