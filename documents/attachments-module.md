# Attachments Module

> **Status:** Implemented
> **Branch:** attachments_setup (PR #16, merge commit 98330f1); refined in chore/remove-screenshot-field (PR #19, e4edffc) and chore/remove-bullmq-modular-middleware (PR #17, e8ac68d)
> **Date:** 2026-07-16
> **Requirements:** FR-13, FR-13a, FR-13b, FR-13c, FR-14, FR-15, FR-16, DM-8, DM-9, DM-10, DM-11, TS-9, VAL-6, RBAC-3, RBAC-4, CACHE-9, NFR-12, NFR-13, TEST-9

---

## Overview

The Attachments Module provides file upload, metadata persistence, and inline embedding of attachment data across the ticket and comment endpoints. It has no standalone HTTP endpoints of its own for upload — file upload is integrated directly into the ticket create (`POST /api/v1/tickets`), ticket update (`PATCH /api/v1/tickets/:id`), and comment create (`POST /api/v1/tickets/:id/comments`) endpoints via shared multer middleware (FR-13). Attachment metadata is embedded as an `attachments: AttachmentRow[]` array inline in every ticket and comment GET response (FR-14). Files are accessed directly via a public-accessible `url` field; there is no separate download endpoint in this module (FR-15 — though `GET .../download` and `DELETE .../:attachmentId` were added later in Phase 9; see `documents/phase-9-tests.md`).

The module is organized around a storage abstraction layer (`src/storage/`) and a service layer (`src/modules/attachments/attachment.service.ts`). The storage abstraction defines an `IStorageBackend`-equivalent interface (`StorageBackend`) with `save`, `getStream`, and `delete` methods, with concrete implementations for local filesystem (`LocalStorageBackend`) and S3-compatible object storage (`S3StorageBackend`). The factory function `getStorageBackend()` resolves the correct backend at runtime from `config.storage.backend` and caches the singleton instance. This design satisfies NFR-13: call sites in the attachment service never import a specific backend directly, so switching from local to S3 requires only an environment variable change.

MIME validation, storage key generation, metadata insertion, and cache management all live in `attachment.service.ts`, which is called by `ticket.service.ts` and `comment.service.ts` after their own access checks pass. Authorization on every attachment operation inherits directly from the parent ticket: because `getTicketById` throws `403` for AGENT callers outside ticket scope, and every upload/read path calls `getTicketById` first, no separate attachment authorization logic is needed (DM-9). Storage bytes are never cached in Redis; only attachment metadata listings are cached, under `ticket:{ticketId}:attachments` (CACHE-9, FR-16).

> **Note on screenshot removal (2026-07-09):** Earlier versions of the tickets and comments modules included a `screenshot` column (plain URL string) distinct from the `attachments` system. That column was dropped in the `chore/remove-screenshot-field` branch (Migration 2026-07-09 in `schema.sql`). Comment file uploads now go exclusively through the shared `uploadAttachmentFiles` middleware. The `comments-module.md` document reflects the pre-removal state and describes the screenshot field; this document reflects the current, post-removal implementation.

---

## Architecture

### Storage layer

| File | Role |
|------|------|
| `src/storage/index.ts` | `StorageBackend` interface; `buildStorageKey(mimeType)` utility (returns `YYYY-MM-DD/{uuid}.ext`); lazy singleton factory `getStorageBackend()` |
| `src/storage/local.ts` | `LocalStorageBackend` — streams bytes to `config.storage.localDir/{key}` using `fs.pipeline`; path-traversal guard via `safePath()`; `getStream` opens a file handle atomically to eliminate TOCTOU race |
| `src/storage/s3.ts` | `S3StorageBackend` — uses `@aws-sdk/lib-storage` `Upload` for streaming saves; `GetObjectCommand` for streaming reads; `DeleteObjectCommand` for deletes |

### Attachment module

| File | Role |
|------|------|
| `src/modules/attachments/attachment.schemas.ts` | `AttachmentRow` public response interface (no `storageKey`); `AttachmentDbRow` internal DB row (includes `storageKey`); `ALLOWED_ATTACHMENT_MIMES` set |
| `src/modules/attachments/attachment.middleware.ts` | `uploadAttachmentFiles` — multer instance with memory storage; MIME `fileFilter` hardcoded to `image/jpeg`/`image/png`; size and count limits from config |
| `src/modules/attachments/attachment.service.ts` | `toAttachmentUrl()`, `uploadAttachments()`, `getAttachmentsByTicket()`, `getAttachmentsByComment()`, `downloadAttachment()`, `deleteAttachment()` |
| `src/modules/attachments/attachment.routes.ts` | `Router({ mergeParams: true })` — download and delete endpoints (Phase 9, cross-referenced in `documents/phase-9-tests.md`) |
| `src/modules/attachments/attachment.controller.ts` | `download` and `remove` controller functions (Phase 9, cross-referenced in `documents/phase-9-tests.md`) |

### Integration points

| File | Change introduced by this module |
|------|----------------------------------|
| `src/modules/tickets/ticket.service.ts` | `withAttachments(dbRow)` helper fetches and merges attachment list into every ticket response; `createTicket()` and `updateTicket()` accept optional `files` and call `uploadAttachments()` |
| `src/modules/tickets/ticket.routes.ts` | `uploadAttachmentFiles` inserted before `validateBody` on `POST /` and `PATCH /:id` |
| `src/modules/tickets/ticket.controller.ts` | Passes `req.files` (as `Express.Multer.File[] | undefined`) to the service on create and update |
| `src/modules/comments/comment.service.ts` | `addComment()` accepts `attachmentFiles` and calls `uploadAttachments()` after the DB insert; `listComments()` uses a single `LEFT JOIN + json_agg` query to avoid N+1 fetches; `getCommentById()` calls `getAttachmentsByComment()` |
| `src/modules/comments/comment.routes.ts` | `uploadAttachmentFiles` inserted before `validateBody` on `POST /:ticketId/comments` |
| `src/modules/comments/comment.controller.ts` | Passes `req.files` to `addComment()` |
| `src/app.ts` | `express.static(config.storage.localDir)` mounted after security middleware, before routes — serves local files at `/{storageKey}`; `attachmentRouter` mounted at `/api/v1/tickets/:ticketId/attachments` |

---

## API Endpoints

Attachment upload is not a standalone endpoint — it is integrated into the existing ticket and comment mutation endpoints. The sections below describe the upload-specific behavior added to those endpoints.

### POST /api/v1/tickets (with file upload)

**Auth required:** Yes — ADMIN or AGENT
**Purpose:** Create a new ticket. Optional `files` array attaches one or more images to the ticket. Without files this endpoint behaves exactly as documented in `documents/tickets-module.md`.

**Request format:** `multipart/form-data`

**Request fields:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `title` | text | Yes | 1–500 chars after trim |
| `description` | text | Yes | Non-empty after trim |
| `priority` | text | No | `LOW \| MEDIUM \| HIGH \| URGENT`; defaults to `MEDIUM` |
| `type` | text | No | Max 100 chars |
| `subType` | text | No | Max 100 chars |
| `files` | file array | No | Up to `ATTACHMENT_MAX_FILES_PER_REQUEST` files; each `image/jpeg` or `image/png`; max `ATTACHMENT_MAX_FILE_SIZE_BYTES` per file |

**Middleware chain:**
`authenticate → uploadAttachmentFiles → validateBody(createTicketSchema) → controller.create`

`uploadAttachmentFiles` must run before `validateBody` so that multer can parse the multipart body and populate both `req.files` and `req.body` text fields before Zod validation runs.

**Success response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Printer not working",
    "description": "The office printer on floor 3 is jammed.",
    "priority": "MEDIUM",
    "status": "OPEN",
    "assignedTo": "uuid-of-admin",
    "createdBy": "uuid-of-caller",
    "createdAt": "2026-07-08T10:00:00.000Z",
    "updatedAt": "2026-07-08T10:00:00.000Z",
    "attachments": [
      {
        "id": "uuid",
        "ticketId": "uuid",
        "commentId": null,
        "filename": "photo.png",
        "mimeType": "image/png",
        "sizeBytes": 45312,
        "uploadedBy": "uuid-of-caller",
        "createdAt": "2026-07-08T10:00:00.000Z",
        "url": "http://localhost:3000/2026-07-08/9f8e7d6c-uuid.png"
      }
    ]
  }
}
```

When no files are uploaded, `attachments` is an empty array `[]`.

**Error cases (upload-specific):**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Single file exceeds `ATTACHMENT_MAX_FILE_SIZE_BYTES`; request exceeds `ATTACHMENT_MAX_FILES_PER_REQUEST` file count |
| 401 | — | Missing or invalid JWT |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | A file's MIME type is not `image/jpeg` or `image/png` |

For non-upload error cases (missing `title`, invalid `priority`, etc.) see `documents/tickets-module.md`.

---

### PATCH /api/v1/tickets/:id (with file upload)

**Auth required:** Yes — ADMIN or AGENT (AGENT: own tickets only)
**Purpose:** Update ticket fields and optionally add new attachments. Attachments accumulate across calls — this endpoint appends new files to the existing list; it does not replace prior uploads.

**Request format:** `multipart/form-data`

**Request fields:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `title` | text | No | 1–500 chars after trim |
| `description` | text | No | Non-empty after trim |
| `priority` | text | No | `LOW \| MEDIUM \| HIGH \| URGENT` |
| `type` | text | No | Max 100 chars; set to empty string to clear |
| `subType` | text | No | Max 100 chars; set to empty string to clear |
| `files` | file array | No | Same constraints as POST |

At least one text field or at least one file must be provided; the Zod schema enforces this with a `.refine()` check on the text fields (the file presence check is service-level).

**Middleware chain:**
`authenticate → uploadAttachmentFiles → validateBody(updateTicketSchema) → controller.update`

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Updated title",
    "description": "Updated description",
    "priority": "HIGH",
    "status": "OPEN",
    "assignedTo": "uuid",
    "createdBy": "uuid",
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601",
    "attachments": [
      {
        "id": "uuid",
        "ticketId": "uuid",
        "commentId": null,
        "filename": "diagram.jpg",
        "mimeType": "image/jpeg",
        "sizeBytes": 102400,
        "uploadedBy": "uuid",
        "createdAt": "ISO8601",
        "url": "http://localhost:3000/2026-07-08/uuid.jpg"
      }
    ]
  }
}
```

