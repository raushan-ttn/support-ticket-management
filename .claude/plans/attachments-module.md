# Attachments Module — Upload, Download, Delete & Storage Abstraction

## Problem

The system must support file attachments on tickets (and optionally on specific comments). Metadata
lives in Postgres (`attachments` table — see `schema-alignment.md`). Actual bytes live in a
pluggable storage backend (local filesystem in dev, S3-compatible in prod). Multer handles
multipart parsing. Authorization on every attachment operation is exactly authorization on its
parent ticket (RBAC-3/4, DM-9).

---

## Approach

A thin **storage abstraction interface** (`IStorageBackend`) decouples call sites from the backend.
Two implementations: `LocalStorage` (dev/test) and `S3Storage` (prod). Selected via
`STORAGE_BACKEND` env var at startup.

Multer is configured with `memoryStorage()` (not disk) so bytes are available in `req.file.buffer`
before being streamed to the storage backend — this avoids writing temp files and allows proper
streaming with size enforcement.

**Attachment endpoints** are split into two routers:
- `tickets.routes.ts` — `POST /api/v1/tickets/:id/attachments` and `GET /api/v1/tickets/:id/attachments`
- `attachments.routes.ts` — `GET /api/v1/attachments/:attachmentId` and `DELETE /api/v1/attachments/:attachmentId`

---

## Packages

| Package | Type | Purpose |
|---------|------|---------|
| `multer` | dep | Already installed (see `auth-validation-upload.md`) |
| `@aws-sdk/client-s3` | dep | S3-compatible object storage client |
| `@aws-sdk/lib-storage` | dep | `Upload` helper for multipart S3 uploads |
| `sanitize-filename` | dep | Sanitize original client filename |
| `mime-types` | dep | MIME type lookup and validation |
| `@types/multer` | devDep | Already installed |
| `@types/sanitize-filename` | devDep | TypeScript types |
| `@types/mime-types` | devDep | TypeScript types |

---

## Files Created / Modified

```
src/
  storage/
    index.ts              ← IStorageBackend interface + factory function
    local.ts              ← LocalStorage: writes to STORAGE_LOCAL_DIR
    s3.ts                 ← S3Storage: uses @aws-sdk/lib-storage Upload
  modules/
    attachments/
      attachment.schemas.ts
      attachment.service.ts
      attachment.controller.ts
      attachment.routes.ts
  middlewares/
    upload.ts             ← MODIFIED: replace disk storage with memory storage;
                             add configurable MIME list + size limit from config

src/config/index.ts       ← add: storage + attachmentLimits config sections (schema-alignment.md)
src/app.ts                ← mount attachment router at /api/v1/attachments
```

---

## Storage Abstraction

### `src/storage/index.ts`

```ts
export interface StoredFile {
  storageKey: string;    // server-generated path/key — never client-supplied
  sizeBytes: number;
  mimeType: string;
}

export interface IStorageBackend {
  save(buffer: Buffer, mimeType: string, originalName: string): Promise<StoredFile>;
  stream(storageKey: string): Promise<NodeJS.ReadableStream>;
  delete(storageKey: string): Promise<void>;
}

export function createStorage(): IStorageBackend {
  if (config.storage.backend === 's3') return new S3Storage();
  return new LocalStorage();
}

export const storage = createStorage(); // singleton
```

### `src/storage/local.ts`

- `save`: generates `storageKey = uuid + ext`, writes buffer to `STORAGE_LOCAL_DIR/{storageKey}`.
- `stream`: returns `fs.createReadStream(path)`.
- `delete`: `fs.promises.unlink(path)`. Logs warning if file not found (tolerated — DM-8 note).

### `src/storage/s3.ts`

- `save`: uses `@aws-sdk/lib-storage` `Upload` with `ContentType` and `Key = uuid + ext`.
  Stream uploads from buffer — no full buffering in S3 SDK.
- `stream`: `GetObjectCommand` → returns `Body` as `NodeJS.ReadableStream`.
- `delete`: `DeleteObjectCommand`.

S3 client is configured from `config.storage.s3.*` (bucket, region, access key, secret, optional endpoint).

---

## Middleware — Updated `src/middlewares/upload.ts`

```ts
import multer from 'multer';
import { config } from '../config';

const allowedTypes = new Set(config.attachments.allowedMimeTypes);

export const upload = multer({
  storage: multer.memoryStorage(),    // buffer in memory, not temp file
  limits: {
    fileSize: config.attachments.maxSizeBytes,   // enforced during stream (NFR-12)
    files: config.attachments.maxCount,
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedTypes.has(file.mimetype)) {
      cb(new AppError(`File type ${file.mimetype} is not allowed`, 415));
    } else {
      cb(null, true);
    }
  },
});
```

`multer.memoryStorage()` enforces `fileSize` limit *during* the multipart stream — not after
fully reading (NFR-12). Files exceeding the limit are rejected with `MulterError(LIMIT_FILE_SIZE)`.

---

## Module Specifications

### `attachment.service.ts`

#### `uploadAttachments(ticketId, files, uploaderId, commentId?)`

1. Verify ticket exists and caller has access (same scope as `getTicketById`).
2. If `commentId` provided: verify comment belongs to same `ticketId` (DM-10).
3. Sanitize each filename: `sanitizeFilename(file.originalname)`.
4. For each file (in parallel):
   a. `storage.save(file.buffer, file.mimetype, sanitizedName)` → `StoredFile`.
   b. `INSERT INTO attachments (ticket_id, comment_id, filename, storage_key, mime_type, size_bytes, uploaded_by)`.
