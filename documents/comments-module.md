# Comments Module

> **Status:** Implemented
> **Branch:** master
> **Date:** 2026-07-01
> **Requirements:** FR-8, FR-8a, FR-8b, FR-9, FR-9a, FR-11, FR-11a, FR-11b, RBAC-3, RBAC-4, RBAC-6, CACHE-2, CACHE-5, CACHE-7, CACHE-8, DM-6, DM-7, DM-13a, TS-7, TS-9, VAL-2, NFR-8, NFR-11, TEST-7
>
> **Update (2026-07-08):** Auto-close (formerly `FR-12*`, `SM-6`, `SM-7`, `TS-8`,
> `NFR-9`, `NFR-10`, `TEST-8`) was **removed from scope** — it required a
> Redis-backed BullMQ delayed-job queue that is not part of this implementation
> (`requirements.md` §1.2). This document originally described that feature as
> implemented; the sections below are updated to flag the corresponding code (the
> `autoCloseQueue` scheduling calls in this module, and `systemCloseTicket()` in the
> tickets module) as **dead code pending removal** (`task.md` Phase 8). Email
> notifications remain in scope but are now sent via a **direct, non-queued call**
> (Phase 7), not the `emailQueue` BullMQ queue described below.

---

## Overview

The Comments Module exposes three REST endpoints for adding and retrieving comments on support tickets. Comments are scoped to their parent ticket: every read and write operation first verifies that the calling user can access the ticket (via the shared `getTicketById` service function), so the RBAC rules that govern ticket visibility are automatically inherited by comments without duplicating that logic.

Adding a comment (FR-8) accepts `multipart/form-data` so that an optional screenshot image can be uploaded in the same request. The screenshot is validated against an allowed MIME type set (`image/jpeg`, `image/png`), stored in the configured storage backend (local filesystem or S3), and the resulting storage key is persisted in the `comments.screenshot` column. This is distinct from the `attachments` system — a comment screenshot is a single companion image uploaded at comment-creation time, not a separately tracked attachment record (DM-13a).

After a successful insert, the module **currently** fires two independent, fire-and-forget background jobs via BullMQ: a `comment-notification` email job, and — depending on the caller's relationship to the ticket — a delayed `auto-close` job. **This predates the 2026-07-08 decision above.** The `comment-notification` path is slated to be replaced with a direct `sendCommentNotificationEmail()` call (Phase 7), and the `auto-close` scheduling/cancellation calls are slated for outright removal (Phase 8) since the feature is out of scope. Both are currently wrapped in their own `try/catch` blocks so a queue failure never propagates to the API caller. The comment list endpoint is Redis-cached under `ticket:{ticketId}:comments` and invalidated on every new comment (CACHE-2, CACHE-5).

---

## Architecture

The module lives at `src/modules/comments/` and integrates with shared infrastructure for authentication, file upload, storage, caching, and job queuing.

| File | Role |
|------|------|
| `src/modules/comments/comment.routes.ts` | Route definitions + middleware chain (authenticate, multer, validateBody) |
| `src/modules/comments/comment.controller.ts` | Parses `req.params`, delegates to service, sends `success()`/`error()` |
| `src/modules/comments/comment.service.ts` | Business logic: ticket scope gate, screenshot upload, DB insert, cache invalidation, queue enqueue *(queue calls are dead code pending Phase 7/8 cleanup)* |
| `src/modules/comments/comment.schemas.ts` | Zod schema for request body (`createCommentSchema`), `CommentRow` interface, `CreateCommentPayload` type |
| `src/types/jobs.ts` | TypeScript interfaces for job payloads: `NewTicketJobData`, `CommentNotificationJobData` (kept); `AutoCloseJobData` (dead code, pending removal) |
| `src/jobs/queues.ts` | BullMQ `Queue` instances: `emailQueue` and `autoCloseQueue` — **dead code, pending removal** (no job queue is used; see notifications-email.md) |
| `src/middlewares/upload.ts` | Multer instance (memory storage) with MIME allowlist, per-file size cap, and per-request file count limit |
| `src/storage/index.ts` | `StorageBackend` interface, `buildStorageKey()` utility, lazy backend factory (`local` or `s3`) |

