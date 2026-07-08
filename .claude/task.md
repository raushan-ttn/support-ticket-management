# Task List — Support Ticket Management (Backend API)

Traceable to `requirements.md`. Check off items as they are completed.

---

## Phase 0 — Infrastructure & Tooling ✅

- [x] Project scaffold: TypeScript strict, ESLint, Prettier, Jest/ts-jest (TS-1–TS-5)
- [x] `src/config/index.ts` — typed env config; only place `process.env` is read
- [x] `src/config/postgres.ts` — `pg.Pool` singleton with `query<T>()` + `withTransaction()`
- [x] `src/config/redis.ts` — ioredis singleton with `setCache/getCache/deleteCache/deleteCacheByPattern`
- [x] `src/config/passport.ts` — LocalStrategy + JwtStrategy
- [x] `src/utils/response.ts` — `success()` / `error()` helpers
- [x] `src/middlewares/errorHandler.ts` — global 4-arg error handler (last in app.ts)
- [x] `src/middlewares/requireRole.ts` — RBAC role guard middleware
- [x] `bin/www.ts` — server bootstrap + graceful shutdown (SIGTERM/SIGINT)
- [x] `src/app.ts` — middleware stack (helmet → cors → compression → morgan → json → passport → authLimiter → routes → errorHandler)

---

## Phase 1 — Database Schema & Seed

- [x] Initial schema: `users`, `tickets`, `comments` tables; ENUMs; indexes; `updated_at` trigger
- [x] **Schema alignment** (append versioned block to `schema.sql`) — `schema-alignment.md`
  - [x] Migrate ENUM values to uppercase (`ADMIN`, `AGENT`, `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`, `CANCELLED`, `LOW`, `MEDIUM`, `HIGH`, `URGENT`) — SM-1, DM-*, §3
  - [x] Add `CANCELLED` to `ticket_status` ENUM — SM-3
  - [x] Replace `critical` with `URGENT` in `ticket_priority` ENUM — §3.2
  - [x] Remove `user` role from `user_role` ENUM — RBAC-1
  - [x] Make `tickets.assigned_to` NOT NULL — DM-3
  - [x] Make `tickets.description` NOT NULL — §3.2
  - [x] Add `attachments` table (id, ticket_id FK, comment_id FK nullable, filename, storage_key, mime_type, size_bytes, uploaded_by FK, created_at) — §3.4, DM-8–DM-11
  - [x] Add index on `attachments.ticket_id` (and `comment_id`) — DM-11
  - [x] **Schema migration 2026-07-01:** add `type VARCHAR(100)`, `sub_type VARCHAR(100)`, `screenshot TEXT` (nullable) to `tickets`; add `screenshot TEXT` (nullable) to `comments`; add indexes on `tickets.type` and `tickets.sub_type` — DM-12, DM-13
- [x] `src/db/migrate.ts` — run schema.sql idempotently
- [x] `src/db/admin-seed.ts` — seeds 1 admin + 5 agents; bcrypt at 12 rounds — DM-2, TS-4
- [x] `src/db/tickets-seed.ts` — seeds 10 realistic tickets (with type/subType) + 2-3 comments each — TS-4

---

## Phase 2 — Auth Module ✅

- [x] `src/modules/auth/auth.schemas.ts` — `loginSchema`, `AuthUser` interface
- [x] `src/modules/auth/auth.service.ts` — `signToken()`, JWT sign, `last_logged_in` update
- [x] `src/modules/auth/auth.controller.ts` — `login()`, `getMe()`
- [x] `src/modules/auth/auth.routes.ts` — `POST /api/v1/auth/login`, `GET /api/v1/auth/me`
- [x] `authenticate` JWT middleware (from `auth.middleware.ts`)
- [x] `requireRole('ADMIN')` middleware

---

## Phase 3 — Config Additions & Queue Setup

