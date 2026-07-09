# Requirements — Support Ticket Management System (Backend API)

> **Scope:** This document specifies **backend / API requirements only**. Frontend,
> UI states, and client rendering are explicitly out of scope. The frontend is
> treated purely as a consumer of the contracts defined here.

---

## 1. Overview

A backend service for managing internal support tickets. It exposes a REST API to
create tickets, list and search them, view details, update fields, progress tickets
through an enforced status state machine, and comment on them. An **admin** triages
incoming tickets and assigns them to the agent responsible for the work.

### 1.1 Goals
- Provide a correct, validated, persistent API for ticket and comment management.
- Enforce ticket lifecycle rules server-side (the authoritative state machine).
- Support admin-driven triage: visibility over all tickets/comments and assignment.
- Auto-route every new ticket to the admin queue in an `OPEN` state.

### 1.2 Out of Scope
- Frontend application, components, and UI error rendering.
- User self-registration / user-management UI (users are **seeded only**).
- SLA timers, audit exports.
- **Auto-close-on-stale-reply background job** (formerly FR-12/§5.5). **Removed
  2026-07-08.** Required a Redis-backed delayed-job queue (BullMQ), which is not part
  of this implementation. Partial groundwork (`systemCloseTicket()` in
  `ticket.service.ts`, the SM-6 system transition, and the `autoCloseQueue`
  schedule/cancel calls in `comment.service.ts`) predates this decision and is now
  **dead code** — see `task.md` Phase 8 for the cleanup item.

> **In scope:** Email/notification delivery (§5.4) and file attachments (§3.4, §5.6).

---

## 2. Technology Requirements

| ID    | Requirement |
|-------|-------------|
| TS-1  | **Database: PostgreSQL.** All persistent state lives in Postgres. Data must survive process restart. |
| TS-2  | **Cache: Redis.** Redis is used as a read-through / cache-aside layer (see §9). It is a performance layer, never the system of record. |
| TS-3  | A schema migration / initialization script must create all tables, constraints, and enums. No manual schema steps. |
| TS-4  | A seed script must insert the baseline users (including at least one `admin`) and optional sample tickets/comments. |
| TS-5  | All connection strings and secrets are supplied via environment variables; an `.env.example` documents every required variable. No secrets committed. |
| TS-6  | The service must start successfully and serve health checks even if Redis is unavailable (graceful cache degradation — see CACHE-7). It must **not** start if Postgres is unreachable. |
| TS-7  | **Email transport (SMTP).** Outbound notifications are sent via a configurable SMTP transport (env-driven). Dev/test may use a capture transport (e.g. Mailhog, or an in-memory/console transport) — no real mail in tests. |
| TS-8  | *(Removed 2026-07-08 — see §1.2 Out of Scope.)* Previously: Redis-backed job queue (BullMQ) for async email delivery and the delayed auto-close job. Email (§5.4) is now sent via a direct, non-queued call. No BullMQ queue is part of this implementation. |
| TS-9  | **File storage backend.** Attachment binaries are stored in an object/file store — local filesystem (`STORAGE_LOCAL_DIR`, default `public/`, served as static files via `express.static`) for dev, S3-compatible object storage for prod — selected via `STORAGE_BACKEND` env config. The storage backend returns a public-accessible, **absolute** URL (`url`) for each saved file — `{APP_URL}/{storageKey}` for local (`APP_URL` env, default `http://localhost:{PORT}`), the S3 object URL for prod — so the URL can be opened directly in a browser without a separate download endpoint. *(Corrected 2026-07-09: earlier text described a relative `/uploads/…` path; the actual, and now required, behavior is an absolute URL — see bug fix in `.claude/plans/attachments-module.md`.)* **Binaries are never stored in Postgres** (Postgres holds metadata only) and **never cached in Redis** (CACHE-9). Multipart upload handling is required. |

---

## 3. Data Model (Persistence Layer)

Stored enum values are uppercase snake-case. All timestamps are stored in UTC.

