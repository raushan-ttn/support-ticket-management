# Reflection

Retrospective on AI-assisted development across this project's lifecycle. Unlike `tool-workflow.md` (the process we follow) or the two notes logs (dated incident records), this is the honest "how did it actually go" — updated at major milestones, not after every commit.

**Last updated:** 2026-07-09, after Phase 9 (full test suite) and Phase 10 (bug fixes / screenshot removal).

## What was built

A ten-phase backend build: infra/tooling → schema → auth → tickets → comments → attachments/storage → notifications → Swagger docs → a 100%-middleware / ~90%-service coverage test suite → a round of bug fixes and a schema cleanup CR. A React/Next.js frontend was scaffolded early (`fe_nextjs_setup`, commit `691b77c`) and later deliberately split out to a separate repo (`471adb6`) to keep this repo backend-only — see `CLAUDE.md`.

## How AI was used

Not ad hoc prompting — a defined agent pipeline (`.claude/agents/`): `requirement-fetcher → feature-planner → feature-implementer → code-reviewer → docs-updater`, orchestrated by `/build-feature` with human checkpoints after planning and after implementation. `code-reviewer` also runs automatically on every `.ts`/`.js` edit via a `PostToolUse` hook. Full detail in `tool-workflow.md`.

## What worked well

- **Convention adherence at scale.** `CLAUDE.md` Non-Negotiables + `.claude/rules/*.md` meant ten phases of AI-generated code stayed structurally consistent (layering, response envelope, SQL parameterization) without re-explaining the stack every session — verified by the fact that `code-review-notes.md` has zero entries for layering or SQL-injection violations, only genuine logic/data-leak findings.
- **Plan-first on non-trivial features.** Every module (`tickets-module.md`, `comments-module.md`, `attachments-module.md`, `notifications-email.md`) has a saved plan with a Risks section — the BullMQ removal (below) was a case where writing the plan surfaced the scope question before code was written, not after.
- **Test generation kept pace with implementation.** Phase 9 alone added 5 new test suites (187 total passing tests) with real edge-case coverage (MulterError mapping, ZodError, production stack masking) rather than happy-path-only tests.

## What AI got wrong / had to be corrected

Every entry below has a full write-up in `debugging-notes.md` or `code-review-notes.md`:

- **Unsafe role casting instead of validation** — an unchecked `.toUpperCase()` on the role from Passport would have silently accepted an unrecognized role string rather than rejecting it. Caught and replaced with an explicit `normaliseRole()` that throws on the unexpected case.
- **`storage_key` leaking through comment responses** — a direct violation of a Non-Negotiable (`db-conventions.md` Sensitive Columns) that a naive "does the feature work" check wouldn't surface, since the happy path still returned *a* URL, just the wrong one.
- **Copy-paste code path divergence** — `listTickets()` hardcoded `attachments: []` instead of reusing `withAttachments()`, so list and detail responses silently disagreed. This is the recurring failure mode to watch for: near-duplicate code paths (list vs. detail, ticket vs. comment) drift unless one explicitly calls the other's helper.
- **Chaining two multer instances on one route** — a structural misunderstanding of how the multipart stream is consumed, not caught until a test with both fields populated failed.

## What was deliberately overridden

- **Dropped BullMQ entirely** (`e8ac68d`) — the plan initially scaffolded a queue for auto-close-on-stale-reply; on review this required a Redis-backed delayed job for a feature explicitly out of scope (`requirements.md` §1.2), so the queue and its scaffolding were removed rather than left half-wired. Direct fire-and-forget email sends replaced it.
- **Removed the `screenshot` columns/fields** (Phase 10 CR) — once `attachments` (Phase 6) covered the same need with proper validation and multi-file support, keeping the older unvalidated single-field mechanism around was a liability, not a compatibility nicety. Marked as a breaking change rather than deprecated-but-kept.
- **Frontend split to a separate repo** — keeps this repo's `CLAUDE.md`/rules backend-only and avoids the two stacks' conventions bleeding into each other.

## How AI output was validated

Never trusted on the strength of "it compiles." Layered gate: `tsc --noEmit` (hooked on every edit) → ESLint → Prettier → Husky pre-commit → Jest (`--runInBand`, since parallel workers hit `users_email_key` collisions sharing one test DB — see the Phase 10 acceptance-criteria note in `.claude/task.md`) → manual Non-Negotiables checklist (`tool-workflow.md` §6) → `code-reviewer` hook → human PR review.

## Open items / what's next

- The Jest parallel-worker DB contention is mitigated (`maxWorkers: 1`) but not eliminated by design (e.g. per-worker schema) — fine at current suite size, worth revisiting if the suite grows much larger.
- This documentation set itself (`api-contract.md`, `debugging-notes.md`, `code-review-notes.md`, this file, `final-ai-usage-summary.md`) was added retroactively rather than grown alongside each phase — going forward, log entries as findings happen rather than backfilling from `CHANGELOG.md`.
