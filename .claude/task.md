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

- [x] Extend `src/config/index.ts` with SMTP, BullMQ, storage, and attachment-limit config sections — TS-7, TS-8, TS-9, VAL-6
- [x] Add storage + attachment-limit vars to `.sample.env` — TS-9, VAL-6
- [x] `src/config/queue.ts` — BullMQ `ConnectionOptions` (dedicated ioredis connection, NOT the cache singleton) — TS-8, db-conventions.md

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
  - [x] `addComment()` — verify ticket exists (404); verify caller scope (403); store screenshot file via storage backend if provided (FR-8b); insert row; invalidate `ticket:{id}:comments` cache; trigger email notification queue job — FR-8, FR-8a, FR-8b, CACHE-5, FR-11
  - [x] `listComments()` — admin sees all; agent scoped; ordered by `created_at ASC`; include `screenshot` in SELECT — FR-9, FR-6, RBAC-3/4
  - [x] `getCommentById()` — return single comment with `screenshot`; 404 if not found or wrong ticket — FR-9a
  - [x] Cache: `getCache/setCache` for `ticket:{id}:comments`; invalidate on new comment — CACHE-2, CACHE-5
  - [x] Auto-close scheduling: after assignee comment on non-terminal ticket, enqueue/replace delayed `auto-close:{ticketId}` job — FR-12f
  - [x] Creator reply: remove pending `auto-close:{ticketId}` job — FR-12a
- [x] `src/modules/comments/comment.controller.ts` — `add`, `list`, `getById`
- [x] `src/modules/comments/comment.routes.ts` — mounted under `tickets.routes.ts`
  - [x] `GET /:id/comments` (`authenticate`, `list`)
  - [x] `GET /:id/comments/:commentId` (`authenticate`, `getById`) — FR-9a
  - [x] `POST /:id/comments` (`authenticate`, `upload.single('screenshot')`, validate message text, `add`) — multipart/form-data; screenshot is optional jpg/png file — FR-8, FR-8b

---

## Phase 6 — Storage Abstraction & Attachments Module