### 3.1 `User` (seeded only)
| Field | Type | Constraints |
|-------|------|-------------|
| id    | UUID / serial | PK |
| name  | string | NOT NULL |
| email | string | NOT NULL, UNIQUE, valid email format |
| role  | enum(`ADMIN`, `AGENT`) | NOT NULL |

- **DM-1:** No user-management API endpoints are required. Users exist only via seed data.
- **DM-2:** At least one user with role `ADMIN` must exist after seeding.

### 3.2 `Ticket`
| Field       | Type | Constraints |
|-------------|------|-------------|
| id          | UUID / serial | PK |
| title       | string | NOT NULL, non-empty after trim |
| description | text | NOT NULL, non-empty after trim |
| type        | string (max 100) | NULLABLE — ticket classification (e.g. `BUG`, `FEATURE_REQUEST`, `SUPPORT`, `INCIDENT`) |
| subType     | string (max 100) | NULLABLE — sub-classification (e.g. `UI`, `API`, `AUTHENTICATION`, `EMAIL`) |
| ~~screenshot~~ | ~~string (URL)~~ | *(Removed 2026-07-09 — see DM-13)* |
| priority    | enum(`LOW`, `MEDIUM`, `HIGH`, `URGENT`) | NOT NULL, default `MEDIUM` |
| status      | enum(`OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`, `CANCELLED`) | NOT NULL, default `OPEN` |
| assignedTo  | FK → User.id | **NOT NULL** (always set on creation — see FR-1) |
| createdBy   | FK → User.id | NOT NULL |
| createdAt   | timestamptz | NOT NULL, set on insert |
| updatedAt   | timestamptz | NOT NULL, updated on every mutation |

- **DM-3:** `assignedTo` is non-nullable as a direct consequence of auto-assignment (FR-1); a ticket is never in an "unassigned" state.
- **DM-4:** `assignedTo` and `createdBy` must reference existing users (FK enforced).
- **DM-5:** Index `status` and `assignedTo` to support filtering (§6) without full scans.
- **DM-12:** `type` and `subType` are nullable free-text fields (`VARCHAR(100)`); valid values are application-governed (no DB ENUM) so new categories can be added without schema changes. Index both for filter support.
- **DM-13:** *(Removed 2026-07-09.)* Previously specified a `screenshot` plain-URL string column on `tickets` and `comments`, separate from the `attachments` system (§3.4). Dropped in favor of the `attachments` system exclusively — see `.claude/plans/tickets-module.md` / `comments-module.md` for the migration note and `src/db/schema.sql` Migration 2026-07-09.

### 3.3 `Comment`
| Field      | Type | Constraints |
|------------|------|-------------|
| id         | UUID / serial | PK |
| ticketId   | FK → Ticket.id | NOT NULL |
| message    | text | NOT NULL, non-empty after trim |
| ~~screenshot~~ | ~~string (storage path / URL)~~ | *(Removed 2026-07-09 — see DM-13a)* |
| createdBy  | FK → User.id | NOT NULL |
| createdAt  | timestamptz | NOT NULL, set on insert |

- **DM-6:** Deleting a ticket (if ever supported) cascades to its comments. Deletion is out of scope for Core.
- **DM-7:** Index `ticketId` to support comment retrieval per ticket.
- **DM-13a:** *(Removed 2026-07-09.)* Previously specified `screenshot` on **comments** as a single-file-upload column (jpg/png only), distinct from `tickets.screenshot` (DM-13). Comment-level screenshots are now uploaded through the same `attachments` system as ticket-level files (§3.4, FR-8/FR-9) — `addComment` accepts a `files` array via the shared `uploadAttachmentFiles` middleware, same as tickets.

### 3.4 `Attachment`
| Field      | Type | Constraints |
|------------|------|-------------|
| id         | UUID / serial | PK |
| ticketId   | FK → Ticket.id | NOT NULL (authorization scope — every attachment belongs to a ticket) |
| commentId  | FK → Comment.id | NULLABLE (set when the file is attached to a specific comment; null = ticket-level attachment) |
| filename   | string | NOT NULL (original client filename, sanitized) |
| storageKey | string | NOT NULL (path/key in the storage backend; **not** a public URL) |
| mimeType   | string | NOT NULL |
| sizeBytes  | integer | NOT NULL |
| uploadedBy | FK → User.id | NOT NULL |
| createdAt  | timestamptz | NOT NULL, set on insert |