- [x] Extend `src/config/index.ts` with SMTP, storage, and attachment-limit config sections — TS-7, TS-9, VAL-6
- [x] Add storage + attachment-limit vars to `.sample.env` — TS-9, VAL-6
- [x] ~~`src/config/queue.ts` — BullMQ `ConnectionOptions`~~ — **removed 2026-07-08**, BullMQ dropped from scope; see Phase 7/8 cleanup items

---

## Phase 4 — Tickets Module ✅

- [x] `src/modules/tickets/ticket.schemas.ts`
  - [x] `createTicketSchema` (title, description, priority?, type?, subType?, screenshot?) — FR-1b, VAL-2/VAL-3, DM-12/DM-13
  - [x] `updateTicketSchema` (title?, description?, priority?, type?, subType?, screenshot?) with `.refine` at-least-one — FR-4, DM-12/DM-13
  - [x] `statusTransitionSchema` (status enum) — FR-5
  - [x] `assignSchema` (assignedTo uuid) — FR-7
  - [x] `listTicketsQuerySchema` (status?, priority?, type?, search?, page, limit, sortBy, order) — SF-1–SF-4, DM-12
  - [x] Inferred TypeScript types via `z.infer`
  - [x] `TicketRow` response interface with `type`, `subType`, `screenshot` (nullable strings)
- [x] `src/modules/tickets/ticket.service.ts`
  - [x] `createTicket()` — auto-assign to admin, force `status=OPEN`, `createdBy=caller` — FR-1, FR-1a
  - [x] `listTickets()` — admin sees all; agent scoped to assigned/created; RBAC filter in SQL `WHERE` — FR-2, FR-2a, RBAC-3/4, SF-5
  - [x] `getTicketById()` — 404 if not found, 403 if out of scope — FR-3
  - [x] `updateTicket()` — title/description/priority; admin-only assignee update — FR-4, FR-4a, RBAC-5
  - [x] `transitionStatus()` — state machine read-then-write inside `withTransaction()`, row lock `FOR UPDATE`; 409 on invalid — FR-5, SM-1–SM-5
  - [x] `assignTicket()` — admin only; 400 if user not found — FR-7
  - [x] Cache: `getCache/setCache` for `ticket:{id}`; `deleteCache` on all writes — CACHE-1, CACHE-5
- [x] `src/modules/tickets/ticket.controller.ts`
  - [x] `create`, `list`, `getById`, `update`, `transitionStatus`, `assign`
  - [x] All catch → `next(err)`, `return` after `error()`
- [x] `src/modules/tickets/ticket.routes.ts`
  - [x] `POST /` (`authenticate`, `validateBody`, `create`)
  - [x] `GET /` (`authenticate`, `validateQuery`, `list`)
  - [x] `GET /:id` (`authenticate`, `getById`)
  - [x] `PATCH /:id` (`authenticate`, `validateBody`, `update`)
  - [x] `PATCH /:id/status` (`authenticate`, `validateBody`, `transitionStatus`)
  - [x] `POST /:id/assign` (`authenticate`, `requireRole('ADMIN')`, `validateBody`, `assign`)
- [x] Mount tickets router in `src/app.ts` at `/api/v1/tickets`

---

## Phase 5 — Comments Module

- [x] `src/modules/comments/comment.schemas.ts`
  - [x] `createCommentSchema` (message non-empty via text field; screenshot is a multer file, not a Zod field) — FR-8, VAL-2, DM-13a
  - [x] `CommentRow` response interface — include `id`, `ticketId`, `message`, `screenshot: string | null`, `createdBy`, `createdAt`