Routes are mounted in `src/app.ts` under `/api/v1/tickets`, placing comment endpoints at `/api/v1/tickets/:ticketId/comments`.

---

## API Endpoints

### POST /api/v1/tickets/:ticketId/comments

**Auth required:** Yes — any authenticated role (ADMIN or AGENT)
**Purpose:** Add a new comment to a ticket, with an optional screenshot image.

**Request format:** `multipart/form-data`

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `message` | text field | Yes | Non-empty string after trim |
| `screenshot` | file field | No | `image/jpeg` or `image/png`; subject to `ATTACHMENT_MAX_FILE_SIZE_BYTES` |

**Middleware chain:**
1. `authenticate` — validates JWT, populates `req.user`
2. `upload.single('screenshot')` — multer processes the multipart body; applies MIME and size limits from `ATTACHMENT_ALLOWED_MIME_TYPES` and `ATTACHMENT_MAX_FILE_SIZE_BYTES`; populates `req.file`
3. `validateBody(createCommentSchema)` — Zod validates `req.body.message`; sets `req.body` to the parsed value

**Success response (201):**
```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-...",
    "ticketId": "f5e6d7c8-...",
    "message": "Looking into this now.",
    "screenshot": "2026-07-01/9f8e7d6c-...",
    "createdBy": "b2c3d4e5-...",
    "createdByName": "Alice Agent",
    "createdAt": "2026-07-01T10:00:00.000Z"
  }
}
```

The `screenshot` field is the storage key string (never a signed URL or a public path). A `null` value means no screenshot was uploaded.

**Side effects (fire-and-forget):**
- Cache key `ticket:{ticketId}:comments` is invalidated immediately after the DB insert.
- A `comment-notification` job is added to the `email` BullMQ queue.
- If the caller is the ticket assignee and the ticket is non-terminal (`OPEN` or `IN_PROGRESS`), a delayed `auto-close` job is scheduled (or replaced) on the `auto-close` queue with `jobId = auto-close:{ticketId}`.
- If the caller is the ticket creator and the ticket is non-terminal, any pending `auto-close` job for this ticket is removed.

**Error cases:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | `message` is missing or blank |
| 401 | — | Missing or invalid JWT |
| 403 | `FORBIDDEN` | Caller is an agent with no access to this ticket (not creator, not assignee) |
| 404 | `NOT_FOUND` | Ticket does not exist |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Screenshot MIME type is not `image/jpeg` or `image/png` |

---

### GET /api/v1/tickets/:ticketId/comments

**Auth required:** Yes — any authenticated role (ADMIN or AGENT)
**Purpose:** List all comments for a ticket, ordered oldest-first.

**Success response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "a1b2c3d4-...",
      "ticketId": "f5e6d7c8-...",
      "message": "Looking into this now.",
      "screenshot": null,
      "createdBy": "b2c3d4e5-...",
      "createdByName": "Alice Agent",
      "createdAt": "2026-07-01T10:00:00.000Z"
    }
  ]
}
```

An empty array is returned when the ticket exists but has no comments.

The response is served from Redis cache (`ticket:{ticketId}:comments`) on cache hits. On a cache miss the result is fetched from PostgreSQL, then written to cache. A Redis failure falls through silently to the database (CACHE-7).

**Error cases:**

| Status | Code | Condition |
|--------|------|-----------|
| 401 | — | Missing or invalid JWT |
| 403 | `FORBIDDEN` | Caller lacks access to the parent ticket |
| 404 | `NOT_FOUND` | Ticket does not exist |

---

### GET /api/v1/tickets/:ticketId/comments/:commentId

**Auth required:** Yes — any authenticated role (ADMIN or AGENT)
**Purpose:** Retrieve a single comment by ID, verified to belong to the specified ticket.

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-...",
    "ticketId": "f5e6d7c8-...",
    "message": "Looking into this now.",
    "screenshot": "2026-07-01/9f8e7d6c-...",
    "createdBy": "b2c3d4e5-...",
    "createdByName": "Alice Agent",
    "createdAt": "2026-07-01T10:00:00.000Z"
  }
}
```

