# Review Fixes — Support Ticket Management (Backend API)

> Action-item summary of fixes that came out of code review specifically. `code-review-notes.md`
> has the full narrative (finding → why it matters → resolution → commit) for each of these —
> this file is the condensed, fix-oriented index. Don't duplicate entries here without also
> logging the finding in `code-review-notes.md`.

| Date | Fix | Root finding | Commit |
|---|---|---|---|
| 2026-07-09 | Dropped `tickets.screenshot` / `comments.screenshot` columns | Two incompatible, unvalidated mechanisms (raw client URL vs. single-file upload) duplicated what the `attachments` system already did correctly, and `tickets.screenshot` bypassed the MIME/size allowlist entirely | `e4edffc` |
| 2026-06-29 | Resolved `storage_key` before returning comment list/detail responses | `listComments()`/`getCommentById()` leaked the raw internal `storage_key` instead of a resolved public URL — violates the "never return `storage_key`" rule in `db-conventions.md`/`security.md` | `d897875` |
| 2026-06-29 | Routed `MulterError` and `ZodError` handling through the shared `error()` helper with correct `code` field | Direct `res.json()` calls bypassed Non-Negotiable #5 (`success()`/`error()` only) and #7 (`return` after `error()`) — the exact bug class that causes "headers already sent" | `d897875` |
| 2026-06-29 | Normalized all ENUMs (`user_role`, `user_status`, `ticket_priority`, `ticket_status`) to uppercase; removed stray lowercase `user` role | A leftover `user` role value could pass a naive type check and slip past `requireRole()` without matching either real role, producing confusing 403s or silent fallthrough | `347c06b` |

## Fixes Bundled Into Feature PRs (not standalone review findings, but review-adjacent)

| Date | Fix | Source |
|---|---|---|
| 2026-07-09 | `GET /api/v1/tickets` (list) hardcoded `attachments: []` instead of fetching them — now uses the same `withAttachments()` helper as the single-ticket endpoint | `CHANGELOG.md` 2026-07-09 |
| 2026-07-09 | Local-storage attachment `url` was a bare relative path, not directly openable in a browser — added `APP_URL` config, made `toAttachmentUrl()` return an absolute URL | `CHANGELOG.md` 2026-07-09 |
| 2026-07-09 | Jest parallel workers collided on `users_email_key` against the shared test DB | Set `maxWorkers: 1` in Jest config (`feat/phase-9-tests`, PR #20) |

## Related Files
- `code-review-notes.md` — full narrative log these entries are condensed from
- `debugging-notes.md` — the distinct log of runtime bugs (vs. review-time findings)
- `CHANGELOG.md` — feature-level change history, source for the "bundled" fixes above
