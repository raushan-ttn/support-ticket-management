# Plan: Comments Module (Phase 5)

> **Requirements:** FR-8, FR-8a, FR-8b, FR-9, FR-9a, FR-11, FR-11a, FR-11b, DM-6, DM-7, DM-13, DM-13a, VAL-1, VAL-2, RBAC-3, RBAC-4, RBAC-6, CACHE-2, CACHE-5, CACHE-7, TEST-7
> **Date:** 2026-07-01
>
> **Superseded (2026-07-08):** This plan was executed as written, including the
> BullMQ queue/auto-close design described throughout (queue setup, `FR-12`/`SM-6`
> auto-close scheduling, `TEST-8`). That design has since been **removed from scope**
> — see `requirements.md` §1.2 and `.claude/plans/notifications-email.md`. The BullMQ
> queue setup and auto-close scheduling code this plan produced (`src/config/queue.ts`,
> `src/jobs/queues.ts`, the `autoCloseQueue`/`emailQueue` calls in
> `comment.service.ts`) is now **dead code pending removal** — tracked in `task.md`
> Phase 7/8. The rest of this document (schema, endpoints, RBAC, caching) remains
> accurate as historical record of what was built; only the queue/auto-close portions
> below are obsolete.
>
> **Further superseded (2026-07-09):** the `comments.screenshot` column and its
> single-file-upload handling (`toScreenshotUrl()`, `upload.single('screenshot')`,
> DM-13a) described throughout this plan have also been **removed** — comment file
> uploads now go exclusively through the `attachments` system (`files` field,
> shared `uploadAttachmentFiles` middleware), same as tickets. See `task.md` Phase 10
> and `requirements.md` DM-13a. `comment.middleware.ts` (created by this plan) has
> been deleted. Historical content below is left as-is for context.

---

## Problem

Implement the three comment endpoints on top of an existing `comments` table. Comments support an optional screenshot file (jpg/png only, stored via the configured storage backend) and drive two async side effects: an email notification to all ticket participants (FR-11) and a delayed auto-close job keyed by ticket (FR-12). RBAC scoping mirrors the tickets module — agents see only comments on tickets they are assigned to or created.

Stub files already exist in `src/modules/comments/` but have several correctness problems that must be remedied:
- `comment.schemas.ts` defines `screenshot` as a Zod URL field — wrong; per DM-13a, screenshot on comments is a file upload handled by multer, not a client-supplied URL.
- `comment.service.ts` passes `payload.screenshot` (a URL string) directly to the DB INSERT — wrong; the path must come from the storage backend after upload.
- `comment.service.ts` is missing `getCommentById()` (FR-9a), email notification queuing (FR-11), and auto-close job scheduling (FR-12).
- `comment.controller.ts` is missing the `getById` handler and file-upload handling.
- `comment.routes.ts` is missing the `GET /:ticketId/comments/:commentId` route and the `upload.single('screenshot')` middleware on the POST route.

All four files must be rewritten from scratch. Additionally, `src/jobs/queues.ts` and `src/config/queue.ts` must be created so that `comment.service.ts` can import and use the queues at build time. Phase 7 (Notifications) then creates the workers that consume from those queues.

---

## Approach

Follow the auth module as the pattern (`routes -> controller -> service -> schemas`). Reuse:
- `query()` from `src/config/postgres.ts`
- `getCache / setCache / deleteCache` from `src/config/redis.ts`
- `getStorageBackend / buildStorageKey` from `src/storage/index.ts`
- `upload` multer middleware from `src/middlewares/upload.ts`
- `authenticate` from `src/middlewares/authenticate.ts`
- `success() / error()` from `src/utils/response.ts`
- `uuidParam` from `src/utils/zodHelpers.ts`
- `validateBody` from `src/middlewares/validateBody.ts`
- `getTicketById` from `src/modules/tickets/ticket.service.ts` — enforces 404/403 scope on every comment access
- `config` from `src/config/index.ts` for `config.redis.ttlSeconds` and `config.queue.autoCloseDelayMs`