**Error cases:**

| Status | Code | Condition |
|--------|------|-----------|
| 401 | — | Missing or invalid JWT |
| 403 | `FORBIDDEN` | Caller lacks access to the parent ticket |
| 404 | `INVALID_COMMENT_REFERENCE` | Comment does not exist or does not belong to this ticket |

---

## Data Model Changes

The `comments` table was created in the initial schema. The `screenshot` column was added in the 2026-07-01 migration (DM-13a).

```sql
-- Original table (initial schema)
CREATE TABLE IF NOT EXISTS comments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  message     TEXT        NOT NULL,
  created_by  UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_ticket_id  ON comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_by ON comments(created_by);

-- Migration 2026-07-01: add screenshot column (DM-13a)
ALTER TABLE comments ADD COLUMN IF NOT EXISTS screenshot TEXT;
```

`screenshot` is a nullable `TEXT` column that holds the storage key returned by `buildStorageKey()` (format: `YYYY-MM-DD/{uuid}`). It is not a public URL; callers that need to display the image must exchange the key through the storage layer. The column is `NULL` when no screenshot was uploaded.

---

## RBAC

No `requireRole` middleware is applied to any comment endpoint. Authorization is enforced entirely through the ticket scope gate: `getTicketById` is called at the start of every service function and throws a `403 FORBIDDEN` error if the caller is an AGENT who is neither the ticket creator nor the ticket assignee.

| Action | ADMIN | AGENT | Enforcement |
|--------|:-----:|:-----:|-------------|
| Add comment to any ticket | Yes | No (own tickets only) | `getTicketById` throws `403` for out-of-scope agents |
| Add comment to accessible ticket | Yes | Yes | `getTicketById` succeeds |
| List comments on any ticket | Yes | No (own tickets only) | `getTicketById` throws `403` for out-of-scope agents |
| List comments on accessible ticket | Yes | Yes | `getTicketById` succeeds |
| Get comment by ID on any ticket | Yes | No (own tickets only) | `getTicketById` throws `403` for out-of-scope agents |
| Get comment by ID on accessible ticket | Yes | Yes | `getTicketById` + SQL `WHERE c.ticket_id = $2` |

"Own tickets" for an AGENT means tickets where `created_by = callerId OR assigned_to = callerId` — enforced in the SQL `WHERE` clause inside `ticket.service.ts`, never by in-memory filtering (RBAC-6).

---

## Caching

| Cache key | Content | TTL | Invalidated by |
|-----------|---------|-----|----------------|
| `ticket:{ticketId}:comments` | Array of `CommentRow` objects, ordered by `created_at ASC` | `config.redis.ttlSeconds` (default 3600 s) | Every successful `addComment` call |
| `admin:default` | UUID of the first seeded ADMIN user | `config.redis.ttlSeconds` (default 3600 s) | Never invalidated (admin seed is static) |

Cache reads and writes are wrapped in independent `try/catch` blocks. A Redis failure logs the error and falls through to PostgreSQL for reads, or is silently skipped for writes, so the API response is never blocked by a cache outage (CACHE-7, CACHE-8).

The `keyPrefix` (`stm:`) is automatically prepended by ioredis — keys stored in Redis are `stm:ticket:{ticketId}:comments` and `stm:admin:default`.

---

## Auto-Close State Machine Integration — Removed From Scope (2026-07-08)

*(This section describes a feature that has been removed from scope — see the note at
the top of this document. Kept for historical/cleanup reference only.)*

The comments module is the only place where the auto-close delayed job (formerly FR-12) was scheduled and cancelled. The job interacted with the ticket state machine via the system-only `SM-6` transition. Neither is reachable in a meaningful way anymore since no worker ever consumed the `auto-close` queue; the scheduling/cancellation calls below are dead code pending removal (`task.md` Phase 8).