- [x] **Packages:** `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `sanitize-filename`, `mime-types`, `@types/sanitize-filename`, `@types/mime-types` — TS-9, FR-13c
- [x] `src/storage/index.ts` — `IStorageBackend` interface (`save`, `getStream`, `delete`); factory selects backend from `STORAGE_BACKEND` env — NFR-13
- [x] `src/storage/local.ts` — local filesystem implementation (dev/test); saves to `public/YYYY-MM-DD/{uuid}` — TS-9
- [x] `src/storage/s3.ts` — S3-compatible implementation (prod) — TS-9
- [ ] `src/modules/attachments/attachment.schemas.ts`
  - [ ] `uploadAttachmentSchema` (optional `commentId`) — FR-13
  - [ ] `AttachmentRow` response interface (no `storage_key` — internal only) — §3.4, FR-14
- [ ] `src/modules/attachments/attachment.service.ts`
  - [ ] `uploadAttachments()` — verify ticket (404) + scope (403); validate MIME/size/count (VAL-6, 415/400); sanitize filename (FR-13c); server-generated storage key (UUID); persist metadata + bytes — FR-13, FR-13a/b/c
  - [ ] Validate `commentId` belongs to same `ticketId` — DM-10
  - [ ] `listAttachments()` — metadata only, scoped to ticket — FR-14, RBAC-3/4
  - [ ] `downloadAttachment()` — verify ticket scope (403); 404 if not found; stream from storage — FR-15, NFR-12
  - [ ] `deleteAttachment()` — uploader or admin only (403); delete metadata row + storage object — FR-16
  - [ ] Cache: `ticket:{id}:attachments` for metadata listing; invalidate on upload/delete — CACHE-9, FR-17
- [ ] `src/modules/attachments/attachment.controller.ts` — `upload`, `list`, `download`, `delete`
- [ ] `src/modules/attachments/attachment.routes.ts`
  - [ ] `POST /api/v1/tickets/:id/attachments` (`authenticate`, multer, `upload`)
  - [ ] `GET /api/v1/tickets/:id/attachments` (`authenticate`, `list`)
  - [ ] `GET /api/v1/attachments/:attachmentId` (`authenticate`, `download`)
  - [ ] `DELETE /api/v1/attachments/:attachmentId` (`authenticate`, `delete`)
- [ ] Mount attachments router in `src/app.ts`

---

## Phase 7 — Notifications (Email + BullMQ)

- [ ] **Packages:** `bullmq`, `nodemailer`, `@types/nodemailer` — TS-7, TS-8
- [x] `src/jobs/queues.ts` — define `emailQueue` and `autoCloseQueue` using `src/config/queue.ts` connection — TS-8
- [ ] `src/jobs/mailer.ts` — Nodemailer transport factory (SMTP for prod, JSON/in-memory for `test`, Mailhog for dev) — TS-7, TEST-7
- [ ] `src/jobs/emailWorker.ts` — BullMQ Worker consuming `email` queue
  - [ ] `new-ticket` job type: email creator + admin; de-duplicate recipients — FR-10
  - [ ] `comment-notification` job type: email creator + current assignee + admin, exclude comment author — FR-11, FR-11a, FR-11b
  - [ ] `auto-close-notification` job type: email creator + assignee + admin on auto-close — FR-12e
  - [ ] Retry with exponential backoff; log failures; never re-throw — NFR-8
- [ ] Enqueue `new-ticket` job in `ticket.service.createTicket()` (fire-and-forget try/catch) — FR-10, NFR-8
- [ ] Enqueue `comment-notification` job in `comment.service.addComment()` — FR-11
- [ ] Graceful degradation: queue unavailable → log + skip, core API continues — NFR-11

---

## Phase 8 — Auto-Close Background Job

- [ ] `src/jobs/autoCloseWorker.ts` — BullMQ Worker consuming `auto-close` queue (delayed jobs)
  - [ ] Execution-time re-validation: re-read ticket from Postgres; only close if non-terminal, most recent comment is assignee's, ≥48h elapsed — FR-12c, SM-6, SM-7
  - [ ] Perform system-only transition `OPEN|IN_PROGRESS → CLOSED` with `actor = 'system'` — FR-12d, SM-6
  - [ ] Enqueue `auto-close-notification` email job — FR-12e
  - [ ] No-op if conditions no longer hold — NFR-10
- [ ] In `comment.service.addComment()`:
  - [ ] Assignee comment on non-terminal ticket → `autoCloseQueue.add('auto-close', payload, { delay: 48h, jobId: 'auto-close:{ticketId}' })` — FR-12, FR-12b, FR-12f
  - [ ] Creator comment → remove pending `auto-close:{ticketId}` job — FR-12a, FR-12f
- [ ] Register both workers at app startup (`bin/www.ts`) — TS-8

---

## Phase 9 — Tests

- [ ] **State machine (TEST-1)**
  - [ ] Integration: all valid transitions succeed (`OPEN→IN_PROGRESS`, `IN_PROGRESS→RESOLVED`, `RESOLVED→CLOSED`, `OPEN→CANCELLED`, `IN_PROGRESS→CANCELLED`)
  - [ ] Integration: representative invalid transitions return `409` + `INVALID_STATUS_TRANSITION`
- [ ] **Ticket creation (TEST-2):** client-supplied `status`/`assignedTo` ignored; auto-assigned to admin with `OPEN`
- [ ] **RBAC scoping (TEST-3):** admin lists all tickets; agent list correctly scoped — FR-2a, SF-5
- [ ] **Assignment (TEST-4):** `403` for agent caller; `400` for non-existent target user — FR-7
- [ ] **Validation (TEST-5):** rejects missing/empty `title`, `description`, `message`; invalid enum values — VAL-2/VAL-3
- [ ] **Notifications (TEST-7)**
  - [ ] New-ticket job: sent to creator + admin; de-duplicated if same person — FR-10
  - [ ] Comment-notification job: excludes comment author; correct recipient set for all role combos — FR-11
  - [ ] Uses captured/JSON transport — no real mail sent — TS-7
- [ ] **Auto-close (TEST-8)**
  - [ ] (a) Assignee comment schedules delayed job with `jobId = auto-close:{ticketId}` — FR-12
  - [ ] (b) Creator reply within window cancels the job — FR-12a
  - [ ] (c) Deadline fires with no creator reply → `CLOSED` via system transition; notification enqueued — FR-12c/d/e
  - [ ] (d) Last-moment creator reply → execution-time re-validation → ticket unchanged — FR-12c
  - [ ] Uses injectable `AUTO_CLOSE_DELAY_MS=0` for test speed
- [ ] **Attachments (TEST-9)**
  - [ ] Allowed MIME + within size → `201`; `storageKey` absent from response — FR-13
  - [ ] Disallowed MIME → `415`; oversize → `400`; over file count → `400` — VAL-6
  - [ ] Download → `200` with correct `Content-Type` + `Content-Disposition: attachment` — FR-15
  - [ ] Caller without parent-ticket access → `403` on list/download — RBAC-3/4
  - [ ] Delete by non-uploader non-admin → `403`; by uploader → `204` — FR-16
  - [ ] Uses `STORAGE_BACKEND=local` + `.tmp/test-uploads`; cleaned up in `afterAll`

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
- [ ] New ticket emails creator + admin (async, non-blocking)
- [ ] New comment emails all involved parties, de-duplicated, excluding author
- [ ] Notification failures retried/logged; never fail the originating request
- [ ] Assignee comment with no creator reply within 48h auto-closes the ticket
- [ ] Creator reply within window prevents auto-close; re-validated at execution time
- [ ] Auto-close notifies involved parties
- [ ] Files uploadable to a ticket (and optionally a comment); metadata in Postgres, bytes in storage
- [ ] Upload rejects disallowed MIME, oversize, over-count
- [ ] Attachments listable (metadata) and downloadable (streamed), scoped to ticket access
- [ ] Attachment delete restricted to uploader or admin; no bytes cached in Redis