- [x] `src/modules/comments/comment.service.ts`
  - [x] `addComment()` — verify ticket exists (404); verify caller scope (403); store screenshot file via storage backend if provided (FR-8b); insert row; invalidate `ticket:{id}:comments` cache; trigger email notification queue job — FR-8, FR-8a, FR-8b, CACHE-5, FR-11 — **queue call is dead code, see Phase 7 cleanup item**
  - [x] `listComments()` — admin sees all; agent scoped; ordered by `created_at ASC`; include `screenshot` in SELECT — FR-9, FR-6, RBAC-3/4
  - [x] `getCommentById()` — return single comment with `screenshot`; 404 if not found or wrong ticket — FR-9a
  - [x] Cache: `getCache/setCache` for `ticket:{id}:comments`; invalidate on new comment — CACHE-2, CACHE-5
  - [x] ~~Auto-close scheduling: after assignee comment on non-terminal ticket, enqueue/replace delayed `auto-close:{ticketId}` job~~ — **removed from scope 2026-07-08; code still present, see Phase 8 cleanup item**
  - [x] ~~Creator reply: remove pending `auto-close:{ticketId}` job~~ — **removed from scope 2026-07-08; code still present, see Phase 8 cleanup item**
- [x] `src/modules/comments/comment.controller.ts` — `add`, `list`, `getById`
- [x] `src/modules/comments/comment.routes.ts` — mounted under `tickets.routes.ts`
  - [x] `GET /:id/comments` (`authenticate`, `list`)
  - [x] `GET /:id/comments/:commentId` (`authenticate`, `getById`) — FR-9a
  - [x] `POST /:id/comments` (`authenticate`, `upload.single('screenshot')`, validate message text, `add`) — multipart/form-data; screenshot is optional jpg/png file — FR-8, FR-8b

---

## Phase 6 — Storage Abstraction & Attachments