### Valid transitions triggered by this module

```
OPEN        --(assignee comment)--> auto-close job scheduled (delayed 48 h)
IN_PROGRESS --(assignee comment)--> auto-close job scheduled (delayed 48 h)

OPEN        --(creator comment)--> pending auto-close job cancelled
IN_PROGRESS --(creator comment)--> pending auto-close job cancelled

OPEN        --(auto-close job fires, no creator reply)--> CLOSED  [SM-6, system only]
IN_PROGRESS --(auto-close job fires, no creator reply)--> CLOSED  [SM-6, system only]
```

Illegal or unnecessary transitions (e.g. firing on `RESOLVED`, `CLOSED`, `CANCELLED`) are prevented by execution-time re-validation inside the job worker (FR-12c). A new assignee comment on the same ticket replaces the existing delayed job because `jobId = 'auto-close:{ticketId}'` is fixed — BullMQ overwrites the delay of the existing job, resetting the 48 h window (FR-12b).

---

## Background Jobs — Being Replaced (Phase 7) / Removed (Phase 8)

| Queue | Job name | Enqueued by | Payload | Status |
|-------|----------|-------------|---------|--------|
| `email` | `comment-notification` | `comment.service.ts` → `addComment` | `CommentNotificationJobData` | To be replaced with a direct `sendCommentNotificationEmail()` call — no queue (Phase 7) |
| `auto-close` | `auto-close` | `comment.service.ts` → `addComment` (assignee comment path) | `AutoCloseJobData` | **Dead code, pending removal.** Feature removed from scope 2026-07-08 (Phase 8) |

### CommentNotificationJobData payload fields

| Field | Type | Description |
|-------|------|-------------|
| `ticketId` | `string` | UUID of the parent ticket |
| `ticketTitle` | `string` | Title of the ticket at comment time |
| `commentMessage` | `string` | The full comment text |
| `commentAuthorId` | `string` | UUID of the user who posted the comment |
| `creatorId` | `string` | UUID of the ticket creator |
| `assigneeId` | `string` | UUID of the current ticket assignee |
| `adminId` | `string` | UUID of the first seeded ADMIN |
| `attachmentCount` | `number` (optional) | Number of attachments, if any |
| `attachmentFilenames` | `string[]` (optional) | Original filenames of attachments |

The email worker is responsible for de-duplicating recipients and excluding the comment author. If `commentAuthorId` matches `creatorId`, `assigneeId`, or `adminId`, that address is omitted from the send list.

### AutoCloseJobData payload fields — dead code, pending removal

| Field | Type | Description |
|-------|------|-------------|
| `ticketId` | `string` | UUID of the ticket to close |
| `triggeringCommentId` | `string` | UUID of the assignee comment that triggered scheduling |
| `assigneeId` | `string` | UUID of the ticket assignee at scheduling time |
| `creatorId` | `string` | UUID of the ticket creator |
| `adminId` | `string` | UUID of the first seeded ADMIN |

Both job enqueue calls are fire-and-forget: each runs inside its own `try/catch`, logs failures to `stderr`, and never re-throws. The originating HTTP request completes independently of queue availability (NFR-8, NFR-11). As noted above, the `comment-notification` enqueue is slated to become a direct call and the `auto-close` enqueue is slated for removal.

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `AUTO_CLOSE_DELAY_MS` | `172800000` (48 h) | **Unused** — auto-close removed from scope 2026-07-08; pending removal from config |
| `ATTACHMENT_ALLOWED_MIME_TYPES` | `image/jpeg,image/png` | Comma-separated MIME types accepted by the multer upload middleware. For comment screenshots the service additionally enforces only `image/jpeg` and `image/png` regardless of this setting. |
| `ATTACHMENT_MAX_FILE_SIZE_BYTES` | `10485760` (10 MB) | Maximum size for any single uploaded file |
| `ATTACHMENT_MAX_FILES_PER_REQUEST` | `5` | Maximum files per multipart request (comment screenshots use `upload.single`, so this cap does not apply) |
| `STORAGE_BACKEND` | `local` | `local` for dev/test; `s3` for production |
| `STORAGE_LOCAL_DIR` | `public` | Root directory for local storage backend |
| `REDIS_TTL_SECONDS` | `3600` | Default TTL for all cache entries including `ticket:{ticketId}:comments` |

