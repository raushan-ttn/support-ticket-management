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
| TS-8  | **Redis-backed job queue (e.g. BullMQ).** Asynchronous email delivery (§5.4) and the delayed auto-close job (§5.5) run on a Redis-backed queue, reusing the Redis instance from TS-2. |
| TS-9  | **File storage backend.** Attachment binaries are stored in an object/file store — local filesystem for dev, S3-compatible object storage for prod — selected via env config. **Binaries are never stored in Postgres** (Postgres holds metadata only) and **never cached in Redis** (CACHE-9). Multipart upload handling is required. |

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
| screenshot  | string (URL) | NULLABLE — URL of a screenshot linked to the ticket |
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
- **DM-13:** `screenshot` on `tickets` and `comments` stores a plain URL string — it is not a storage key and is entirely separate from the `attachments` system (§3.4). Bytes are never stored; only the URL is persisted.

### 3.3 `Comment`
| Field      | Type | Constraints |
|------------|------|-------------|
| id         | UUID / serial | PK |
| ticketId   | FK → Ticket.id | NOT NULL |
| message    | text | NOT NULL, non-empty after trim |
| screenshot | string (URL) | NULLABLE — URL of a screenshot attached to this comment (see DM-13) |
| createdBy  | FK → User.id | NOT NULL |
| createdAt  | timestamptz | NOT NULL, set on insert |

- **DM-6:** Deleting a ticket (if ever supported) cascades to its comments. Deletion is out of scope for Core.
- **DM-7:** Index `ticketId` to support comment retrieval per ticket.

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

- **DM-8:** Postgres stores attachment **metadata only**; bytes live in the storage backend (TS-9).
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
| POST   | `/api/tickets` | Create ticket (auto-assigned to admin, `OPEN`) | Any role |
| GET    | `/api/tickets` | List/search/filter tickets | Any role (scope by RBAC-3/4) |
| GET    | `/api/tickets/:id` | Ticket detail | Any role (scoped) |
| PATCH  | `/api/tickets/:id` | Update title/description/priority/assignee | Per RBAC |
| PATCH  | `/api/tickets/:id/status` | Status transition (state machine) | Per RBAC |
| POST   | `/api/tickets/:id/assign` | Assign/reassign ticket | **Admin only** |
| GET    | `/api/tickets/:id/comments` | List comments for a ticket | Any role (scoped) |
| POST   | `/api/tickets/:id/comments` | Add a comment | Any role (scoped) |
| POST   | `/api/tickets/:id/attachments` | Upload attachment(s) to a ticket | Any role (scoped) |
| GET    | `/api/tickets/:id/attachments` | List attachment metadata for a ticket | Any role (scoped) |
| GET    | `/api/attachments/:attachmentId` | Download an attachment (streamed) | Any role (scoped to parent ticket) |
| DELETE | `/api/attachments/:attachmentId` | Delete an attachment | Uploader or admin |

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
| **FR-8** | **Add comment.** `POST /api/tickets/:id/comments` persists a comment with `ticketId`, `message`, `createdBy` (the caller), `createdAt`. `message` required and non-empty. |
| FR-8a | Adding a comment to a non-existent ticket → `404`. |
| **FR-9** | **List comments.** `GET /api/tickets/:id/comments` returns the ticket's comments ordered by `createdAt` ascending. |

### 5.4 Notification Requirements (Email)

All emails are sent **asynchronously** via the job queue (TS-8); they never block or
fail the originating API request (NFR-8). Recipient sets are **de-duplicated** — a user
who fills more than one role (e.g. creator who is also admin) receives a single email.

| ID    | Requirement |
|-------|-------------|
| **FR-10** | **New-ticket notification.** On successful ticket creation (FR-1), enqueue an email to the **ticket creator** and the **admin**. (At creation `assignedTo` is the admin per FR-1, so this set is effectively creator + assignee-admin.) The email identifies the ticket (id, title, priority). |
| **FR-11** | **Comment notification.** On a new comment (FR-8), enqueue an email to **everyone involved in the ticket — creator, current assignee, and admin** — **excluding the comment's author** (no self-notification). The email identifies the ticket and includes the comment message. |
| FR-11a | Recipient resolution reads the ticket's *current* `assignedTo` at the time the comment is posted, not a cached/stale value. |
| FR-11b | If the triggering ticket/comment carries attachments, the email notes their count and filenames (the files themselves are not emailed — recipients download via the API). |