- **DM-8:** Postgres stores attachment **metadata only**; bytes live in the storage backend (TS-9). Responses include a derived `url` field (static path for local dev, S3 object URL for prod) — `storageKey` is internal and never returned to clients.
- **DM-9:** `ticketId` drives authorization — access to an attachment is exactly access to its parent ticket (RBAC-3/4).
- **DM-10:** `commentId`, when set, must belong to the same `ticketId` (cross-ticket references rejected).
- **DM-11:** Index `ticketId` (and `commentId`) to support listing attachments per ticket/comment.

---

## 4. Roles & Authorization

The admin-specific behavior requested makes the caller's **role** a first-class
requirement; the API must be able to establish who is calling and with what role.

| ID    | Requirement |
|-------|-------------|
| RBAC-1 | Two roles are recognized: `ADMIN` and `AGENT`. |
| RBAC-2 | The caller's identity and role must be resolvable on every request. Recommended: JWT/session auth. Minimal-core fallback: a trusted actor identifier (e.g. `x-actor-id` header resolving to a seeded user). Either way, role is server-determined, never client-asserted as a privilege. |
| RBAC-3 | **Admin** can: list/view **all** tickets and comments regardless of assignment (FR-2a), and assign/reassign any ticket (FR-7). |
| RBAC-4 | **Agent** can: view tickets assigned to them or created by them, comment on accessible tickets, update fields, and progress status on tickets they are assigned. |
| RBAC-5 | Endpoints that mutate assignment are **admin-only**; a non-admin caller receives `403 Forbidden`. |
| RBAC-6 | Authorization is enforced at the API/service layer, not inferred from request payloads. |

> Note: The base brief treats authentication as optional. Because the requested admin
> visibility/assignment behavior depends on role, RBAC is required here at minimum as
> role resolution + admin-gating. Full auth (login/logout, token refresh) remains
> optional stretch.

---

## 5. Functional Requirements — Endpoints

### 5.1 Endpoint Summary
| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST   | `/api/tickets` | Create ticket (auto-assigned to admin, `OPEN`); accepts optional PNG/JPG files | Any role |
| GET    | `/api/tickets` | List/search/filter tickets | Any role (scope by RBAC-3/4) |
| GET    | `/api/tickets/:id` | Ticket detail including inline `attachments` array | Any role (scoped) |
| PATCH  | `/api/tickets/:id` | Update title/description/priority/assignee; accepts optional PNG/JPG files | Per RBAC |
| PATCH  | `/api/tickets/:id/status` | Status transition (state machine) | Per RBAC |
| POST   | `/api/tickets/:id/assign` | Assign/reassign ticket | **Admin only** |
| GET    | `/api/tickets/:id/comments` | List comments for a ticket; each comment includes inline `attachments` array | Any role (scoped) |
| POST   | `/api/tickets/:id/comments` | Add a comment; accepts optional PNG/JPG files | Any role (scoped) |
| GET    | `/api/tickets/:id/comments/:commentId` | Single comment with inline `attachments` array | Any role (scoped) |

> There are **no standalone attachment endpoints**. File upload is part of ticket/comment mutation endpoints; attachment metadata (with direct-access `url`) is embedded in ticket/comment responses.
>
> Update of assignee may be supported either via `PATCH /api/tickets/:id` (assignee
> field) or the dedicated `POST /api/tickets/:id/assign`. If both exist, both go
> through the same admin-only assignment service path.

### 5.2 Ticket Lifecycle Requirements