No new environment variables were introduced by this module. All variables above were already defined by prior modules.

---

## Testing

### How to run

```bash
npm test -- --testPathPattern="comment"
```

For coverage:

```bash
npm run test:coverage -- --testPathPattern="comment"
```

### Test coverage targets

| Layer | Minimum |
|-------|---------|
| `comment.service.ts` | 90% |
| `comment.controller.ts` | 80% |

### Test file locations (co-located with source)

| Test file | What it covers |
|-----------|----------------|
| `src/modules/comments/comment.service.test.ts` | Unit tests: happy path, MIME rejection, ticket scope gate (403/404), cache hit/miss, direct notification call (post-Phase-7) |
| `src/modules/comments/comment.controller.test.ts` | Integration: HTTP status codes, response envelope shape, 401 for missing JWT, 403 for out-of-scope agent |

### Key test scenarios

- **TEST-7 (notification):** With `NODE_ENV=test` (json transport), assert that `sendCommentNotificationEmail()` is called with all three recipient IDs and that `commentAuthorId` is correctly excluded. Assert de-duplication when creator is the same user as admin. (Direct call, no queue/worker — supersedes the job-payload assertion this doc previously described.)
- ~~TEST-8a–d (auto-close)~~ — **removed from scope 2026-07-08**, not written.
- Screenshot rejected with wrong MIME → `415 UNSUPPORTED_MEDIA_TYPE`.
- Unauthenticated request → `401`.
- Agent commenting on foreign ticket → `403`.
- Non-existent ticket → `404`.
- Missing `message` field → `400 VALIDATION_ERROR`.

---

## Known Limitations / Future Work

- **Screenshot access:** The `screenshot` field in responses is a raw storage key, not a signed download URL. Callers must implement a separate download flow to display the image. A future enhancement could return a pre-signed URL (for S3 backend) or a `/api/v1/comments/:commentId/screenshot` download endpoint.
- **Per-comment cache:** Only the comment list is cached (`ticket:{ticketId}:comments`). Individual comment lookups (`getCommentById`) always hit the database. This is acceptable given comment detail requests are infrequent, but a `comment:{commentId}` cache key could be added if profiling shows contention.
- **Admin resolution:** The `admin:default` cache key always resolves to the first seeded ADMIN ordered by `created_at`. If multiple admins exist, only one receives job payloads. Confirming whether all admins should be notified (§12 assumption) would require extending the `CommentNotificationJobData` payload to carry an `adminIds` array.
- **Comment editing and deletion:** Not in scope for this phase. If supported in the future, the list cache (`ticket:{ticketId}:comments`) must be invalidated on those mutations.
- **BullMQ/auto-close cleanup (2026-07-08):** the `emailQueue`/`autoCloseQueue` BullMQ calls in `addComment()`, `src/config/queue.ts`, `src/jobs/queues.ts`, `AutoCloseJobData`, and `systemCloseTicket()` in `ticket.service.ts` are all dead code from before the direct-call/no-auto-close decision. Tracked for removal in `task.md` Phase 7/8.
- **Auto-close MIME guard vs. upload middleware MIME guard:** The multer middleware (`upload.ts`) checks against the `ATTACHMENT_ALLOWED_MIME_TYPES` env variable. The service layer adds a second, hard-coded check that restricts screenshots specifically to `image/jpeg` and `image/png`. If `ATTACHMENT_ALLOWED_MIME_TYPES` is narrowed in the environment (e.g. set to only `image/png`), the multer guard will reject jpeg files before the service guard is reached.
- **Virus/malware scanning:** Uploaded screenshots are not scanned. Scan integration is deferred (§12 assumption).
