# Debugging Notes

A living log of non-obvious bugs found and fixed during development — the *why*, which a commit diff or `CHANGELOG.md` entry doesn't capture on its own. See `.claude/workflow.md` §8 for the general AI-debugging process and the "common issues" pattern table this log feeds into.

Newest first.

---

## 2026-07-09 — Attachment `url` not directly openable (relative path)

**Symptom:** Attachment `url` values returned by the API worked for internal linking but didn't open directly in a browser for the local storage backend.

**Root cause:** `toAttachmentUrl()` in `attachment.service.ts` returned a bare relative path (`/{storageKey}`) for local storage. S3 URLs were already absolute, so the bug was backend-specific and easy to miss in an S3-only test pass.

**Fix:** Added `APP_URL` config var (`src/config/index.ts`, default `http://localhost:{PORT}`); `toAttachmentUrl()` now returns `${APP_URL}/${storageKey}` for local storage.

**Reference:** `CHANGELOG.md` 2026-07-09 §1; commit `e4edffc`.

---

## 2026-07-09 — `GET /api/v1/tickets` list endpoint missing attachments

**Symptom:** Ticket detail (`GET /:id`) included `attachments[]`; the list endpoint (`GET /`) returned `attachments: []` on every row regardless of actual uploads.

**Root cause:** `listTickets()` in `ticket.service.ts` hardcoded the empty array instead of calling the same `withAttachments()` helper used by `getById`/`create`/`update` — a copy-paste gap between two code paths that should have shared one.

**Fix:** `listTickets()` now maps every row through `withAttachments()`, matching detail-response shape.

**Reference:** `CHANGELOG.md` 2026-07-09 §1; commit `e4edffc`.

---

## 2026-06-29 — Broken multer chain on the comment upload route

**Symptom:** Comment creation with both a screenshot and general file attachments failed — only one of the two multipart fields was ever parsed.

**Root cause:** Two separate multer middleware instances were chained on the same route to handle two different form fields (`screenshot` and `files`). Multer consumes the multipart stream once; a second multer instance downstream sees an already-drained request and silently no-ops.

**Fix:** Replaced with a single `multer().fields([...])` call parsing both fields in one pass. (Later superseded entirely — see the 2026-07-09 screenshot-column removal in `code-review-notes.md`, which dropped the dual-field design in favor of a single `files` array.)

**Reference:** commit `61b9e73`.

---

## 2026-06-29 — Passport role comparisons failing despite correct DB data

**Symptom:** RBAC checks intermittently rejected valid `ADMIN` users.

**Root cause:** The `users.role` column stores values as written by Postgres (lowercase at the time), but `LocalUserRow`/`SafeUserRow` types and downstream comparisons assumed uppercase. The strategy papered over this with an unchecked `.toUpperCase()` cast, which meant an unrecognized role string (e.g. a stray `'user'`) would silently coerce to `'USER'` instead of failing loudly.

**Fix:** Added a `normaliseRole()` helper that explicitly maps known DB values to the `UserRole` union and throws `403` on anything unrecognized, instead of casting. Schema was later aligned to store uppercase directly (commit `347c06b`), making this the boundary-normalization layer rather than the primary defense.

**Reference:** `CHANGELOG.md` 2026-06-29 (Phase 0 Gaps); commit `9774836`.

---

## Adding a new entry

Append above, newest first: **Symptom** (what was observed) → **Root cause** (the actual mechanism, not just "fixed X") → **Fix** (what changed) → **Reference** (commit SHA / CHANGELOG date). Only log bugs where the root cause is non-obvious from the diff alone — routine typo fixes don't need an entry here.
