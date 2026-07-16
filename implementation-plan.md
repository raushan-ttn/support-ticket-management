# Implementation Plan — Support Ticket Management (Backend API)

> Consolidated summary of the 11 phase/feature plans in `.claude/plans/` (kept there — they're
> read by `feature-planner`/`feature-implementer` by exact path when resuming or extending a
> module). This file gives the end-to-end build narrative in order; each row links to the full
> plan for file-level detail.

## Build Order & Status

| Phase | Plan | Scope | Status |
|---|---|---|---|
| 0 | [`backend-tooling.md`](.claude/plans/backend-tooling.md) | JS → TypeScript strict migration; ESLint flat config, Prettier, Husky + lint-staged | Done |
| 0 | [`backend-database.md`](.claude/plans/backend-database.md) | `pg.Pool` + ioredis singletons against global Docker Postgres/Redis; typed config layer; graceful shutdown | Done |
| 0 | [`phase-0-gaps.md`](.claude/plans/phase-0-gaps.md) | Closed gaps blocking later phases: `error()` missing a `code` param (ERR-1/3), no Jest/ts-jest/supertest infra yet | Done |
| 1 | [`backend-schema.md`](.claude/plans/backend-schema.md) | Initial `users`/`tickets`/`comments` DDL — **lowercase ENUMs, no `CANCELLED`/`URGENT`** (superseded by schema-alignment) | Superseded |
| 1 | [`schema-alignment.md`](.claude/plans/schema-alignment.md) | Reconcile schema with canonical requirements: uppercase ENUMs, add `CANCELLED`, `URGENT` replaces `critical`, drop `user` role | Done |
| 1 | [`phase-1-schema-alignment.md`](.claude/plans/phase-1-schema-alignment.md) | Remaining structural gaps: `assigned_to` NOT NULL, indexes, `attachments` table shape | Done |
| 2 | [`auth-validation-upload.md`](.claude/plans/auth-validation-upload.md) | Zod validation, Passport-local + Passport-JWT, bcrypt, global error handler, helmet/cors/compression/rate-limit | Done (see reconciliation note in the plan — no `/register` endpoint; users are seeded only per DM-1) |
| 4 | [`tickets-module.md`](.claude/plans/tickets-module.md) | Ticket CRUD, server-authoritative state machine, RBAC scoping in SQL, search/filter/pagination, Redis caching | Done |
| 5 | [`comments-module.md`](.claude/plans/comments-module.md) | Comment add/list with RBAC scoping, cache invalidation | Done (originally bundled BullMQ/auto-close — since removed, see Phase 7 below) |
| 6 | [`attachments-module.md`](.claude/plans/attachments-module.md) | `IStorageBackend` abstraction (local + S3), multipart upload, MIME/size validation, metadata-only Postgres rows | Done |
| 7 | [`notifications-email.md`](.claude/plans/notifications-email.md) | **Decision (2026-07-08):** direct, non-queued, fire-and-forget email calls — no BullMQ. Auto-close removed from scope entirely (would have needed a delayed-job queue) | Done |
| 9 | [`phase-9-tests.md`](.claude/plans/phase-9-tests.md) | Gap-closure over [`test-strategy.md`](test-strategy.md): factories, notification tests (TEST-7), attachment tests (TEST-9), middleware unit tests to 100% | Done — 123/123 tests green (`--runInBand`) |

## Narrative

The build proceeded in the order above, with two significant scope corrections along the way:

1. **Schema casing/shape** (`backend-schema.md` → `schema-alignment.md` → `phase-1-schema-alignment.md`): the first schema draft used lowercase ENUMs and a `critical` priority value inconsistent with the finalized requirements; two follow-up plans brought it into alignment before the tickets module could be built on top of it.
2. **Notifications/auto-close** (`comments-module.md` → `notifications-email.md`): the comments module was originally implemented with a BullMQ queue for both email delivery and a 48h auto-close-on-stale-reply job. On 2026-07-08 auto-close was dropped from scope entirely (it required a Redis-backed delayed job queue not otherwise needed), and email delivery was simplified to a direct fire-and-forget call. This left `src/config/queue.ts`, `src/jobs/queues.ts`, and the `autoCloseQueue`/`systemCloseTicket()` code as dead code, tracked for removal in `.claude/task.md` Phase 8.

A later chore branch (`chore/remove-screenshot-field`, 2026-07-09) also removed the legacy `tickets.screenshot`/`comments.screenshot` columns in favor of the unified `attachments` system built in Phase 6 — see the superseded-note headers in `tickets-module.md` and `comments-module.md`.

## Related Files
- `.claude/plans/*.md` — full file-level plans (kept in place; read by `feature-implementer`)
- `.claude/task.md` — the phase-by-phase checklist these plans map to
- `design-notes.md` — key decisions and risks pulled out of these same plans
- `pr-description.md` — the actual merged PRs each phase shipped as
