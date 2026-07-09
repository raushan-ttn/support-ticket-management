# Plan: Storage Abstraction & Attachments Module (Phase 6)

> **Requirements:** FR-13, FR-13a, FR-13b, FR-13c, FR-14, FR-15, FR-16, DM-8, DM-9, DM-10, DM-11, DM-12, DM-13, DM-13a, TS-9, VAL-6, RBAC-3, RBAC-4, CACHE-9, NFR-12, NFR-13, TEST-9
> **Date:** 2026-07-08
>
> **Superseded (2026-07-09):**
> 1. **`tickets.screenshot` / `comments.screenshot` (DM-13/DM-13a), referenced
>    throughout this plan as a separate mechanism from `attachments`, have been
>    **removed**. Comment file uploads now go exclusively through `uploadAttachmentFiles`
>    (this module's middleware) — the dedicated `upload.single('screenshot')` /
>    `toScreenshotUrl()` machinery this plan explicitly left untouched (see "Critical
>    discrepancy #3" and the "Two multer instances on same route" risk note below) no
>    longer exists; `comment.middleware.ts` has been deleted. See `task.md` Phase 10.
> 2. **The local-URL bug this plan's "Decision" (Critical discrepancy #3) chose to
>    accept** — `toAttachmentUrl()` returning a bare relative `/${key}` for the local
>    backend — has been **fixed**. A new `APP_URL` config var (`src/config/index.ts`,
>    default `http://localhost:{PORT}`) is now prepended, so `toAttachmentUrl()`
>    returns an absolute URL that opens directly in a browser. See `requirements.md`
>    TS-9/FR-13c/FR-15 and `task.md` Phase 10.
> 3. **`GET /api/v1/tickets` (list) not embedding `attachments`** was a bug (not
>    covered by this plan, which only planned the single-ticket `GET /:id` case) —
>    fixed by mapping list rows through the same `withAttachments()` helper.
>
> Historical content below is left as-is for context.

---

## Problem

The system must support file attachments (PNG/JPG only) on tickets and comments (FR-13). Metadata lives in the existing `attachments` table in Postgres (§3.4). Bytes live in a pluggable storage backend — local filesystem for dev, S3-compatible for prod (TS-9, NFR-13). There are **no standalone attachment endpoints** (requirements §5.6, line 379): upload is integrated into the existing ticket/comment mutation endpoints, and attachment metadata is embedded inline in ticket/comment GET responses (FR-14). Files are accessed directly via a `url` field; there is no separate download endpoint (FR-15).

Three existing endpoints must be extended to accept `multipart/form-data` with optional `files` fields: `POST /api/v1/tickets`, `PATCH /api/v1/tickets/:id`, and `POST /api/v1/tickets/:id/comments`. Three existing GET endpoints must embed inline `attachments: AttachmentRow[]`: `GET /api/v1/tickets/:id`, `GET /api/v1/tickets/:id/comments`, and `GET /api/v1/tickets/:id/comments/:commentId`.

---

## Verified Current State (pre-implementation)

Before planning, the following files were read to confirm actual implementation state:

| File | Actual State |
|------|-------------|
| `src/storage/index.ts` | EXISTS — `StorageBackend` interface with `save(key, stream, mimeType, sizeBytes): Promise<void>`, `getStream(key)`, `delete(key)`; `buildStorageKey()` returns `YYYY-MM-DD/{uuid}`; `getStorageBackend()` factory |
| `src/storage/local.ts` | EXISTS — saves to `config.storage.localDir + '/' + key`; path-traversal guard |
| `src/storage/s3.ts` | EXISTS — `@aws-sdk/lib-storage` Upload; `GetObjectCommand` for streaming |
| `src/config/index.ts` | EXISTS — `config.storage.localDir` defaults to `'public'`; `config.attachment.allowedMimeTypes` defaults to many types (PDF, Word, Excel, etc.) — **not** restricted to image/jpeg + image/png |
| `src/middlewares/upload.ts` | EXISTS — `multer.memoryStorage()` with `fileFilter` reading from `config.attachment.allowedMimeTypes` |
| `src/modules/attachments/` | DOES NOT EXIST |
| `src/app.ts` | `express.static` NOT mounted; no `attachments` router |
| `src/modules/tickets/ticket.service.ts` | `getTicketById()` returns `TicketRow` without `attachments` field; `createTicket()`/`updateTicket()` do not call `uploadAttachments()` |
| `src/modules/comments/comment.service.ts` | `listComments()`/`getCommentById()` return `CommentRow` without `attachments` field; `addComment()` does NOT call `uploadAttachments()` for attachment files |

**Critical discrepancy #1:** `src/storage/index.ts`'s `save()` does not return `{ storageKey, url }` as task.md claims. It is `save(key, stream, mimeType, sizeBytes): Promise<void>`. The caller constructs the URL separately. The attachment service must construct the `url` from the storage key using backend-specific logic (matching the `toScreenshotUrl()` pattern already in `comment.service.ts`).

**Critical discrepancy #2:** `config.attachment.allowedMimeTypes` is too permissive (allows PDFs, Word docs, etc.). Requirements (VAL-6, FR-13b) restrict attachments to `image/jpeg` and `image/png` only. The attachment service must enforce this at its own layer regardless of the broad config default. The `upload.ts` middleware MIME allowlist must also be restricted for ticket/comment attachment routes — this is handled by using a separate, purpose-built multer instance in the attachment service or by overriding the allowed set in the upload middleware.

**Critical discrepancy #3:** `config.storage.localDir` defaults to `'public'`. `local.ts` saves files to `public/YYYY-MM-DD/{uuid}`. For `express.static('public')` to serve a file at `/YYYY-MM-DD/{uuid}`, the URL returned to clients must be `/${key}` (not `/uploads/${key}`). However, `comment.service.ts`'s `toScreenshotUrl()` returns `/uploads/${key}` — which suggests `config.storage.localDir` was historically `'public/uploads'`. The plan normalises this: the attachment service should compute the local URL as `/${key}` relative to the `localDir`. To avoid two different URL patterns for screenshots vs. attachments, either update `comment.service.ts` to be consistent or clarify in the plan. **Decision:** keep the existing `comment.service.ts` `toScreenshotUrl()` behaviour unchanged (screenshot is stored as raw key in DB and URL is reconstructed at read time). For the new `attachment` module, use the same `toAttachmentUrl(key)` helper pattern — returning `/${key}` for local and the S3 object URL for prod. The mount point for `express.static` must be `app.use(express.static(config.storage.localDir))` so the URL path matches.

---

## Approach

- Follow the auth module pattern: `attachment.schemas.ts` → `attachment.service.ts`. No controller, no routes — because there are no standalone attachment endpoints. The service is called by `ticket.service.ts` and `comment.service.ts`.
- Reuse `query`, `withTransaction` from `src/config/postgres.ts`.
- Reuse `setCache`, `getCache`, `deleteCache` from `src/config/redis.ts`.
- Reuse `buildStorageKey`, `getStorageBackend` from `src/storage/index.ts`.
- A new multer instance restricted to `image/jpeg`/`image/png` is defined in the attachment service's companion middleware file (or inline in routes). The existing `upload.ts` (used by comments for screenshots) is left unchanged to avoid breaking that flow.
- MIME restriction and file-count/size limits for attachments are enforced both at the multer `fileFilter` level (stream-level, before bytes are read) and double-checked in the service before persisting.
- URL construction (storage key → public URL) is centralised in `attachment.service.ts` via a helper `toAttachmentUrl(key)`, mirroring `toScreenshotUrl()` in `comment.service.ts`.

---

## Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/modules/attachments/attachment.schemas.ts` | Create | `AttachmentRow` response interface; no `storageKey`; `url` field included |
| `src/modules/attachments/attachment.service.ts` | Create | `uploadAttachments()`, `getAttachmentsByTicket()`, `getAttachmentsByComment()`, `toAttachmentUrl()` |
| `src/middlewares/uploadAttachments.ts` | Create | Multer instance restricted to `image/jpeg`/`image/png` only; reused by ticket + comment routes |
| `src/modules/tickets/ticket.schemas.ts` | Modify | Add `attachments: AttachmentRow[]` to `TicketRow` interface; add `TicketWithAttachments` alias |
| `src/modules/tickets/ticket.service.ts` | Modify | `getTicketById()` joins/fetches inline attachments; `createTicket()` and `updateTicket()` accept optional files and call `uploadAttachments()` |
| `src/modules/tickets/ticket.controller.ts` | Modify | `create` and `update` controllers pass `req.files` to the service |
| `src/modules/tickets/ticket.routes.ts` | Modify | `POST /` and `PATCH /:id` get `uploadAttachments.array('files', maxCount)` middleware before `validateBody` |
| `src/modules/comments/comment.schemas.ts` | Modify | Add `attachments: AttachmentRow[]` to `CommentRow` interface |
| `src/modules/comments/comment.service.ts` | Modify | `addComment()` calls `uploadAttachments()` for `req.files`; `listComments()` and `getCommentById()` join inline attachments per comment |
| `src/modules/comments/comment.controller.ts` | Modify | `add` controller passes `req.files` (array) alongside `req.file` (screenshot) |
| `src/modules/comments/comment.routes.ts` | Modify | `POST /:ticketId/comments` adds `uploadAttachments.array('files', maxCount)` alongside existing `upload.single('screenshot')` |
| `src/app.ts` | Modify | Mount `express.static(config.storage.localDir)` before routes (local dev file serving, FR-15) |
| `src/db/schema.sql` | No change needed | `attachments` table already exists (Migration 2026-06-29, Gap 5) |

---

## Schema Changes

No DDL changes are required. The `attachments` table was created in the 2026-06-29 migration (Gap 5) with all required columns:

```sql
-- Already in schema.sql — confirmed present:
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
CREATE INDEX IF NOT EXISTS idx_attachments_ticket_id  ON attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_attachments_comment_id ON attachments(comment_id);
```

The `url` column does **not** exist in the schema — `url` is a derived field computed at query time from `storage_key` using `toAttachmentUrl()`. `storage_key` is stored but never returned to clients (DM-8).

---

## Zod Schemas

### `attachment.schemas.ts`

No Zod body schemas needed (no standalone endpoints). Only TypeScript interfaces:

**`AttachmentRow`** — response shape for a single attachment (no `storageKey`):
- `id`: string (UUID)
- `ticketId`: string (UUID)
- `commentId`: string | null (UUID, null for ticket-level attachments)
- `filename`: string (sanitized original filename)
- `mimeType`: string
- `sizeBytes`: number
- `uploadedBy`: string (UUID)
- `createdAt`: string (ISO timestamp)
- `url`: string (public-accessible URL; derived from `storage_key` at query time — never stored in DB)

**`AttachmentDbRow`** — internal DB row shape (used inside service only, includes `storageKey`):
- All fields of `AttachmentRow` except `url`, plus `storageKey: string`

---

## Multer Middleware — `src/middlewares/uploadAttachments.ts`

A dedicated multer instance for attachment files, separate from the existing `upload.ts` (which is used by comments for screenshot handling). This instance enforces the requirements-mandated MIME allowlist of exactly `image/jpeg` and `image/png` (VAL-6, FR-13b), independent of `config.attachment.allowedMimeTypes` which has a broader default.

**Configuration:**
- `storage`: `multer.memoryStorage()` — bytes held in memory before streaming to storage backend (NFR-12)
- `limits.fileSize`: `config.attachment.maxFileSizeBytes` (default 10 MB)
- `limits.files`: `config.attachment.maxFilesPerRequest` (default 5)
- `fileFilter`: checks `file.mimetype` against a hardcoded `Set(['image/jpeg', 'image/png'])`; if not in set, calls `cb(err)` with a 415-coded error object
- Exported as: `uploadAttachments` — used as `uploadAttachments.array('files', config.attachment.maxFilesPerRequest)` in routes

**Note on multer error handling:** multer throws `MulterError` for limit violations. The global `errorHandler` must handle `MulterError` (code `LIMIT_FILE_SIZE` → 400, `LIMIT_FILE_COUNT` → 400, `LIMIT_UNEXPECTED_FILE` → 400). Check if `errorHandler.ts` already handles `MulterError`; if not, add handling.

---

## Business Logic (per change)

### New: `attachment.service.ts`

#### `toAttachmentUrl(key: string): string`
- Internal helper
- If `config.storage.backend === 's3'`: construct S3 URL using `endpoint ?? https://{bucket}.s3.{region}.amazonaws.com` + `/{key}`
- If local: return `/${key}` — this is the path relative to `express.static(config.storage.localDir)`
- No DB access. Pure config computation.

#### `uploadAttachments(ticketId, files, uploadedBy, commentId?)`
- **Input:** `ticketId: string`, `files: Express.Multer.File[]`, `uploadedBy: string`, `commentId?: string`
- **Pre-conditions:**
  - If `files` is empty or undefined, return `[]` immediately (no-op)
  - Service-layer MIME re-check (defence in depth): for each file, verify `file.mimetype` is `image/jpeg` or `image/png`; throw 415 if not
  - Ticket existence is assumed verified by caller before invoking this function (callers are `createTicket`, `updateTicket`, `addComment` which all verify ticket access)
  - If `commentId` provided: verify `SELECT id FROM comments WHERE id = $1 AND ticket_id = $2` — if no row, throw 400 with code `INVALID_COMMENT_REFERENCE`
- **Per-file loop (sequential, not parallel — avoids memory spike):**
  1. Sanitize filename: `sanitizeFilename(file.originalname)` → if result is empty string, fall back to `'unnamed'`
  2. Generate storage key: `buildStorageKey()` — returns `YYYY-MM-DD/{uuid}`
  3. Save bytes: `backend.save(key, Readable.from(file.buffer), file.mimetype, file.size)` — stream to backend
  4. Insert metadata row: `INSERT INTO attachments (ticket_id, comment_id, filename, storage_key, mime_type, size_bytes, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, ticket_id, comment_id, filename, storage_key, mime_type, size_bytes, uploaded_by, created_at`
  5. If storage save throws: log error, skip DB insert for that file, continue to next (partial success acceptable; never leave orphaned metadata rows)
  6. Append `AttachmentRow` (with computed `url`) to result array
- **After loop:** invalidate cache `ticket:{ticketId}:attachments` (fire-and-forget, try/catch)
- **Returns:** `AttachmentRow[]` for the files that succeeded

#### `getAttachmentsByTicket(ticketId: string): Promise<AttachmentRow[]>`
- Check cache `ticket:{ticketId}:attachments` — return if hit
- Query: `SELECT id, ticket_id AS "ticketId", comment_id AS "commentId", filename, storage_key AS "storageKey", mime_type AS "mimeType", size_bytes AS "sizeBytes", uploaded_by AS "uploadedBy", created_at AS "createdAt" FROM attachments WHERE ticket_id = $1 ORDER BY created_at ASC`
- Map rows: for each DB row, compute `url = toAttachmentUrl(row.storageKey)`, then exclude `storageKey` from the returned `AttachmentRow`
- Write to cache with `config.redis.ttlSeconds` TTL (graceful: try/catch, log on failure)
- Returns: `AttachmentRow[]` (with `url`, without `storageKey`)

#### `getAttachmentsByComment(commentId: string): Promise<AttachmentRow[]>`
- No cache (comment-level attachments are fetched inside `listComments`/`getCommentById` which are already cached at the comment-list level)
- Query: `SELECT id, ticket_id AS "ticketId", comment_id AS "commentId", filename, storage_key AS "storageKey", mime_type AS "mimeType", size_bytes AS "sizeBytes", uploaded_by AS "uploadedBy", created_at AS "createdAt" FROM attachments WHERE comment_id = $1 ORDER BY created_at ASC`
- Map rows: compute `url`, exclude `storageKey`
- Returns: `AttachmentRow[]`

---

### Modifications to `ticket.service.ts`

#### `getTicketById()` — add inline `attachments`
- Signature becomes: returns `TicketRow & { attachments: AttachmentRow[] }` (or a `TicketWithAttachments` interface)
- After fetching the ticket row (cache hit or DB), call `getAttachmentsByTicket(id)` to get attachments
- Merge: `{ ...ticket, attachments }`
- Cache strategy: the `ticket:{id}` cache key currently stores just `TicketRow`. After this change, it should store `TicketRow` only (not with attachments, because attachments have their own `ticket:{id}:attachments` cache). The controller merges them. **Alternative:** cache the merged object. Decision: keep caches separate — `ticket:{id}` for ticket fields, `ticket:{id}:attachments` for attachment list — and merge in the service before returning. This means `getTicketById()` makes two cache lookups (graceful degradation: if either misses, falls back to DB).
- Authorization check is already in `getTicketById()` (agent scope filter via SQL WHERE / post-read check); attachments inherit the same authorization by virtue of being fetched only after the ticket access check passes.

#### `createTicket()` — accept files
- Add optional `files: Express.Multer.File[] | undefined` parameter
- After inserting the ticket and fetching it, if `files` has length > 0: call `uploadAttachments(ticketId, files, creatorId)` (no `commentId`)
- Merge returned attachment rows into the response
- Fire-and-forget cache invalidation already happens; `uploadAttachments()` additionally invalidates `ticket:{id}:attachments`

#### `updateTicket()` — accept files
- Add optional `files: Express.Multer.File[] | undefined` parameter
- After updating the ticket fields, if `files` has length > 0: call `uploadAttachments(ticketId, files, callerId)` (no `commentId`)
- Return the updated ticket merged with newly added attachments (for the update response, returning only the newly added attachment rows is acceptable; FR-14 does not require the full list in the update response — only GET endpoints embed the full list)

---

### Modifications to `ticket.controller.ts`

#### `create`
- Extract `req.files` as `Express.Multer.File[]` (from `upload.array()`; will be `undefined` if no files) and pass to `ticketService.createTicket(req.body, user.id, req.files as Express.Multer.File[] | undefined)`

#### `update`
- Extract `req.files` and pass to `ticketService.updateTicket(id, req.body, user.id, user.role, req.files as Express.Multer.File[] | undefined)`

---

### Modifications to `ticket.routes.ts`

- `POST /`: add `uploadAttachments.array('files', config.attachment.maxFilesPerRequest)` middleware **before** `validateBody(createTicketSchema)`. Multer must run first so `req.body` fields (populated from multipart form-data text fields) and `req.files` are available when `validateBody` runs.
- `PATCH /:id`: add `uploadAttachments.array('files', config.attachment.maxFilesPerRequest)` before `validateBody(updateTicketSchema)`.

**Middleware chain for `POST /`:**
`authenticate → uploadAttachments.array('files', N) → validateBody(createTicketSchema) → controller.create`

**Middleware chain for `PATCH /:id`:**
`authenticate → uploadAttachments.array('files', N) → validateBody(updateTicketSchema) → controller.update`

---

### Modifications to `comment.service.ts`

#### `addComment()` — accept attachment files
- Add optional `attachmentFiles: Express.Multer.File[] | undefined` parameter (distinct from `file` which is the single screenshot)
- After inserting the comment and resolving `commentId`, if `attachmentFiles` has length > 0: call `uploadAttachments(ticketId, attachmentFiles, callerId, commentId)`
- The returned `CommentRow` should include `attachments: AttachmentRow[]`

#### `listComments()` — inline attachments per comment
- After fetching comment rows from DB, for each comment, call `getAttachmentsByComment(comment.id)` and attach to the comment object
- **Efficiency concern:** N+1 query risk for large comment lists. Decision: use a single query joining attachments, grouping by comment. Use a CTE or aggregation:
  ```sql
  SELECT c.id, ..., 
         COALESCE(json_agg(
           json_build_object('id', a.id, 'filename', a.filename, ..., 'storageKey', a.storage_key)
           ORDER BY a.created_at ASC
         ) FILTER (WHERE a.id IS NOT NULL), '[]') AS attachments
  FROM comments c
  JOIN users u ON u.id = c.created_by
  LEFT JOIN attachments a ON a.comment_id = c.id
  WHERE c.ticket_id = $1
  GROUP BY c.id, u.name
  ORDER BY c.created_at ASC
  ```
  URL construction: map `storageKey` fields from the JSON aggregate to `url` values after query, then drop `storageKey` from the response.
- The existing `ticket:{ticketId}:comments` cache stores `CommentRow[]`. After this change, the cached shape includes `attachments`. Cache invalidation already happens on new comment; the `uploadAttachments()` call additionally invalidates `ticket:{id}:attachments`.

#### `getCommentById()` — inline attachments
- After fetching the single comment, call `getAttachmentsByComment(commentId)` and merge
- No additional caching (single-item lookup, not worth separate cache key)

---

### Modifications to `comment.controller.ts`

#### `add`
- Extract `req.files` (array from `uploadAttachments.array()`) and pass to `commentService.addComment(ticketId, message, req.file, req.files as Express.Multer.File[] | undefined, user.id, user.role)`

---

### Modifications to `comment.routes.ts`

`POST /:ticketId/comments` chain becomes:
`authenticate → upload.single('screenshot') → uploadAttachments.array('files', N) → validateBody(createCommentSchema) → controller.add`

Both multer middlewares run before `validateBody`. The `upload.single('screenshot')` populates `req.file`; `uploadAttachments.array('files', N)` populates `req.files`. They use separate field names so they do not conflict.

---

### Modification to `src/app.ts`

Add `express.static` mount for local dev file serving (FR-15, TS-9):
- `app.use(express.static(config.storage.localDir))` — placed after helmet/cors/compression and before routes
- This serves `public/*` files at the root path: a file stored at `public/2026-07-08/{uuid}` is served at `/2026-07-08/{uuid}`
- `config.storage.localDir` defaults to `'public'`; in tests use `.tmp/test-uploads` (via `STORAGE_LOCAL_DIR` env)
- For S3, this middleware is a no-op (serves an empty or non-existent directory); S3 URLs are direct S3 object URLs

---

## RBAC & Authorization

| Operation | ADMIN | AGENT | Enforcement |
|-----------|:-----:|:-----:|-------------|
| Upload attachments via `POST /api/v1/tickets` | ✅ | ✅ | Ticket access check already in `createTicket()`; any authenticated user can create a ticket |
| Upload attachments via `PATCH /api/v1/tickets/:id` | ✅ | ✅ (own tickets only) | `updateTicket()` checks `assignedTo === callerId \|\| createdBy === callerId` for agents |
| Upload attachments via `POST /api/v1/tickets/:id/comments` | ✅ | ✅ (accessible tickets only) | `addComment()` delegates to `getTicketById()` which enforces agent scope |
| View attachments via `GET /api/v1/tickets/:id` | ✅ | ✅ (own tickets only) | `getTicketById()` enforces scope; attachments are fetched only after access check passes |
| View attachments via `GET /api/v1/tickets/:id/comments` | ✅ | ✅ (own tickets only) | `listComments()` delegates to `getTicketById()` for scope |
| View attachments via `GET /api/v1/tickets/:id/comments/:commentId` | ✅ | ✅ (own tickets only) | `getCommentById()` delegates to `getTicketById()` for scope |

Authorization is enforced in `getTicketById()` via SQL `WHERE` clause for agent scope (already implemented). Attachment access is derived entirely from parent ticket access (DM-9). No separate attachment authorization logic is needed.

---

## State Machine

Not applicable to attachments. Uploads do not trigger status transitions.

---

## Cache Strategy

| Key | Content | TTL | Invalidated by |
|-----|---------|-----|----------------|
| `ticket:{id}` | `TicketRow` (ticket fields only, not attachments) | `config.redis.ttlSeconds` | Any ticket mutation (already implemented in `invalidateTicketCache()`) |
| `ticket:{id}:attachments` | `AttachmentRow[]` for the ticket | `config.redis.ttlSeconds` | `uploadAttachments()` after any successful upload (fire-and-forget try/catch) |
| `ticket:{id}:comments` | `CommentRow[]` with inline `attachments` | `config.redis.ttlSeconds` | `addComment()` invalidation (already implemented); re-populate includes inline attachments |

Attachment bytes are never cached in Redis (CACHE-9). Cache failures are logged, never propagated to the client (CACHE-7).

---

## Queue / Job Strategy

Not applicable for this phase. Attachments do not enqueue jobs directly. The existing `comment.service.ts` email queue enqueue is preserved unchanged.

---

## Error Cases

| Scenario | HTTP | Code |
|----------|------|------|
| File MIME type not `image/jpeg` or `image/png` | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| Single file exceeds `maxFileSizeBytes` | 400 | `VALIDATION_ERROR` |
| Request exceeds `maxFilesPerRequest` file count | 400 | `VALIDATION_ERROR` |
| `commentId` provided but does not belong to `ticketId` | 400 | `INVALID_COMMENT_REFERENCE` |
| Parent ticket does not exist | 404 | `NOT_FOUND` |
| Caller lacks access to parent ticket (agent not assigned/created) | 403 | `FORBIDDEN` |
| Storage backend save failure (per file) | Logged; file skipped; no 5xx if other files succeed | — |
| All files fail to save | 500 | Internal error (log detail; surface generic message) |

**MulterError mapping** (must be added to `errorHandler.ts` if not already present):
- `LIMIT_FILE_SIZE` → 400, message: `File too large`
- `LIMIT_FILE_COUNT` → 400, message: `Too many files`
- `LIMIT_UNEXPECTED_FILE` → 400, message: `Unexpected file field`

---

## Risks

**Memory pressure:** `multer.memoryStorage()` holds all file bytes in RAM until streamed to the storage backend. For up to 5 files × 10 MB each, peak memory per request is 50 MB. This is acceptable for the expected load but should be noted in deployment docs. The `fileSize` limit at multer stream-level (not post-read) mitigates worst-case exposure (NFR-12).

**Partial upload failure:** If saving file 2 of 3 fails (storage backend error), files 1 and 3 still succeed. File 2's metadata row is not inserted (no orphaned metadata). File 1's bytes are in storage but we cannot roll them back (storage is not transactional). This is an accepted trade-off — logged, not surfaced to the client as a failure unless all files fail.

**Two multer instances on same route:** `comment.routes.ts` runs `upload.single('screenshot')` then `uploadAttachments.array('files', N)` on `POST /:ticketId/comments`. Multer runs once per invocation; having two instances processes two separate field names — this is supported by Express middleware chaining but requires careful testing to confirm `req.file` and `req.files` are both populated correctly.

**`express.static` ordering:** `express.static` must be placed before route handlers in `app.ts` but after security middleware (helmet, cors). If placed too early it bypasses rate limiting; if too late it does nothing. Correct position: after `morgan` (so requests are logged) and before route definitions.

**Config mismatch — `localDir`:** `config.storage.localDir` defaults to `'public'`. The URL for a file stored at `public/2026-07-08/abc` will be `/2026-07-08/abc` (served by `express.static('public')`). Ensure `toAttachmentUrl()` returns `/${key}` for local, not `/uploads/${key}` (which is what `comment.service.ts` `toScreenshotUrl()` uses — that inconsistency is a pre-existing issue in the comments module and is out of scope for this plan).

**MIME allowlist in config vs. requirements:** `config.attachment.allowedMimeTypes` has many types by default. The new `uploadAttachments.ts` middleware hardcodes `['image/jpeg', 'image/png']` regardless of config, enforcing FR-13b. The existing `upload.ts` (screenshot for comments) is not changed.

**Breaking change to `TicketRow`:** adding `attachments: AttachmentRow[]` to `TicketRow` changes the type signature of `getTicketById()`. Any existing tests that assert on `getTicketById()` return type must be updated to include `attachments: []` or an actual array. Integration tests for tickets should be updated to check the `attachments` field is an array.

---

## Non-Negotiables Checklist

- [x] No `process.env` outside `src/config/index.ts` — `toAttachmentUrl()` reads only `config.*`
- [x] All SQL uses `$1, $2` placeholders — no string interpolation in any attachment queries
- [x] No `SELECT *` — all attachment queries name columns explicitly; `storage_key` is aliased internally and excluded from `AttachmentRow` before returning
- [x] SQL only in `attachment.service.ts` — not in controllers or routes
- [x] `success()`/`error()` from `src/utils/response.ts` only — ticket and comment controllers already comply; no new response helpers added
- [x] `next(err)` in every controller catch — ticket and comment controllers already comply; no new controllers are added
- [x] `return` after every `error()` call — existing controllers comply
- [x] TypeScript strict: no `any`, no unjustified `!` — multer file arrays typed as `Express.Multer.File[]`; `req.files` cast once in controller with explicit type
- [x] Unused params prefixed with `_` — storage `_mimeType`/`_sizeBytes` already prefixed in `local.ts`
- [x] Queue adds fire-and-forget — `uploadAttachments()` does not enqueue jobs; cache invalidation is already fire-and-forget in existing patterns

---

## Next Steps (ordered implementation sequence)

1. **Check and update `errorHandler.ts`** — add `MulterError` handling (`LIMIT_FILE_SIZE` → 400, `LIMIT_FILE_COUNT` → 400, `LIMIT_UNEXPECTED_FILE` → 400) if not already present
2. **Create `src/middlewares/uploadAttachments.ts`** — multer instance restricted to `image/jpeg`/`image/png`; `files` field name; size and count limits from config
3. **Create `src/modules/attachments/attachment.schemas.ts`** — `AttachmentRow` interface (no `storageKey`); `AttachmentDbRow` internal interface (includes `storageKey`); export both
4. **Create `src/modules/attachments/attachment.service.ts`** — `toAttachmentUrl()`, `uploadAttachments()`, `getAttachmentsByTicket()`, `getAttachmentsByComment()`
5. **Modify `src/modules/tickets/ticket.schemas.ts`** — extend `TicketRow` to include `attachments: AttachmentRow[]`; add import for `AttachmentRow`
6. **Modify `src/modules/tickets/ticket.service.ts`** — update `createTicket()`, `updateTicket()` signatures to accept optional `files`; update `getTicketById()` to fetch and merge attachments
7. **Modify `src/modules/tickets/ticket.controller.ts`** — pass `req.files` in `create` and `update` handlers
8. **Modify `src/modules/tickets/ticket.routes.ts`** — add `uploadAttachments.array(...)` middleware to `POST /` and `PATCH /:id`
9. **Modify `src/modules/comments/comment.schemas.ts`** — extend `CommentRow` to include `attachments: AttachmentRow[]`
10. **Modify `src/modules/comments/comment.service.ts`** — update `addComment()` to accept and process `attachmentFiles`; update `listComments()` and `getCommentById()` to aggregate inline attachments via LEFT JOIN + `json_agg`
11. **Modify `src/modules/comments/comment.controller.ts`** — pass `req.files` to `addComment()`
12. **Modify `src/modules/comments/comment.routes.ts`** — add `uploadAttachments.array('files', N)` to `POST /:ticketId/comments` route
13. **Modify `src/app.ts`** — add `app.use(express.static(config.storage.localDir))` after compression, before route definitions
14. **Run `npm run build`** — fix any TypeScript errors from changed interfaces
15. **Run `npm run lint:fix`** — fix lint warnings
16. **Write `src/modules/attachments/attachment.service.test.ts`** — unit tests for `uploadAttachments`, `getAttachmentsByTicket`, `getAttachmentsByComment` with mocked `query` and storage backend
17. **Write integration tests for TEST-9** — use `STORAGE_BACKEND=local` + `STORAGE_LOCAL_DIR=.tmp/test-uploads`; test allowed MIME → 201 with `url`, no `storageKey`; disallowed MIME → 415; oversize → 400; over-count → 400; `GET /api/v1/tickets/:id` inline `attachments` array; `GET /api/v1/tickets/:id/comments` per-comment `attachments`; agent without ticket access → 403; cleanup `afterAll`