5. Invalidate cache `ticket:{ticketId}:attachments` on success.
6. On storage save failure: do not insert metadata row (no orphaned rows).

#### `listAttachments(ticketId, callerId, callerRole)`

1. Verify ticket access.
2. Cache read `ticket:{ticketId}:attachments` → return if hit.
3. `SELECT id, ticket_id, comment_id, filename, mime_type, size_bytes, uploaded_by, created_at FROM attachments WHERE ticket_id = $1 ORDER BY created_at ASC`.
4. Cache write.
5. **Never return `storage_key`** — it is internal; clients use the download endpoint.

#### `downloadAttachment(attachmentId, callerId, callerRole)`

1. `SELECT id, ticket_id, filename, storage_key, mime_type FROM attachments WHERE id = $1`.
2. Null → `404`.
3. Verify caller has access to `ticket_id` (same RBAC scope check).
4. `storage.stream(storageKey)` → returns `ReadableStream`.
5. Controller pipes stream directly to `res` with correct headers:
   - `Content-Type: {mime_type}`
   - `Content-Disposition: attachment; filename="{filename}"`
6. Stream is never fully buffered in memory (NFR-12).

#### `deleteAttachment(attachmentId, callerId, callerRole)`

1. `SELECT id, ticket_id, storage_key, uploaded_by FROM attachments WHERE id = $1`.
2. Null → `404`.
3. Caller must be `uploadedBy === callerId` OR `callerRole === 'ADMIN'` (else `403`).
4. `DELETE FROM attachments WHERE id = $1`.
5. `storage.delete(storageKey)` — if storage delete fails, log warning but do not re-insert the
   metadata row (bias: orphaned storage object is acceptable; orphaned metadata row pointing at
   missing bytes is not — FR-16).
6. Invalidate cache `ticket:{ticketId}:attachments`.

### `attachment.controller.ts`

```ts
export const upload: RequestHandler = async (req, res, next) => {
  try {
    const files = req.files as Express.Multer.File[];
    const data = await attachmentService.uploadAttachments(
      req.params.id, files, req.user!.id, req.body.commentId,
    );
    success(res, data, 201);
  } catch (err) { next(err); }
};

export const download: RequestHandler = async (req, res, next) => {
  try {
    const { stream, filename, mimeType } =
      await attachmentService.downloadAttachment(req.params.attachmentId, req.user!.id, req.user!.role);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    stream.pipe(res);
  } catch (err) { next(err); }
};
```

### `attachment.routes.ts`

```ts
// Mounted at /api/v1/attachments
router.get('/:attachmentId',    authenticate, controller.download);
router.delete('/:attachmentId', authenticate, controller.remove);
```

In `tickets.routes.ts`:

```ts
router.post('/:id/attachments', authenticate,
  upload.array('files', config.attachments.maxCount),
  attachmentController.upload);
router.get('/:id/attachments',  authenticate, attachmentController.list);
```

---

## Caching

| Operation | Cache action |
|-----------|-------------|
| `listAttachments` | Read/write `ticket:{ticketId}:attachments` |
| `uploadAttachments` | Invalidate `ticket:{ticketId}:attachments` |
| `deleteAttachment` | Invalidate `ticket:{ticketId}:attachments` |

Attachment bytes are **never** cached in Redis (CACHE-9).

---

## Error Codes

| Code | HTTP | Scenario |
|------|------|---------|
| `NOT_FOUND` | 404 | Attachment or parent ticket not found |
| `FORBIDDEN` | 403 | Caller lacks ticket access or is not uploader/admin |
| `INVALID_COMMENT_REFERENCE` | 400 | `commentId` doesn't belong to the ticket |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | File MIME type not in allowlist |
| `VALIDATION_ERROR` | 400 | File count or size limit exceeded |

---

## Risks

- **Memory pressure** — `memoryStorage()` holds file bytes in RAM until saved to storage. Enforce
  `maxSizeBytes` via multer's stream-level limit; add a process-level `--max-old-space-size` guard.
- **Partial upload failure** — if saving file 3 of 5 fails, files 1–2 are already in storage.
  Implement a cleanup sweep or accept the orphaned objects (logged). Do not return metadata rows
  for failed saves.
- **S3 credentials** — `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` must never be logged.
  The storage module must not log the full config object.
- **Filename sanitization** — `sanitize-filename` strips path traversal characters; also apply
  `path.basename()` as a defense-in-depth measure.
- **MIME spoofing** — validate `file.mimetype` from multer (from `Content-Type` header); optionally
  use `file-type` package to detect MIME from magic bytes for higher assurance.

---

## Next Steps

- [ ] `npm install @aws-sdk/client-s3 @aws-sdk/lib-storage sanitize-filename mime-types @types/sanitize-filename @types/mime-types`
- [ ] Create `src/storage/index.ts` (interface + factory)
- [ ] Create `src/storage/local.ts` and `src/storage/s3.ts`
- [ ] Update `src/middlewares/upload.ts` to use memory storage + config-driven limits
- [ ] Create `attachment.schemas.ts`, `attachment.service.ts`, `attachment.controller.ts`, `attachment.routes.ts`
- [ ] Mount attachment router in `src/app.ts`
- [ ] Integration tests: upload/list/download/delete (TEST-9)