Screenshot handling: multer captures the file in `req.file` (memoryStorage buffer), the service receives `Express.Multer.File | undefined`, calls the storage backend to persist it, and stores the resulting storage key in `comments.screenshot`. This key is returned verbatim in responses.

Queue fire-and-forget: every `queue.add()` call is inside try/catch; errors are logged, never re-thrown.

---

## Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/modules/comments/comment.schemas.ts` | Rewrite | Zod schema (message only, no screenshot), `CommentRow` interface |
| `src/modules/comments/comment.service.ts` | Rewrite | Business logic — add/list/getById + cache + queue fire-and-forget |
| `src/modules/comments/comment.controller.ts` | Rewrite | Request parsing, file forwarding, service calls |
| `src/modules/comments/comment.routes.ts` | Rewrite | Three routes with multer + validateBody middleware |
| `src/config/queue.ts` | Create | BullMQ `ConnectionOptions` (dedicated ioredis connection) |
| `src/jobs/queues.ts` | Create | `emailQueue` and `autoCloseQueue` BullMQ Queue instances |
| `src/types/jobs.ts` | Create | TypeScript interfaces for queue job payloads |
| `src/db/schema.sql` | No change | `comments.screenshot TEXT` already added in migration 2026-07-01 |
| `src/app.ts` | No change | Already imports and mounts `commentsRouter` at `/api/v1/tickets` |

---

## Schema Changes

None required. Migration block dated 2026-07-01 already in `src/db/schema.sql`:

```sql
ALTER TABLE comments ADD COLUMN IF NOT EXISTS screenshot TEXT;
```

---

## Zod Schemas

**`createCommentSchema`** (validates text portion of multipart body after multer):
- `message`: string, trim, min(1) — required, non-empty after trim

Screenshot is NOT a Zod field. It lives in `req.file` (set by multer). Adding it to the schema would introduce URL validation on a binary upload field, which is wrong.

**`CommentRow`** response interface:
- `id: string`, `ticketId: string`, `message: string`, `screenshot: string | null`, `createdBy: string`, `createdByName: string`, `createdAt: string`

**`CreateCommentPayload`** — inferred from `createCommentSchema` via `z.infer`.

---

## Business Logic (per endpoint)

### `POST /api/v1/tickets/:ticketId/comments`

Middleware chain: `authenticate -> upload.single('screenshot') -> validateBody(createCommentSchema) -> controller.add`

Multer runs first (puts file in `req.file`, text in `req.body`), then `validateBody` validates `req.body.message`.

Service `addComment(ticketId, message, file, callerId, callerRole)`:
1. Call `getTicketById(ticketId, callerId, callerRole)` — captures `TicketRow` for queue payloads; throws 404/403
2. If `file` is defined: `buildStorageKey()` generates key, `backend.save(key, Readable.from(file.buffer), file.mimetype, file.size)` — hard failure if save throws; else `screenshotKey = null`
3. CTE INSERT: `WITH inserted AS (INSERT INTO comments (ticket_id, message, screenshot, created_by) VALUES ($1, $2, $3, $4) RETURNING ...) SELECT <COMMENT_SELECT> FROM inserted c JOIN users u ON u.id = c.created_by`
4. Guard: throw 500 if no row returned
5. `deleteCache('ticket:' + ticketId + ':comments')` in try/catch
6. Fire-and-forget block (single try/catch): enqueue `comment-notification` to `emailQueue`; schedule/cancel `auto-close:{ticketId}` on `autoCloseQueue`
7. Return `CommentRow`

Response: `201 Created`

### `GET /api/v1/tickets/:ticketId/comments`

Middleware chain: `authenticate -> controller.list`