| ID    | Requirement |
|-------|-------------|
| **FR-1** | **Create ticket.** On `POST /api/tickets`, the system persists the ticket and **automatically sets `status = OPEN` and `assignedTo = the designated admin`**, regardless of any client-supplied status/assignee. `createdBy` is the calling user. The resolved admin is the configured default admin (env/config) or, if unset, the seeded `ADMIN` user. |
| FR-1a | Client-supplied `status` or `assignedTo` on create are **ignored** (server-authoritative), not errors. |
| FR-1b | Required create fields: `title`, `description`. `priority` optional (defaults `MEDIUM`). |
| **FR-2** | **List tickets.** `GET /api/tickets` returns tickets the caller is entitled to see. |
| FR-2a | **Admin sees all tickets** (and, via FR-6, all comments). Agents see only tickets assigned to or created by them. |
| **FR-3** | **View ticket detail.** `GET /api/tickets/:id` returns the full ticket; `404` if not found, `403` if outside the caller's scope. |
| **FR-4** | **Update fields.** `PATCH /api/tickets/:id` updates any of `title`, `description`, `priority`, `assignee`. Status is **not** mutable here (FR-5 owns it). |
| FR-4a | Reassignment via the assignee field is admin-gated (RBAC-5). |
| **FR-5** | **Status transition.** `PATCH /api/tickets/:id/status` changes status **only** through valid transitions (§7). Invalid transitions are rejected with `409 Conflict`. |
| **FR-6** | **Admin comment visibility.** Admin can read comments on **any** ticket. Agents read comments only on tickets within their scope. |
| **FR-7** | **Assignment.** `POST /api/tickets/:id/assign` (admin only) sets `assignedTo` to a valid target user. Assigning to a non-existent user → `400`. Non-admin caller → `403`. |
| FR-7a | Assignment does not by itself change status; status changes remain governed by §7. |

### 5.3 Comment Requirements
| ID    | Requirement |
|-------|-------------|
| **FR-8** | **Add comment.** `POST /api/tickets/:id/comments` accepts `multipart/form-data` with `message` (required, non-empty text) and an optional `files` array (see §5.6 File Attachment Requirements — same allowlist, limits, and `attachments` system used by tickets). Persists the comment with `ticketId`, `message`, `createdBy` (the caller), `createdAt`. *(2026-07-09: the single `screenshot` file field was removed — see DM-13a — in favor of the shared `files`/`attachments` mechanism.)* |
| FR-8a | Adding a comment to a non-existent ticket → `404`. |
| FR-8b | *(Removed 2026-07-09 — see DM-13a.)* Previously specified dedicated screenshot MIME/size validation; comment file uploads now validate through the same `uploadAttachmentFiles` middleware/allowlist as ticket attachments. |
| **FR-9** | **List comments.** `GET /api/tickets/:id/comments` returns the ticket's comments ordered by `createdAt` ascending. Each comment object includes an `attachments` array (§3.4). |
| FR-9a | **Get comment by ID.** `GET /api/tickets/:id/comments/:commentId` returns a single comment including its `attachments` array. Returns `404` if the comment does not exist or does not belong to the ticket. |

### 5.4 Notification Requirements (Email)

> **Implementation note:** email notifications are sent via a **direct, non-queued
> call** from the service layer — no job queue. The call is fire-and-forget
> (`try/catch`, never awaited into the response path in a way that can fail the
> request) so the intent of NFR-8 (never block/fail the request) is preserved, but
> there is **no retry-with-backoff**: a failed send is logged once and dropped.

All emails are sent **asynchronously** (fire-and-forget, off the request path); they
never block or fail the originating API request (NFR-8). Recipient sets are
**de-duplicated** — a user who fills more than one role (e.g. creator who is also admin)
receives a single email.

| ID    | Requirement |
|-------|-------------|
| **FR-10** | **New-ticket notification.** On successful ticket creation (FR-1), send an email to the **ticket creator** and the **admin**. (At creation `assignedTo` is the admin per FR-1, so this set is effectively creator + assignee-admin.) The email identifies the ticket (id, title, priority). |
| **FR-11** | **Comment notification.** On a new comment (FR-8), send an email to **everyone involved in the ticket — creator, current assignee, and admin** — **excluding the comment's author** (no self-notification). The email identifies the ticket and includes the comment message. |
| FR-11a | Recipient resolution reads the ticket's *current* `assignedTo` at the time the comment is posted, not a cached/stale value. |
| FR-11b | If the triggering ticket/comment carries attachments, the email notes their count and filenames (the files themselves are not emailed — recipients download via the API). |

