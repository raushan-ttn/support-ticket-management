# Code Review Notes

A living log of findings actually caught during review — convention or security violations, not routine diffs. Distinct from `tool-workflow.md` §9, which documents the *review process* (checklist, prompts); this file is the *history* of what that process has caught. Findings feed back into `.claude/rules/` when they reveal a rule worth stating explicitly, and into the `code-reviewer` agent hook (`.claude/hooks/file-review.sh`) coverage.

Newest first.

---

## 2026-07-09 — Redundant `screenshot` columns vs. the `attachments` system

**Finding:** `tickets.screenshot` (a client-supplied URL string) and `comments.screenshot` (a single-file upload) predated the `attachments` table and served the same purpose — linking an image to a ticket/comment — through two incompatible, unvalidated mechanisms running in parallel with the metadata-only, pluggable-storage `attachments` design.

**Why it matters:** Two sources of truth for "does this ticket have an image" meant list/detail endpoints could disagree (see the same-day list-endpoint bug in `debugging-notes.md`), and `tickets.screenshot` accepted a raw client-supplied URL with no MIME/size validation — bypassing the upload allowlist entirely.

**Resolution:** Dropped both columns (`ALTER TABLE ... DROP COLUMN`); comment uploads now go through the same `files` field / `uploadAttachmentFiles` middleware as tickets. Marked a breaking change in `CHANGELOG.md`.

**Reference:** `CHANGELOG.md` 2026-07-09 §3; commit `e4edffc`.

---

## 2026-06-29 — `storage_key` leaking through comment list/detail responses

**Finding:** `listComments()`/`getCommentById()` returned the raw `storage_key` value in `screenshot`-related fields instead of a resolved public URL — the internal storage path was reaching the API response.

**Why it matters:** Direct violation of the "never return `storage_key`" rule (`.claude/rules/db-conventions.md` — Sensitive Columns; `.claude/rules/security.md` — File Uploads). `storage_key` is a server-generated, UUID-based internal path specifically chosen so clients can't reason about or manipulate storage layout; leaking it defeats that.

**Resolution:** Applied the existing `toScreenshotUrl()` resolver (already used elsewhere) to both read paths before the response is built.

**Reference:** commit `d897875`.

---

## 2026-06-29 — Inconsistent error-response construction (`MulterError`, `ZodError`)

**Finding:** `MulterError` codes weren't mapped to the `VALIDATION_ERROR` domain code, and the `ZodError` handler built its response with `res.json()` directly instead of the shared `error()` helper.

**Why it matters:** Two Non-Negotiables at once — #5 (`success()`/`error()` only, no raw `res.json()`) and consistent error codes per `.claude/rules/api-conventions.md`. Bypassing `error()` also skips the `return`-after-error discipline (Non-Negotiable #7), which is exactly the class of bug that causes "headers already sent" errors.

**Resolution:** Routed both paths through `error()` with the correct `code` field; centralized in `errorHandler.ts` rather than left to individual routes.

**Reference:** commit `d897875`.

---

## 2026-06-29 — Lowercase `user` role surviving in ENUM definitions

**Finding:** `user_role`, `user_status`, `ticket_priority`, and `ticket_status` Postgres ENUMs (and code references to them) still carried a leftover lowercase `user` role from an earlier draft of the permission model — the project settled on exactly two roles, `ADMIN` and `AGENT` (RBAC-1), with no generic `user`/`customer` role.

**Why it matters:** A stray recognized-looking role value is worse than a missing one — it can pass a naive `typeof role === 'string'` check and slip past `requireRole()` guards without matching either real role's permission set, producing confusing 403s or, worse, silently falling through an `if/else` that only handles `ADMIN`/`AGENT`.

**Resolution:** Normalized all four ENUMs to uppercase snake-case, removed the `user` value, and added `normaliseRole()` (see `debugging-notes.md` 2026-06-29) as a boundary guard that throws on any unrecognized role instead of coercing it.

**Reference:** commit `347c06b`.

---

## Adding a new entry

Append above, newest first: **Finding** (what the review caught) → **Why it matters** (which rule/consequence, cite `.claude/rules/*.md` where applicable) → **Resolution** (what changed) → **Reference** (commit SHA / CHANGELOG date). Log findings that reveal a real risk or convention gap — not routine style nits the linter already catches.