### 5.5 Auto-Close on Stale Reply (Background Job)

> **Design conflict flagged:** This feature requires moving a ticket to `CLOSED` from a
> non-`RESOLVED` state, which the signature state machine (§7) does not permit. It is
> reconciled here as a **system-only transition** (SM-6). See §7 and Assumptions §12.

| ID    | Requirement |
|-------|-------------|
| **FR-12** | **Auto-close trigger.** When the **assignee** posts a comment on a non-terminal ticket (`OPEN` or `IN_PROGRESS`) and the **creator does not reply within 48 hours**, the system transitions the ticket to `CLOSED`. |
| FR-12a | A **creator** comment posted before the deadline **cancels** the pending auto-close. |
| FR-12b | A further **assignee** comment (with no intervening creator reply) **resets** the 48h window, measured from the latest such assignee comment. |
| FR-12c | **Execution-time re-validation.** When the deadline fires, the job re-reads the ticket from Postgres and only closes it if, *at that moment*: the ticket is still non-terminal, the most recent comment is from the assignee (no creator reply after it), and ≥48h have elapsed. Otherwise the job is a no-op. This prevents closing a ticket whose creator replied at the last moment (race safety). |
| FR-12d | Auto-close is performed via the privileged **system transition** (SM-6), recorded as a status change with actor = `system`. It is never reachable through the public status endpoint. |
| FR-12e | On auto-close, enqueue a notification to involved parties (creator, assignee, admin) that the ticket was auto-closed for inactivity. |
| FR-12f | **Implementation:** the deadline is a Redis-backed **delayed job** keyed by `ticketId`. Creator replies remove the pending job (FR-12a); new assignee comments replace it (FR-12b). |

### 5.6 File Attachment Requirements

Files are stored in the storage backend (TS-9); Postgres holds only metadata (§3.4).
Authorization on every attachment operation is exactly authorization on its **parent
ticket** (RBAC-3/4, DM-9).

| ID    | Requirement |
|-------|-------------|
| **FR-13** | **Upload.** `POST /api/tickets/:id/attachments` accepts one or more files via `multipart/form-data`, persists each to the storage backend, and records metadata (§3.4). Optionally accepts a `commentId` to attach to a specific comment of the same ticket (DM-10). |
| FR-13a | The uploader must have access to the parent ticket; otherwise `403`. Upload to a non-existent ticket → `404`. |
| FR-13b | **Validation (VAL-6):** reject files whose MIME type is outside the configured allowlist (`415`/`400`), exceed the configured per-file size limit, or exceed the per-request file count limit. Validate **before** persisting bytes. |
| FR-13c | Original filenames are **sanitized**; storage keys are server-generated (e.g. uuid-based) so a client cannot influence the storage path (no path traversal). |
| **FR-14** | **List.** `GET /api/tickets/:id/attachments` returns attachment **metadata** (id, filename, mimeType, sizeBytes, uploadedBy, createdAt, commentId), scoped to the ticket. It does not return bytes. |
| **FR-15** | **Download.** `GET /api/attachments/:attachmentId` **streams** the file from storage with correct `Content-Type` and `Content-Disposition`. Caller must have access to the parent ticket (else `403`); unknown id → `404`. Bytes are streamed, not buffered fully in memory (NFR-12). |
| **FR-16** | **Delete.** `DELETE /api/attachments/:attachmentId` removes the metadata row and the stored object. Allowed only for the **uploader or an admin** (else `403`). Deletion of metadata and storage object should be consistent — orphaned objects are cleaned up / tolerated, never an orphaned metadata row pointing at missing bytes presented as valid. |
| FR-17 | Attachments are **not** cached in Redis (CACHE-9); metadata listings may be cached and invalidated on upload/delete. |

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
| SM-6  | **System-only auto-close transition.** A privileged transition `{OPEN, IN_PROGRESS} -> CLOSED` exists **exclusively** for the auto-close job (FR-12). It is **not** reachable via `PATCH /api/tickets/:id/status`; user-initiated requests remain bound by SM-1. The transition is recorded with actor = `system`. |
| SM-7  | Auto-close never applies to terminal tickets (`CLOSED`, `CANCELLED`) and does not fire on `RESOLVED` tickets (those follow the normal `RESOLVED -> CLOSED` path). |