### 5.5 Auto-Close on Stale Reply — Removed From Scope

*(Removed 2026-07-08 — see §1.2 Out of Scope.)* This section previously specified
`FR-12`/`FR-12a`–`FR-12f`: auto-closing a ticket to `CLOSED` 48h after an assignee
comment with no creator reply, via a BullMQ delayed job and a system-only state
transition (`SM-6`, §7). It required a Redis-backed delayed-job queue, which is not
part of this implementation, and is dropped from scope rather than deferred.
`ticket.service.ts`'s `systemCloseTicket()` and the `autoCloseQueue` scheduling calls
in `comment.service.ts` predate this decision and are now dead code pending cleanup
(`task.md` Phase 8).

### 5.6 File Attachment Requirements

Files are stored in the storage backend (TS-9); Postgres holds only metadata (§3.4).
Authorization on every attachment operation is exactly authorization on its **parent
ticket** (RBAC-3/4, DM-9). There are **no standalone attachment endpoints** — upload is
integrated into ticket/comment mutation endpoints and metadata is embedded in their responses.

| ID    | Requirement |
|-------|-------------|
| **FR-13** | **Upload.** One or more files (up to the configured per-request limit) are accepted as optional `multipart/form-data` on: `POST /api/tickets` (ticket-level attachments), `PATCH /api/tickets/:id` (additional ticket-level attachments), and `POST /api/tickets/:id/comments` (comment-level attachments linked to the new comment via `commentId`). A ticket or comment may accumulate multiple attachments across calls. Each file is persisted to the storage backend and a metadata row is recorded (§3.4). |
| FR-13a | The uploader must have access to the parent ticket; otherwise `403`. Upload to a non-existent ticket → `404`. |
| FR-13b | **Validation (VAL-6):** only `image/jpeg` and `image/png` MIME types are accepted — all other types are rejected with `415`. Files exceeding the configured per-file size limit or per-request file count limit are rejected with `400`. Validate **before** persisting bytes. |
| FR-13c | Original filenames are **sanitized** (`sanitize-filename`); storage keys are server-generated (UUID-based) so a client cannot influence the storage path. The storage backend returns a public-accessible, absolute `url` for each saved file — `{APP_URL}/{storageKey}` for local dev, an S3 object URL for prod — so it opens directly in a browser (see TS-9). |
| **FR-14** | **Access via responses.** A ticket or comment may have **multiple attachments**. Attachment metadata — `{ id, filename, mimeType, sizeBytes, uploadedBy, createdAt, commentId, url }` — is returned as an array (`attachments: AttachmentRow[]`) inline in: `GET /api/tickets` (list — every ticket's attachments), `GET /api/tickets/:id` (all attachments for the ticket), `GET /api/tickets/:id/comments` (per-comment `attachments` array), and `GET /api/tickets/:id/comments/:commentId`. The `url` provides direct file access; `storageKey` is never exposed. *(Fixed 2026-07-09: `GET /api/tickets` previously hardcoded `attachments: []` instead of fetching them — see `.claude/plans/tickets-module.md`.)* |
| FR-15 | **No separate download endpoint.** Files are accessed directly via the `url` field in responses. Local dev serves files from `STORAGE_LOCAL_DIR` (default `public/`) as static assets via `express.static`, with `url` built as `{APP_URL}/{storageKey}`; S3 prod serves files via S3 object URL. |
| FR-16 | **Metadata cache.** Attachment metadata for a ticket is cached as `ticket:{id}:attachments` and invalidated on every new upload (CACHE-9). Attachment bytes are never cached in Redis. |

---

## 6. Search & Filter

| ID    | Requirement |
|-------|-------------|
| **SF-1** | **Keyword search (Core).** `GET /api/tickets?search=<term>` matches against `title` and `description` (case-insensitive). |
| **SF-2** | **Status filter (Core).** `GET /api/tickets?status=<STATUS>` filters by exact status; invalid enum → `400`. |
| SF-3  | Search and status filter are combinable. |
| SF-4  | (Stretch) Filter by `priority` and `assignedTo`; sorting by `createdAt`/`priority`; pagination via `page`/`limit`. |
| SF-5  | All list scoping (RBAC-3/4) is applied **before** search/filter, so agents can never page into tickets outside their scope. |

---

## 7. Status State Machine (Server-Authoritative)

The backend is the single source of truth for legal transitions. The frontend may
mirror these for UX, but the API must independently reject illegal ones.

```
OPEN         -> IN_PROGRESS
IN_PROGRESS  -> RESOLVED
RESOLVED     -> CLOSED
OPEN         -> CANCELLED
IN_PROGRESS  -> CANCELLED
```

| ID    | Requirement |
|-------|-------------|
| SM-1  | Only the transitions listed above are valid. Every other transition (including same-state no-ops and any transition out of `RESOLVED`/`CLOSED`/`CANCELLED` not listed) is rejected. |
| SM-2  | Rejected transitions return `409 Conflict` with a machine-readable error code (`INVALID_STATUS_TRANSITION`) and the attempted `from`/`to` in the payload. |
| SM-3  | `CLOSED` and `CANCELLED` are terminal: no outgoing transitions. |
| SM-4  | Transition validity is evaluated against the **current persisted status** (read inside the same transaction), not a client-provided current status, to avoid stale/lost-update races. |
| SM-5  | The status update and the read of current status occur within a single DB transaction to guarantee correctness under concurrent requests. |
| SM-6  | *(Removed 2026-07-08 — see §1.2 Out of Scope.)* Previously a system-only `{OPEN, IN_PROGRESS} -> CLOSED` transition exclusively for the now-removed auto-close job. `systemCloseTicket()` in `ticket.service.ts` still implements this and is dead code pending cleanup (`task.md` Phase 8). |
| SM-7  | *(Removed 2026-07-08 along with SM-6/FR-12 — see §1.2 Out of Scope.)* |

---

## 8. Validation & Error Handling

### 8.1 Input Validation
| ID    | Requirement |
|-------|-------------|
| VAL-1 | All request bodies/params are validated **server-side** before any DB work. Client validation is never trusted. |
| VAL-2 | Required fields enforced: ticket `title`, `description`; comment `message`. Empty/whitespace-only values are rejected. |
| VAL-3 | `priority` and `status` inputs must be members of their enums. |
| VAL-4 | Referenced users (`assignedTo`) and tickets (`:id`, `ticketId`) must exist; otherwise `400` (bad reference) or `404` (missing resource) as appropriate. |
| VAL-5 | Unknown/unexpected body fields are ignored or rejected consistently (decide one policy and apply uniformly). |
| VAL-6 | **Attachment validation:** MIME type must be `image/jpeg` or `image/png` — all other types rejected with `415`; per-file size and per-request file-count limits enforced (400 on breach); filenames sanitized; storage keys server-generated (FR-13b/c). Size/count limits are env-configured (see Assumptions). |

### 8.2 Error Taxonomy
| ID    | Requirement |
|-------|-------------|
| ERR-1 | A single consistent error response shape is used everywhere: `{ error: { code, message, details? } }`. |
| ERR-2 | HTTP status mapping: `400` validation/bad input, `403` authorization, `404` not found, `409` state-machine/conflict, `422` (optional) semantic validation, `500` unexpected. |
| ERR-3 | Error `code` values are stable, documented strings (e.g. `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `INVALID_STATUS_TRANSITION`, `USER_NOT_FOUND`). |
| ERR-4 | No internal details (stack traces, SQL, secrets) leak in responses. Full detail goes to server logs only. |
| ERR-5 | A centralized error handler converts thrown domain/validation errors into the standard shape; controllers do not hand-format errors ad hoc. |

---

## 9. Caching (Redis)

Cache-aside pattern. Redis accelerates reads; Postgres remains authoritative.

| ID    | Requirement |
|-------|-------------|
| CACHE-1 | Cache ticket detail (`GET /api/tickets/:id`) keyed as `ticket:{id}`. Read path checks Redis first, falls back to Postgres on miss, then populates the cache. |
| CACHE-2 | Cache per-ticket comment lists keyed as `ticket:{id}:comments`. |
| CACHE-3 | Cache the seeded user lookup (read-heavy, rarely changes) keyed as `user:{id}`. |
| CACHE-4 | All keys use a consistent namespace/prefix and carry a default TTL (e.g. 300s) as a safety net against stale data. |
| CACHE-5 | **Invalidate on write.** Any ticket mutation (create, field update, status change, assign) invalidates `ticket:{id}` and any affected list caches. Adding a comment invalidates `ticket:{id}:comments`. |
| CACHE-6 | List/search results (`GET /api/tickets` with filters) may be cached only with a key that encodes the caller's scope + filter params, and must be invalidated or short-TTL'd to avoid serving stale or cross-scope data. If correctness cannot be guaranteed cheaply, list endpoints may bypass the cache. |
| CACHE-7 | **Graceful degradation.** If Redis is unreachable, the API serves directly from Postgres without erroring. Cache failures are logged, not propagated to the client. |
| CACHE-8 | Cache writes never block correctness: a failed cache set must not fail the underlying DB operation. |
| CACHE-9 | **Attachment binaries are never cached in Redis.** They are served from the storage backend (TS-9). Attachment *metadata* listings may be cached (`ticket:{id}:attachments`) and invalidated on upload/delete. |

---

## 10. Non-Functional Requirements

| ID    | Requirement |
|-------|-------------|
| NFR-1 | **Persistence:** all data survives application restart (Postgres). |
| NFR-2 | **Transaction safety:** multi-step operations (status transition read-then-write, assignment validation) run in transactions to prevent partial writes and lost updates. |
| NFR-3 | **Concurrency:** state-machine evaluation tolerates concurrent requests on the same ticket without violating §7 (SM-4/SM-5). |
| NFR-4 | **No blocking calls** on the request path; all DB/Redis access is async/non-blocking. |
| NFR-5 | **Config via env:** DB URL, Redis URL, default-admin reference, TTLs, port — all environment-driven with `.env.example`. |
| NFR-6 | **Logging:** structured server-side logs for errors and key mutations; no secrets in logs. |
| NFR-7 | **Idempotency (optional/stretch):** ticket creation may accept an idempotency key to avoid duplicates on retry. |
| NFR-8 | **Async notifications:** email sending is off the request path (fire-and-forget, direct call, no queue — §5.4). A failed send is logged but **not** retried with backoff; it never fails or delays the originating API call. |
| NFR-9 | *(Removed 2026-07-08 — see §1.2 Out of Scope.)* Previously specified the 48h auto-close as a Redis-backed delayed job. |
| NFR-10 | *(Removed 2026-07-08 — see §1.2 Out of Scope.)* Previously specified job idempotency/safety for email + auto-close background jobs. |
| NFR-11 | **Degradation:** if SMTP is unavailable, the direct email send fails, is logged, and is dropped — core ticket and comment APIs continue to function. |
| NFR-12 | **Streaming I/O for attachments:** uploads and downloads stream to/from the storage backend; large files are not fully buffered in memory. Size limits (VAL-6) are enforced during upload, not after fully reading the file. |
| NFR-13 | **Storage abstraction:** the storage backend is accessed behind an interface so local-FS (dev) and S3-compatible (prod) are swappable via config without touching call sites. |

---

## 11. Testing Requirements (Backend)

| ID    | Requirement |
|-------|-------------|
| **TEST-1** | **Mandatory:** integration tests proving the state machine — every valid transition succeeds and a representative set of invalid transitions is rejected with `409`/`INVALID_STATUS_TRANSITION`. |
| TEST-2 | Integration test: ticket creation auto-assigns to admin with `OPEN` status, ignoring client-supplied status/assignee (FR-1/FR-1a). |
| TEST-3 | Integration test: admin lists all tickets while an agent's listing is correctly scoped (FR-2a, SF-5). |
| TEST-4 | Integration test: assignment endpoint is admin-only (`403` for agent) and rejects non-existent target users (FR-7). |
| TEST-5 | Integration test: backend validation rejects invalid/missing required fields (VAL-2/VAL-3). |
| TEST-6 | (Stretch) Unit tests for the pure state-machine transition function and validation rules; cache invalidation tests; failure/edge-case tests. |
| TEST-7 | **Notifications:** with a captured/fake transport, assert new-ticket and comment events directly call the mailer with the correct, **de-duplicated** recipient set, and that the comment author is **excluded** (FR-10/FR-11). No real mail is sent. |
| TEST-8 | *(Removed 2026-07-08 — see §1.2 Out of Scope.)* Previously specified auto-close job tests. |
| TEST-9 | **Attachments:** upload accepts allowed types within limits and rejects disallowed type / oversize / over-count (VAL-6); download streams the correct bytes and `Content-Type`; a user without parent-ticket access gets `403` on list/download; delete is restricted to uploader/admin (FR-13–FR-16). Uses a local-FS storage backend in tests. |

---

## 12. Assumptions

- Users are seeded; no registration flow exists. At least one `ADMIN` is seeded.
- "Designated admin" for auto-assignment is resolved from config; absent config, the
  first seeded `ADMIN` is used. (Confirm if a specific admin or round-robin is wanted.)
- Roles are limited to `ADMIN` and `AGENT`; "respective person to work on the ticket"
  maps to an `AGENT`.
- Priority enum is `LOW | MEDIUM | HIGH | URGENT` (adjust if a different set is desired).
- Authentication depth (full JWT vs. minimal actor-resolution) is an implementation
  choice; role resolution (RBAC-2) is the hard requirement.
- **Email transport** is deployment config (SMTP); dev/test uses a capture transport.
  Email content is minimal (plain text or simple HTML); rich templating is out of scope.
- **Comment notifications exclude the comment author** by default (no self-notify);
  confirm if a self-copy is wanted.
- **"Admin" recipient** = the designated admin (same resolution as FR-1). If multiple
  admins exist, confirm whether all admins or only the designated one are notified.
- **Attachment storage backend** is config-driven: local filesystem (`STORAGE_LOCAL_DIR`, default `public/`, static-served, absolute URLs via `APP_URL`) for dev, S3-compatible for prod. Confirm the prod target (e.g. AWS S3, MinIO).
- **Attachment MIME allowlist** is fixed to `image/jpeg` and `image/png` — no PDFs or office documents.
- **Attachment limits** (max file size, max files per request) are env-configured. Suggested defaults: 5 MB/file, 5 files/request.
- **Attachments attach at ticket level and optionally at comment level**; both share one `Attachment` table scoped by `ticketId`. No standalone attachment upload/download/delete endpoints.
- **Virus/malware scanning** of uploads is out of scope (candidate for stretch).

---

## 13. Core Acceptance Criteria (Backend Slice)

- [ ] Ticket can be created via API; persisted; auto-assigned to admin with `OPEN`.
- [ ] All tickets are retrievable from the DB; admin sees all, agents scoped.
- [ ] Ticket detail retrievable by id.
- [ ] Ticket fields (title, description, priority, assignee) are updatable; assignee changes are admin-gated.
- [ ] Comments can be added and listed; admin can read comments on any ticket.
- [ ] Status changes only through valid transitions; invalid ones rejected (`409`).
- [ ] Keyword search and status filter work and respect scope.
- [ ] Data remains available after restart (Postgres).
- [ ] Backend validation prevents invalid records.
- [ ] Redis cache accelerates reads and degrades gracefully when unavailable.
- [ ] No secrets committed.
- [ ] State-machine integration tests pass.
- [ ] New ticket triggers an email to the creator and admin (async, non-blocking, direct call — no queue).
- [ ] New comment triggers an email to all involved parties (creator, assignee, admin), de-duplicated and excluding the comment author.
- [ ] Notification failures are logged and never fail the originating API call (no retry — direct call, not queued).
- [ ] PNG/JPG files can be uploaded to a ticket or comment via ticket/comment mutation endpoints; metadata in Postgres, bytes in storage backend.
- [ ] Upload rejects non-PNG/JPG MIME types (`415`), oversize files, and over-count requests (`400`).
- [ ] Attachment metadata (including direct-access `url`) is returned inline in ticket detail and comment list/detail responses.
- [ ] No standalone attachment endpoints exist; no attachment bytes cached in Redis.