- [x] **Packages:** `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `sanitize-filename`, `mime-types`, `@types/sanitize-filename`, `@types/mime-types` — TS-9, FR-13c
- [x] `src/storage/index.ts` — `StorageBackend` interface (`save(key, stream, mimeType, sizeBytes): Promise<void>`, `getStream`, `delete`); `buildStorageKey()` returns `YYYY-MM-DD/{uuid}`; factory (`getStorageBackend()`) selects backend from `STORAGE_BACKEND` env. `url` is not returned by the backend — it is derived in `attachment.service.ts`'s `toAttachmentUrl()` from the stored key — NFR-13
- [x] `src/storage/local.ts` — saves to `{STORAGE_LOCAL_DIR}/{key}` (`STORAGE_LOCAL_DIR` defaults to `public`); served at `/{key}` via `express.static(config.storage.localDir)` — TS-9
- [x] `src/storage/s3.ts` — S3-compatible implementation (prod); returns S3 object URL as `url` — TS-9
- [x] Mount `public/` as static in `src/app.ts` via `express.static(config.storage.localDir)` for local dev file serving — TS-9
- [x] `src/modules/attachments/attachment.schemas.ts`
  - [x] `AttachmentRow` response interface: `{ id, ticketId, commentId, filename, mimeType, sizeBytes, uploadedBy, createdAt, url }` — no `storageKey` in response — §3.4, FR-14
- [x] `src/modules/attachments/attachment.service.ts`
  - [x] `uploadAttachments(ticketId, files, uploadedBy, commentId?)` — accepts array of files (multiple per call); ticket existence/scope verified by callers before invocation; validates each file: MIME (`image/jpeg`/`image/png` only → 415); size + count enforced at the `uploadAttachments` multer middleware (stream-level, VAL-6 → 400); sanitizes filename; UUID storage key per file (`buildStorageKey()`); saves via storage backend; persists one metadata row per file; returns `AttachmentRow[]` with derived `url` — FR-13, FR-13a/b/c
  - [x] Validates `commentId` belongs to same `ticketId` when provided (400 `INVALID_COMMENT_REFERENCE`) — DM-10
  - [x] `getAttachmentsByTicket(ticketId)` — returns all `AttachmentRow[]` for the ticket; cached as `ticket:{id}:attachments`; invalidated on new upload — CACHE-9, FR-14
  - [x] `getAttachmentsByComment(commentId)` — returns all `AttachmentRow[]` for a single comment — FR-14
- [x] Extend `ticket.service.getTicketById()` (and `createTicket`/`updateTicket`/`transitionStatus`/`assignTicket`) to include inline `attachments: AttachmentRow[]` in response — FR-14
- [x] Extend `comment.service.listComments()` (LEFT JOIN + `json_agg`, avoids N+1) and `getCommentById()` to include inline `attachments: AttachmentRow[]` per comment — FR-14
- [x] Extend `POST /api/v1/tickets` to accept optional PNG/JPG files via `uploadAttachments.array('files', maxFilesPerRequest)` multer; call `uploadAttachments()` after ticket insert — FR-13
- [x] Extend `PATCH /api/v1/tickets/:id` to accept optional PNG/JPG files via `uploadAttachments.array('files', maxFilesPerRequest)` multer; call `uploadAttachments()` on new files — FR-13
- [x] Extend `POST /api/v1/tickets/:id/comments` to accept optional PNG/JPG files via `uploadAttachments.array('files', maxFilesPerRequest)` multer alongside existing `screenshot` field; call `uploadAttachments()` with `commentId` — FR-13
- [x] **No separate attachment endpoints** — no `/api/v1/attachments/*` routes; upload is part of ticket/comment mutation endpoints; access is through ticket/comment response bodies only
- [x] Unit tests (`attachment.service.test.ts`) and TEST-9 integration coverage added to `ticket.controller.test.ts` / `comment.controller.test.ts` (upload success, disallowed MIME → 415, over-count → 400, inline attachments on GET, 403 for out-of-scope agent). Integration suites require a live Postgres/Redis to execute — not runnable in this sandbox (no Docker daemon); verified via `tsc --noEmit` and unit-test runs instead — TEST-9

---

## Phase 7 — Notifications (Email, Direct — No Queue)

> **Decision (2026-07-08):** email notifications are sent via a direct, non-queued
> call (fire-and-forget) — no BullMQ, no job queue at all. See `requirements.md` §5.4.

- [x] **Packages:** `nodemailer`, `@types/nodemailer` — TS-7
- [x] `src/jobs/mailer.ts` — Nodemailer transport factory (SMTP for prod, JSON/in-memory for `test`, Mailhog for dev) — TS-7, TEST-7
- [x] `src/jobs/notifications.ts` — direct email-sending functions (no queue/worker)
  - [x] `sendNewTicketEmail()`: email creator + admin; de-duplicate recipients — FR-10
  - [x] `sendCommentNotificationEmail()`: email creator + current assignee + admin, exclude comment author — FR-11, FR-11a, FR-11b
  - [x] Fire-and-forget: wrap in `try/catch`, log failure, never re-throw — NFR-8 (no retry/backoff without a queue)
- [x] Call `sendNewTicketEmail()` directly in `ticket.service.createTicket()` (fire-and-forget try/catch) — FR-10, NFR-8
- [x] Call `sendCommentNotificationEmail()` directly in `comment.service.addComment()` — FR-11
- [x] Graceful degradation: SMTP unavailable → log + skip, core API continues — NFR-11
- [x] **Cleanup:** removed `src/jobs/queues.ts` and `src/config/queue.ts` (BullMQ `emailQueue`, no longer used); removed `emailQueue.add('comment-notification', …)` call from `comment.service.ts` `addComment()`, replaced with the direct `sendCommentNotificationEmail()` call above; removed `bullmq` from `package.json`

---

## Phase 8 — Auto-Close Background Job — Removed From Scope

> **Removed 2026-07-08** (not deferred — dropped). Required a Redis-backed BullMQ
> delayed-job queue, which is not part of this implementation. See `requirements.md`
> §1.2 Out of Scope / former §5.5.

- [x] **Cleanup (dead code from before this decision):**
  - [x] Removed `systemCloseTicket()` from `src/modules/tickets/ticket.service.ts` (implemented the now-removed SM-6 system-only transition)
  - [x] Removed the `autoCloseQueue.add('auto-close', …)` / `autoCloseQueue.getJob(...)`/`.remove()` calls from `comment.service.ts` `addComment()` (assignee-schedules / creator-cancels logic)
  - [x] Removed `autoCloseQueue` export by deleting `src/jobs/queues.ts` entirely (alongside the Phase 7 cleanup item)
  - [x] Removed `AutoCloseJobData` from `src/types/jobs.ts`
  - [x] Removed `AUTO_CLOSE_DELAY_MS` config (`src/config/index.ts`) and `.sample.env` entry

---

## Phase 9 — Tests

- [ ] **State machine (TEST-1)**
  - [ ] Integration: all valid transitions succeed (`OPEN→IN_PROGRESS`, `IN_PROGRESS→RESOLVED`, `RESOLVED→CLOSED`, `OPEN→CANCELLED`, `IN_PROGRESS→CANCELLED`)
  - [ ] Integration: representative invalid transitions return `409` + `INVALID_STATUS_TRANSITION`
- [ ] **Ticket creation (TEST-2):** client-supplied `status`/`assignedTo` ignored; auto-assigned to admin with `OPEN`
- [ ] **RBAC scoping (TEST-3):** admin lists all tickets; agent list correctly scoped — FR-2a, SF-5
- [ ] **Assignment (TEST-4):** `403` for agent caller; `400` for non-existent target user — FR-7
- [ ] **Validation (TEST-5):** rejects missing/empty `title`, `description`, `message`; invalid enum values — VAL-2/VAL-3
- [ ] **Notifications (TEST-7)** — direct call, no queue
  - [ ] New-ticket send: sent to creator + admin; de-duplicated if same person — FR-10
  - [ ] Comment-notification send: excludes comment author; correct recipient set for all role combos — FR-11
  - [ ] Uses captured/JSON transport — no real mail sent — TS-7
- [ ] **Attachments (TEST-9)**
  - [ ] Allowed PNG/JPG within size limit → attachment metadata row created; `storageKey` absent from response; `url` present — FR-13
  - [ ] Disallowed MIME (e.g. PDF, GIF) → `415`; oversize → `400`; over file count → `400` — VAL-6, FR-13b
  - [ ] Ticket detail (`GET /api/v1/tickets/:id`) includes inline `attachments` array with correct metadata + `url` — FR-14
  - [ ] Comment list/detail includes inline `attachments` array per comment — FR-14
  - [ ] Caller without parent-ticket access → `403` on ticket/comment endpoints — RBAC-3/4
  - [ ] Uses `STORAGE_BACKEND=local` + `public/uploads` test directory; files cleaned up in `afterAll`

---

## Acceptance Criteria Checklist (§13)

- [ ] Ticket created via API; persisted; auto-assigned to admin with `OPEN` status
- [ ] Admin sees all tickets; agents scoped to assigned/created
- [ ] Ticket detail retrievable by id (`404`/`403` on miss/scope)
- [ ] Title, description, priority updatable; assignee change is admin-only
- [ ] Comments addable and listable; admin reads any ticket's comments
- [ ] Status transitions only through valid paths; invalid → `409`
- [ ] Keyword search and status filter work and respect caller scope
- [ ] Data survives restart (Postgres)
- [ ] Backend validation blocks invalid records
- [ ] Redis cache accelerates reads; degrades gracefully when unavailable
- [ ] No secrets committed
- [ ] State-machine integration tests pass
- [ ] New ticket emails creator + admin (async, non-blocking, direct call — no queue)
- [ ] New comment emails all involved parties, de-duplicated, excluding author
- [ ] Notification failures logged; never fail the originating request (no retry — direct call, not queued)
- [ ] PNG/JPG files uploadable to a ticket or comment via ticket/comment mutation endpoints; metadata in Postgres, bytes in storage backend
- [ ] Upload rejects non-PNG/JPG MIME types, oversize files, and over-count requests
- [ ] Attachment metadata (including direct-access `url`) returned inline in ticket detail and comment list/detail responses
- [ ] No separate attachment endpoints; no bytes cached in Redis