Service `listComments(ticketId, callerId, callerRole)`:
1. `getTicketById` for scope gate (result discarded — use `_ticket`)
2. Cache read: `getCache<CommentRow[]>('ticket:' + ticketId + ':comments')` in try/catch
3. DB: `SELECT <COMMENT_SELECT> FROM comments c JOIN users u ON u.id = c.created_by WHERE c.ticket_id = $1 ORDER BY c.created_at ASC`
4. Cache write: `setCache(key, rows, config.redis.ttlSeconds)` in try/catch
5. Return `CommentRow[]`

Response: `200 OK`

### `GET /api/v1/tickets/:ticketId/comments/:commentId`

Middleware chain: `authenticate -> controller.getById`

Service `getCommentById(ticketId, commentId, callerId, callerRole)`:
1. `getTicketById` for scope gate (result discarded — use `_ticket`)
2. `SELECT <COMMENT_SELECT> FROM comments c JOIN users u ON u.id = c.created_by WHERE c.id = $1 AND c.ticket_id = $2`
3. No row: throw 404 with code `INVALID_COMMENT_REFERENCE`
4. Return `CommentRow`

Response: `200 OK`

---

## RBAC & Authorization

| Endpoint | ADMIN | AGENT | How scope is enforced |
|----------|:-----:|:-----:|----------------------|
| `POST /:ticketId/comments` | ✅ | ✅ (accessible tickets only) | `getTicketById` throws 403 if agent outside scope |
| `GET /:ticketId/comments` | ✅ | ✅ (accessible tickets only) | `getTicketById` throws 403 if agent outside scope |
| `GET /:ticketId/comments/:commentId` | ✅ | ✅ (accessible tickets only) | `getTicketById` throws 403 if agent outside scope |

No `requireRole` middleware needed. Scope filtering is in the SQL `WHERE` clause inside `ticket.service.getTicketById`.

---

## State Machine (Auto-Close, FR-12)

Fire-and-forget within `addComment`, inside one try/catch:

```
NON_TERMINAL = ['OPEN', 'IN_PROGRESS']

if (callerId === ticket.assignedTo && NON_TERMINAL.includes(ticket.status)):
  autoCloseQueue.add('auto-close', jobData, {
    delay: config.queue.autoCloseDelayMs,
    jobId: 'auto-close:' + ticketId,
    removeOnComplete: true, removeOnFail: false,
  })
  // BullMQ replaces existing job with same jobId (FR-12b reset)

else if (callerId === ticket.createdBy && NON_TERMINAL.includes(ticket.status)):
  autoCloseQueue.remove('auto-close:' + ticketId)
  // Cancels pending close (FR-12a); no-op if no job exists
```

If/else-if prevents the self-assigned edge case (assignee === creator) from both scheduling AND canceling.

---

## Cache Strategy

| Key | Content | TTL | Invalidated by |
|-----|---------|-----|----------------|
| `ticket:{ticketId}:comments` | `CommentRow[]` ordered `created_at ASC` | `config.redis.ttlSeconds` | `addComment` via `deleteCache` |
| `ticket:{ticketId}` | `TicketRow` (ticket service owns) | — | Not touched by comment service |

`getCommentById` does not use cache. All cache ops are in try/catch with `console.error` on failure.

---

## Queue / Job Strategy

**`src/config/queue.ts`:** exports `ConnectionOptions` for BullMQ from `config.redis.*`. Dedicated ioredis connection — NOT the shared `redis.ts` singleton.

**`src/jobs/queues.ts`:** exports `emailQueue` (Queue `'email'`) and `autoCloseQueue` (Queue `'auto-close'`), both with `{ removeOnComplete: 100, removeOnFail: 200 }` defaults.

**`src/types/jobs.ts`:** exports `CommentNotificationJobData`, `AutoCloseJobData`, `NewTicketJobData` interfaces.

`comment-notification` payload:
```ts
{
  ticketId: string;
  ticketTitle: string;
  commentMessage: string;
  commentAuthorId: string;
  creatorId: string;
  assigneeId: string;
  adminId: string;
  attachmentCount?: number;
  attachmentFilenames?: string[];
}
```