> **State-machine extension notice:** SM-6 is a deliberate extension of the signature
> state machine to support FR-12 and should be confirmed with the spec owner. The
> alternatives considered were (a) auto-`RESOLVED` then auto-`CLOSED` through the legal
> path, and (b) a distinct `AUTO_CLOSED` terminal status. A gated system-only direct
> close was chosen to keep user-facing rules strict while keeping the enum fixed.

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
| VAL-6 | **Attachment validation:** MIME type must be in the configured allowlist; per-file size and per-request file-count limits enforced; filenames sanitized; storage keys server-generated (FR-13b/c). Limits are env-configured (see Assumptions). |

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
| NFR-8 | **Async notifications:** email sending is queued (TS-8), never on the request path. A failed send is retried with backoff and logged; it never fails or delays the originating API call. |
| NFR-9 | **Delayed jobs:** the 48h auto-close is a Redis-backed delayed job keyed by ticket; creator replies cancel it, new assignee comments replace it (FR-12a/b/f). |
| NFR-10 | **Job idempotency & safety:** background jobs (email, auto-close) are idempotent. Retried or duplicate triggers must not send duplicate emails or double-close a ticket; auto-close re-validates state at execution (FR-12c) and is a no-op if conditions no longer hold. |
| NFR-11 | **Queue degradation:** if Redis/the queue is unavailable, core ticket and comment APIs continue to function. Notifications and pending auto-close scheduling are degraded and logged (consistent with CACHE-7); this is an accepted limitation while Redis is down. |
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
| TEST-7 | **Notifications:** with a captured/fake transport, assert new-ticket and comment events enqueue emails to the correct, **de-duplicated** recipient set, and that the comment author is **excluded** (FR-10/FR-11). No real mail is sent. |
| TEST-8 | **Auto-close:** (a) an assignee comment schedules the close; (b) a creator reply within 48h cancels it; (c) at the deadline with no creator reply the ticket transitions to `CLOSED` via the system transition and the auto-close notification is enqueued; (d) execution-time re-validation (FR-12c) makes a last-moment creator reply prevent the close. The 48h clock is controllable (injectable deadline / fake timer). |
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
- **Auto-close window** resets on each new assignee comment lacking a creator reply, and
  a creator reply cancels it. "Creator reply" is taken as any creator comment posted
  after the triggering assignee comment — confirm if a stricter definition is intended.
- **Auto-close extends the signature state machine** with a system-only `-> CLOSED`
  transition (SM-6); confirm this is acceptable versus auto-`RESOLVED`→`CLOSED` or an
  `AUTO_CLOSED` status.
- **Attachment storage backend** is config-driven: local filesystem for dev, S3-compatible
  for prod. Confirm the prod target (e.g. AWS S3, MinIO).
- **Attachment limits** (allowed MIME types, max file size, max files per request) are
  env-configured. Suggested defaults to confirm: images + PDF + common office docs,
  10 MB/file, 5 files/request.
- **Attachments attach at ticket level and optionally at comment level**; both share one
  `Attachment` table scoped by `ticketId`. Confirm if comment-level attachments are needed.
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
- [ ] New ticket triggers an email to the creator and admin (async, non-blocking).
- [ ] New comment triggers an email to all involved parties (creator, assignee, admin), de-duplicated and excluding the comment author.
- [ ] Notification failures are retried/logged and never fail the originating API call.
- [ ] An assignee comment with no creator reply within 48h auto-closes the ticket via the system transition; a creator reply within the window prevents it.
- [ ] Auto-close re-validates ticket state at execution time and notifies involved parties.
- [ ] Files can be uploaded to a ticket (and optionally a comment); metadata in Postgres, bytes in the storage backend.
- [ ] Upload rejects disallowed MIME types, oversize files, and over-count requests.
- [ ] Attachments can be listed (metadata) and downloaded (streamed), scoped to parent-ticket access.
- [ ] Attachment delete is restricted to the uploader or an admin; no secrets or binaries cached in Redis.
