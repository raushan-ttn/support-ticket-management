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