`auto-close` payload:
```ts
{
  ticketId: string;
  triggeringCommentId: string;
  assigneeId: string;
  creatorId: string;
  adminId: string;
}
```

`adminId` is fetched via `SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at ASC LIMIT 1` inside the fire-and-forget try/catch.

---

## Error Cases

| Scenario | HTTP | Code |
|----------|------|------|
| Ticket not found | 404 | `NOT_FOUND` |
| Agent outside ticket scope | 403 | `FORBIDDEN` |
| Missing or empty `message` | 400 | `VALIDATION_ERROR` |
| Non-UUID path param | 400 | `VALIDATION_ERROR` |
| Comment not found or wrong ticket | 404 | `INVALID_COMMENT_REFERENCE` |
| Screenshot has disallowed MIME | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| Screenshot exceeds size limit | 400 | (multer stream-level) |
| No authenticated user | 401 | — |
| Storage backend failure on save | 500 | — |

---

## Risks

1. **Screenshot key, not URL.** `comments.screenshot` stores the storage key (e.g. `2026-07-01/uuid`), not a URL. Local dev needs `express.static` on `config.storage.localDir` or a download endpoint. Accepted for Phase 5; add download route in Phase 6.

2. **Self-assigned ticket.** If `assignedTo === createdBy`, `if/else if` ensures the assignee branch (schedule auto-close) wins. FR-12c worker re-validation is the second line of defense.

3. **Discarded `getTicketById` return.** Use `const _ticket = await getTicketById(...)` in `listComments` and `getCommentById` — prefixed with `_` to satisfy `no-unused-vars`.

4. **`Queue.remove(jobId)` API versioning.** In some BullMQ v4+ releases, the version-safe form is `const j = await autoCloseQueue.getJob('auto-close:' + ticketId); await j?.remove()`. Implementer should verify the installed BullMQ version.

5. **Multer + `validateBody` ordering is critical.** `upload.single('screenshot')` must run before `validateBody(createCommentSchema)` in the route middleware chain. Reversing the order causes `validateBody` to see an empty body.

6. **`src/types/jobs.ts` must exist before compiling `comment.service.ts`.** Create it first (Step 1 in implementation sequence).

---

## Non-Negotiables Checklist

- [ ] No `process.env` outside `src/config/index.ts`
- [ ] All SQL uses `$1, $2, ...` placeholders — no string interpolation
- [ ] No `SELECT *` — `COMMENT_SELECT` constant names all columns explicitly; `password_hash` never selected
- [ ] SQL only in `comment.service.ts` — no queries in controller or routes
- [ ] `success()` / `error()` from `src/utils/response.ts` only — no raw `res.json()`
- [ ] `next(err)` in every controller `catch` block
- [ ] `return` after every `error()` call
- [ ] TypeScript strict — no `any`; `req.file` typed as `Express.Multer.File | undefined`; no `!` without proof
- [ ] Unused params prefixed with `_`
- [ ] Queue `add()` / `remove()` calls are fire-and-forget: wrapped in try/catch, errors logged, never re-thrown

---

## Next Steps (ordered implementation sequence)

1. Create `src/types/jobs.ts` — `CommentNotificationJobData`, `AutoCloseJobData`, `NewTicketJobData`
2. Create `src/config/queue.ts` — BullMQ `ConnectionOptions`
3. Create `src/jobs/queues.ts` — `emailQueue` and `autoCloseQueue` exports
4. Rewrite `src/modules/comments/comment.schemas.ts`
5. Rewrite `src/modules/comments/comment.service.ts`
6. Rewrite `src/modules/comments/comment.controller.ts`
7. Rewrite `src/modules/comments/comment.routes.ts`
8. Verify `src/app.ts` mount (no change needed)
9. `npm run build` — confirm zero TypeScript errors
10. `npm run lint:fix`
11. Write `comment.service.test.ts` unit tests
12. Write `comment.controller.test.ts` integration tests
