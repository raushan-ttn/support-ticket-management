# Design Notes — Support Ticket Management (Backend API)

> Key decisions and risks pulled from the "Key Decisions" / "Risks" / "Decision Log" sections
> scattered across `.claude/plans/*.md`. Grouped by theme rather than by phase — see
> `implementation-plan.md` for the phase-ordered narrative.

## Infrastructure Decisions

- **`pg` over an ORM (Sequelize/TypeORM)** — raw SQL via a thin `query()` wrapper keeps the
  connection layer minimal; an ORM can sit on top later without touching call sites.
- **`ioredis` over `redis` (node-redis)** — better TypeScript support, built-in retry logic.
  `lazyConnect: true` so the client is constructed at module load but only connects when
  `bootstrap()` calls `connectRedis()`, keeping startup order explicit.
- **`keyPrefix: 'stm:'`** auto-prepended by ioredis — service code never manually namespaces keys.
- **Shared singleton `pool`/`redis`** — both are module-level singletons; every import gets the
  same instance. No service file may construct a second `Pool` or ioredis client.
- **ESLint flat config, `@types/express@4`** — ESLint v10 dropped `.eslintrc.*` support;
  `@express@5` types were rejected because they infer `req.params.id` as `string | string[]`
  under strict mode, which the codebase doesn't want.

## Schema Decisions

- **UUID PKs via `gen_random_uuid()`** — no extension needed on Postgres 13+, better for
  distributed inserts than sequential integers.
- **ENUM types over CHECK constraints** — self-documenting, DB-enforced, extendable via
  `ALTER TYPE ... ADD VALUE IF NOT EXISTS` (never drop/recreate).
- **FK delete behavior is deliberately asymmetric**: `assigned_to` is `ON DELETE SET NULL`
  (deleting an agent un-assigns their tickets), `created_by` is `ON DELETE RESTRICT` (can't
  delete a user who owns tickets — must reassign first), `comments.ticket_id` is
  `ON DELETE CASCADE` (comments have no standalone meaning without their ticket).
- **`updated_at` maintained by a DB trigger** — guarantees correctness regardless of which
  service layer performs the update; app code never sets it manually.
- **Idempotent migrations only** — `IF NOT EXISTS` + ENUM exception handling + conditional
  `DROP TRIGGER` means `db:migrate` is always safe to re-run without data loss.

## RBAC / Auth Decisions

- **Two roles only (`ADMIN`/`AGENT`)** — an early draft plan (`backend-tooling.md`,
  `backend-database.md`) mentioned a third `user` role; this was corrected during Phase 1
  schema alignment (RBAC-1) and is now enforced at the DB ENUM level, not just in application code.
- **No `/register` endpoint** — `auth-validation-upload.md` originally specified one, but
  DM-1 mandates users are seeded only; the shipped `auth.routes.ts` exposes only `POST /login`
  and `GET /me`.
- **Role casing reconciliation**: passport strategies cast roles with `.toUpperCase()` — safe
  both before and after the Phase 1 ENUM-casing migration, since applying it to an
  already-uppercase string is a no-op.

## Notification / Queue Decision (the big pivot)

- **Direct call, no BullMQ (2026-07-08).** Comments module (Phase 5) was originally built with
  a BullMQ queue for both email delivery and a 48h auto-close-on-stale-reply job. Both were
  removed: auto-close needed a Redis-backed delayed job queue that added scope without a hard
  requirement behind it; direct fire-and-forget calls satisfy NFR-8 (never block the request)
  without that complexity.
- **Ordering risk called out explicitly**: the plan warned that removing the old queue calls
  from `comment.service.ts` *before* wiring in the direct `sendCommentNotificationEmail()` call
  would silently stop comment notifications — cleanup and the new integration had to land together.
- **Dead code accepted as a known gap**: `src/config/queue.ts`, `src/jobs/queues.ts`,
  `systemCloseTicket()`, and the `autoCloseQueue` scheduling calls predate the decision and were
  tracked (not silently left) as a Phase 8 cleanup item in `.claude/task.md`.

## Attachments Decisions

- **Storage abstraction (`IStorageBackend`)** so local-FS (dev) and S3 (prod) are swappable via
  `STORAGE_BACKEND` without touching call sites (NFR-13).
- **`multer.memoryStorage()` accepted memory trade-off**: up to 5 files × 10 MB = 50 MB peak
  per request — deemed acceptable for expected load; size limits enforced at multer
  stream-level (not post-read) to cap worst-case exposure (NFR-12).
- **Partial upload failures are an accepted trade-off**: if file 2 of 3 fails to persist,
  files 1 and 3 still succeed; storage writes aren't transactional, so a partially-successful
  multi-file upload isn't rolled back — it's logged, not surfaced as a hard failure unless all
  files fail.
- **`storageKey` is never returned to clients** — only a derived, absolute `url` — this was
  tightened mid-project (2026-07-09 fix) when local URLs were found to be relative
  (`/uploads/…`) instead of absolute, which broke direct-open-in-browser behavior (TS-9, FR-13c).

## Cross-Cutting Risks Worth Remembering

| Risk | Where it surfaced | Mitigation |
|---|---|---|
| Concurrent status transitions | `tickets-module.md` | `SELECT ... FOR UPDATE` inside `withTransaction` (SM-4/SM-5) |
| `sortBy` / dynamic SQL injection via list filters | `tickets-module.md` | `sortBy` mapped through a column-name allowlist before use in `ORDER BY`; never interpolate raw input |
| ENUM `ADD VALUE` is non-transactional pre-PG12 | `phase-1-schema-alignment.md` | N/A on PG16, but additions are permanent — migrations kept idempotent via `IF NOT EXISTS` |
| `CRITICAL` priority value persists at the DB ENUM level even after being renamed to `URGENT` in the app | `phase-1-schema-alignment.md` | Enforced exclusively at the Zod boundary (`z.enum([...])`) — DB-level guard would require a values migration, deemed unnecessary |
| Jest parallel workers collide on `users_email_key` (shared test DB) | `phase-9-tests.md` (verification note in `.claude/task.md`) | Run with `--runInBand`; candidate fix is `maxWorkers: 1` or per-worker DB if CI flakiness appears |

## Related Files
- `implementation-plan.md` — phase-ordered build narrative these decisions map onto
- `.claude/plans/*.md` — full plans this file was extracted from
- `debugging-notes.md` / `code-review-notes.md` — issues caught *after* these decisions shipped