`attachments` reflects all attachments for the ticket at the time of the response, including any newly uploaded in this request and any previously uploaded.

**Error cases (upload-specific):**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | File too large or too many files |
| 401 | — | Missing or invalid JWT |
| 403 | `FORBIDDEN` | AGENT caller is outside ticket scope |
| 404 | `NOT_FOUND` | Ticket does not exist |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Disallowed MIME type |

---

### POST /api/v1/tickets/:ticketId/comments (with file upload)

**Auth required:** Yes — ADMIN or AGENT (AGENT: accessible tickets only)
**Purpose:** Add a comment with optional attached images. Uploaded files are scoped to the new comment (`commentId` is set on each attachment row).

**Request format:** `multipart/form-data`

**Request fields:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `message` | text | Yes | Non-empty after trim |
| `files` | file array | No | Up to `ATTACHMENT_MAX_FILES_PER_REQUEST` files; `image/jpeg` or `image/png` only |

**Middleware chain:**
`authenticate → uploadAttachmentFiles → validateBody(createCommentSchema) → controller.add`

**Success response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "ticketId": "uuid",
    "message": "See the attached screenshot.",
    "createdBy": "uuid",
    "createdByName": "Alice Agent",
    "createdAt": "ISO8601",
    "attachments": [
      {
        "id": "uuid",
        "ticketId": "uuid",
        "commentId": "uuid-of-new-comment",
        "filename": "screenshot.png",
        "mimeType": "image/png",
        "sizeBytes": 28000,
        "uploadedBy": "uuid",
        "createdAt": "ISO8601",
        "url": "http://localhost:3000/2026-07-08/uuid.png"
      }
    ]
  }
}
```

**Error cases (upload-specific):**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | File too large or too many files |
| 400 | `INVALID_COMMENT_REFERENCE` | `commentId` does not belong to `ticketId` (service-level defence; not a normal client scenario since `commentId` is set by the service) |
| 401 | — | Missing or invalid JWT |
| 403 | `FORBIDDEN` | AGENT caller lacks access to the parent ticket |
| 404 | `NOT_FOUND` | Ticket does not exist |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Disallowed MIME type |

---

### Attachment metadata in GET responses

`attachments: AttachmentRow[]` is embedded inline in every ticket and comment GET response:

| Endpoint | Attachment source |
|----------|-----------------|
| `GET /api/v1/tickets` | All attachments for each ticket in the list, fetched via `withAttachments()` for each row |
| `GET /api/v1/tickets/:id` | All attachments for the ticket, from `getAttachmentsByTicket(ticketId)` |
| `GET /api/v1/tickets/:ticketId/comments` | Per-comment attachments aggregated in a single `LEFT JOIN + json_agg` SQL query — no N+1 |
| `GET /api/v1/tickets/:ticketId/comments/:commentId` | Attachments for the single comment via `getAttachmentsByComment(commentId)` |

Ticket-level attachments have `commentId: null`. Comment-level attachments have `commentId` set to the parent comment UUID.

> For download and delete of individual attachments (added in Phase 9), see `documents/phase-9-tests.md` — `GET /api/v1/tickets/:ticketId/attachments/:attachmentId/download` and `DELETE /api/v1/tickets/:ticketId/attachments/:attachmentId`.

---

## Data Model Changes

No new tables were introduced by this module. The `attachments` table was created in the prior schema alignment phase (Gap 5, 2026-06-29). This module was the first to write to and read from it.

```sql
-- Gap 5: Create attachments table — metadata only; bytes live in storage backend (DM-8, §3.4).
-- ticketId drives authorization (DM-9); commentId is nullable (DM-10).
-- storage_key is UNIQUE to prevent duplicate storage objects; never returned in API responses.
CREATE TABLE IF NOT EXISTS attachments (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID         NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  comment_id  UUID         REFERENCES comments(id) ON DELETE SET NULL,
  filename    VARCHAR(255) NOT NULL,
  storage_key TEXT         NOT NULL UNIQUE,
  mime_type   VARCHAR(127) NOT NULL,
  size_bytes  INTEGER      NOT NULL CHECK (size_bytes > 0),
  uploaded_by UUID         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- DM-11: Indexes to support listing attachments per ticket and per comment without full scans.
CREATE INDEX IF NOT EXISTS idx_attachments_ticket_id  ON attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_attachments_comment_id ON attachments(comment_id);
```

This module also triggered the removal of the `screenshot` columns that preceded it (Migration 2026-07-09):

```sql
-- Migration 2026-07-09: Drop screenshot columns from tickets and comments
-- Reason: the attachments system fully covers the use case that screenshot was added for.
-- Two separate mechanisms for the same purpose is redundant.
ALTER TABLE tickets  DROP COLUMN IF EXISTS screenshot;
ALTER TABLE comments DROP COLUMN IF EXISTS screenshot;
```

**Key schema facts:**

- `ticket_id` is `NOT NULL` — every attachment belongs to a ticket, even when linked to a comment (DM-9). This is the authorization anchor.
- `comment_id` is nullable — `NULL` means a ticket-level attachment; a non-null value means a comment-level attachment that also belongs to the parent ticket (DM-10).
- `storage_key` is `UNIQUE` — prevents two rows pointing at the same storage object. Format is `YYYY-MM-DD/{uuid}.ext` generated by `buildStorageKey(mimeType)`.
- `storage_key` is never returned in any API response (DM-8). The service computes a `url` from it at read time and discards it before serializing.
- `ON DELETE CASCADE` on `ticket_id` — attachments are purged when the parent ticket is deleted (out of scope currently but schema-safe).
- `ON DELETE SET NULL` on `comment_id` — if a comment is deleted, the attachment row remains but is demoted to ticket-level (`commentId` becomes null).
- `ON DELETE RESTRICT` on `uploaded_by` — prevents deleting a user who has uploaded files.

---

## Storage Abstraction

### `StorageBackend` interface (`src/storage/index.ts`)

```ts
export interface StorageBackend {
  save(key: string, stream: Readable, mimeType: string, sizeBytes: number): Promise<void>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}
```

All three methods accept or return `Readable` streams — bytes are never fully buffered in the application process (NFR-12). The `save` method receives the `Readable` stream from multer's `file.buffer` wrapped via `Readable.from(file.buffer)`.

### `buildStorageKey(mimeType: string): string`

Returns a path of the form `YYYY-MM-DD/{uuid}.jpg` or `YYYY-MM-DD/{uuid}.png`. The date prefix creates natural partitioning in both the local filesystem and S3. The UUID suffix prevents collisions. The client can never influence the storage key (DM-8, FR-13c).

### Local backend (`src/storage/local.ts`)

- Saves to `path.resolve(config.storage.localDir, key)`. Default `config.storage.localDir` is `public`.
- `safePath()` resolves the full path and checks it starts with `baseDir` — prevents path traversal attacks where a crafted key like `../../etc/passwd` could escape the storage root.
- `getStream` opens the file with `fs.promises.open(filePath, 'r')` returning a `FileHandle`, then calls `fh.createReadStream()`. This avoids the TOCTOU race window between a separate `access()` check and `createReadStream()`.
- `delete` uses `fs.promises.rm(filePath, { force: true })` — no-op if the file does not exist.
- Local files are served by `app.use(express.static(config.storage.localDir))` mounted in `src/app.ts`. A file saved at `public/2026-07-08/{uuid}.png` is served at `http://localhost:3000/2026-07-08/{uuid}.png`.

### S3 backend (`src/storage/s3.ts`)

- Configured from `config.storage.s3` (`region`, `accessKeyId`, `secretAccessKey`, `bucket`, optional `endpoint`). If `endpoint` is set, `forcePathStyle: true` is also set (required for MinIO and other S3-compatible services).
- Save uses `@aws-sdk/lib-storage` `Upload` with streaming `Body` — never reads the full file into memory.
- `getStream` sends `GetObjectCommand` and returns `response.Body` cast as `Readable`. If the body is absent or not a `Readable`, it throws a typed error.

### `toAttachmentUrl(key: string): string` (`src/modules/attachments/attachment.service.ts`)

| Backend | URL computed |
|---------|-------------|
| `local` | `{config.appUrl}/{key}` — e.g. `http://localhost:3000/2026-07-08/uuid.png` |
| `s3` | `{endpoint ?? https://{bucket}.s3.{region}.amazonaws.com}/{key}` |

`config.appUrl` defaults to `http://localhost:{PORT}` and is overridden by the `APP_URL` environment variable in production. This produces an absolute URL that opens directly in a browser without a separate download step (TS-9, FR-13c, FR-15).

---

## Upload Flow (per request)

The `uploadAttachments(ticketId, files, uploadedBy, commentId?)` service function:

1. Returns `[]` immediately if `files` is empty.
2. Performs a service-layer MIME re-check (defence in depth — multer already filtered, but the service validates too). Throws `415 UNSUPPORTED_MEDIA_TYPE` if any file fails.
3. If `commentId` is provided, queries `SELECT id FROM comments WHERE id = $1 AND ticket_id = $2` to confirm the comment belongs to the ticket. Throws `400 INVALID_COMMENT_REFERENCE` if not found.
4. Resolves the storage backend singleton via `getStorageBackend()`.
5. Processes files **sequentially** (not in parallel) to avoid memory spikes when multiple large files are uploaded simultaneously.
6. For each file:
   a. Sanitizes the original filename with `sanitize-filename`; falls back to `'unnamed'` if the result is empty.
   b. Generates a storage key via `buildStorageKey(file.mimetype)`.
   c. Calls `backend.save(key, Readable.from(file.buffer), file.mimetype, file.size)`. If save fails, logs the error and skips to the next file — no DB row is inserted (no orphaned metadata).
   d. Inserts a metadata row via `INSERT INTO attachments ... RETURNING ...`. If the insert fails, attempts a compensating `backend.delete(key)` (best-effort — ignores cleanup errors), logs the DB error, and continues to the next file.
   e. Converts the `AttachmentDbRow` to an `AttachmentRow` by calling `toAttachmentUrl(storageKey)` and dropping `storageKey`.
7. Invalidates `ticket:{ticketId}:attachments` cache (fire-and-forget, try/catch).
8. Returns the array of successfully processed `AttachmentRow` objects.

Partial success is acceptable: if 2 of 3 files succeed, the response includes 2 attachment rows.

---

## RBAC

No `requireRole` middleware is applied to upload paths — both roles can upload. Authorization is derived from the parent ticket's access rules, which are already enforced by the service functions that call `uploadAttachments`.

| Action | ADMIN | AGENT | Enforcement |
|--------|:-----:|:-----:|-------------|
| Upload attachment on ticket create | ✅ | ✅ | Any authenticated user can create a ticket; `uploadAttachments` is called after the ticket row is inserted |
| Upload attachment on ticket update | ✅ | ✅ (own tickets only) | `updateTicket` checks `assignedTo === callerId \|\| createdBy === callerId` for agents before calling `uploadAttachments` |
| Upload attachment on comment create | ✅ | ✅ (accessible tickets only) | `addComment` calls `getTicketById` which throws `403` for out-of-scope agents before `uploadAttachments` is reached |
| View attachment metadata (via ticket GET) | ✅ | ✅ (own tickets only) | `getTicketById` enforces scope; `getAttachmentsByTicket` is called only after access check passes |
| View attachment metadata (via comment GET/list) | ✅ | ✅ (own tickets only) | `listComments`/`getCommentById` delegate scope check to `getTicketById` |
| Download attachment binary | ✅ | ✅ (own tickets only) | `downloadAttachment` calls `getTicketById` — see `documents/phase-9-tests.md` |
| Delete attachment | ✅ | ✅ (own upload + ticket access) | `deleteAttachment` checks ticket access via `getTicketById`, then `uploadedBy === callerId` for agents — see `documents/phase-9-tests.md` |

The authorization identity always comes from the verified JWT payload (`req.user.id`, `req.user.role`) — never from the request body (RBAC-6).

---

## Caching

| Cache key | Content | TTL | Invalidated by |
|-----------|---------|-----|----------------|
| `ticket:{ticketId}:attachments` | `AttachmentRow[]` metadata list for the ticket (all attachment rows, ordered by `created_at ASC`) | `config.redis.ttlSeconds` (default 3600 s) | `uploadAttachments()` after any successful upload; `deleteAttachment()` after any delete |

Ticket-level attachment metadata (`getAttachmentsByTicket`) is read from `ticket:{ticketId}:attachments` first, falls back to Postgres on miss, then writes the result to cache. Comment-level attachment metadata (`getAttachmentsByComment`) is not individually cached — it is fetched inline inside `listComments` (via `json_agg` SQL aggregation) and `getCommentById` (via `getAttachmentsByComment`), which are covered by the `ticket:{ticketId}:comments` cache key.

Attachment **bytes** are never stored in Redis (CACHE-9). All cache reads and writes are wrapped in independent `try/catch` blocks. A Redis failure logs the error and falls through to Postgres — it never propagates to the client (CACHE-7, CACHE-8).

The `stm:` key prefix is auto-prepended by ioredis — stored keys are `stm:ticket:{ticketId}:attachments`. Never add the prefix manually in key strings.

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `STORAGE_BACKEND` | `local` | `local` for dev/test; `s3` for production |
| `STORAGE_LOCAL_DIR` | `public` | Root directory for `LocalStorageBackend`; also the path passed to `express.static` in `app.ts` |
| `APP_URL` | `http://localhost:{PORT}` | Base URL prepended to `storageKey` to form the public `url` for local backend attachments |
| `S3_BUCKET` | — | S3 bucket name (required when `STORAGE_BACKEND=s3`) |
| `S3_REGION` | — | AWS region |
| `S3_ACCESS_KEY_ID` | — | AWS access key |
| `S3_SECRET_ACCESS_KEY` | — | AWS secret key |
| `S3_ENDPOINT` | — | Optional custom endpoint for S3-compatible services (MinIO, etc.) |
| `ATTACHMENT_MAX_FILE_SIZE_BYTES` | `10485760` (10 MB) | Per-file size limit enforced at multer stream level (not post-read) |
| `ATTACHMENT_MAX_FILES_PER_REQUEST` | `5` | Maximum number of files per multipart request |

`ATTACHMENT_ALLOWED_MIME_TYPES` is a config variable read into `config.attachment.allowedMimeTypes`, but the attachment middleware ignores it — the allowlist is hardcoded to `['image/jpeg', 'image/png']` in `ALLOWED_ATTACHMENT_MIMES` (per VAL-6, FR-13b). This prevents a misconfigured environment from accidentally relaxing the file type restriction.

---

## Testing

### How to run

```bash
# Unit tests for attachment service (mocked DB and storage)
npm test -- --testPathPattern="attachment.service"

# Integration tests for attachment download/delete endpoints (real test DB)
npm test -- --testPathPattern="attachment.controller"

# Run all tests serially (required for integration suites sharing the test DB)
npm test
```

Integration tests require:
- `NODE_ENV=test` (set automatically by Jest via `jest.setup.ts`)
- `STORAGE_BACKEND=local` and a writable `STORAGE_LOCAL_DIR` (defaults to `public/`)
- A running PostgreSQL instance with `ttn_stm_test` initialized: `NODE_ENV=test npm run db:migrate`
- A running Redis instance

### Test coverage

| Test file | What it covers |
|-----------|----------------|
| `src/modules/attachments/attachment.service.test.ts` | Unit tests with mocked `query`, `getCache`/`setCache`/`deleteCache`, and storage backend; covers `toAttachmentUrl`, `uploadAttachments`, `getAttachmentsByTicket`, `getAttachmentsByComment` |
| `src/modules/attachments/attachment.controller.test.ts` | Integration tests against real test DB: download and delete endpoints (Phase 9) — see `documents/phase-9-tests.md` |

### Key test scenarios

- **TEST-9 (upload, service unit):** `uploadAttachments` returns `[]` when no files are provided. Disallowed MIME (`application/pdf`) is rejected with `{ statusCode: 415, code: 'UNSUPPORTED_MEDIA_TYPE' }` before any storage call. A `commentId` that does not belong to `ticketId` is rejected with `{ statusCode: 400, code: 'INVALID_COMMENT_REFERENCE' }`. Happy path: `backend.save` is called with the correct key and stream; the returned `AttachmentRow` includes a computed `url` (`{APP_URL}/{storageKey}`) and does not include `storageKey`. `commentId` is passed through to the INSERT parameters when provided. Storage save failure causes the file to be skipped with no DB insert. DB insert failure triggers a compensating `backend.delete` call.

- **TEST-9 (cache, service unit):** `getAttachmentsByTicket` returns the cached array without querying Postgres on a cache hit. On a cache miss, queries the DB, strips `storageKey`, computes `url`, and writes the result to cache. A Redis failure on the cache read falls back to the DB transparently.

- **TEST-9 (download/delete, controller integration):** See `documents/phase-9-tests.md` — download streams correct `Content-Type` and `Content-Disposition` headers; out-of-scope AGENT gets `403`; non-existent attachment gets `404`. Delete returns `204` for uploader and ADMIN; non-uploader AGENT with ticket access gets `403`; follow-up download confirms DB row is gone.

---

## Known Limitations / Future Work

- **Memory pressure on upload:** `multer.memoryStorage()` holds all file bytes in RAM before they are streamed to the storage backend. For up to 5 files at 10 MB each, peak per-request memory is 50 MB. The `fileSize` limit is enforced at the multer stream level (not post-read), so worst-case exposure is bounded. For higher-volume deployments, `multer.diskStorage()` with a temp directory could reduce memory pressure, or the streaming upload could be wired directly from the HTTP request stream to the storage backend without the multer buffer intermediate.

- **Partial upload failure is silent to the caller:** If 1 of 3 files fails to save (storage backend error), the response includes the 2 successful attachment rows and no indication that the third failed. The failure is logged server-side. A future enhancement could add a `failedCount` or `errors` field to the response to inform the caller.

- **`GET /api/v1/tickets` (list) fetches all attachments N times:** `withAttachments()` is called once per ticket row in the list response via `Promise.all(...rows.map(withAttachments))`. Each call checks the `ticket:{id}:attachments` cache first, but cold list pages can produce N cache misses followed by N DB queries. A single aggregating SQL query (similar to the `json_agg` pattern in `listComments`) could fetch all attachment metadata for all visible tickets in one round trip.

- **`toAttachmentUrl` for S3 uses the object URL directly:** This works for public S3 buckets and path-style MinIO, but does not generate pre-signed URLs for private buckets. Switching to pre-signed URLs would require passing an expiry parameter and would make the `url` field short-lived (not suitable for caching). The current assumption is that the S3 bucket is publicly readable in production.

- **`ATTACHMENT_ALLOWED_MIME_TYPES` config is intentionally ignored:** The config default allows many MIME types (PDFs, Word documents, etc.), but the module hardcodes `image/jpeg` and `image/png` per VAL-6. If the requirements are ever relaxed to allow additional types, both `ALLOWED_ATTACHMENT_MIMES` in `attachment.schemas.ts` and the extension map in `storage/index.ts`'s `MIME_EXTENSIONS` must be updated together.

- **No virus/malware scanning:** Uploaded bytes go directly to the storage backend without content inspection. Scan integration is noted as out of scope in `requirements.md` §12.

- **`comments-module.md` reflects the pre-removal state:** That document still describes the `screenshot` column and the BullMQ queue pattern. It will diverge further as Phase 7/8 cleanup removes those dead-code paths. The authoritative state for comments + attachments integration is the current source code, not that document.
