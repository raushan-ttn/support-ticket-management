# Plan: Phase 1 — Database Schema Gap Closure

> **Requirements:** DM-3, DM-8, DM-9, DM-10, DM-11, SM-1, SM-3, §3.2, RBAC-1
> **Date:** 2026-06-29

## Problem

Five structural gaps remain between `src/db/schema.sql` and the canonical requirements. The
earlier commit `347c06b` already promoted all ENUM values to uppercase and removed the `USER`
role (DM-1, RBAC-1 — these are done and must be checked off in `task.md`). The five remaining
gaps block Phase 4 (Tickets), Phase 6 (Attachments), and Phase 8 (Auto-Close):

1. **DM-8 / §3.2 — `ticket_priority` missing `URGENT`:** The type contains `CRITICAL` but the
   requirements (§3.2, §12) specify `URGENT`. `CRITICAL` cannot be dropped from the Postgres type
   (db-conventions.md: never drop/recreate ENUMs), but `URGENT` must be added and the TypeScript
   union (`TicketPriority`) must use `URGENT` only. No existing TypeScript source file currently
   defines `TicketPriority` or references `CRITICAL` (confirmed by grep), so no TS changes are
   needed in this phase. The `tickets` module (Phase 4) will define the union without `CRITICAL`.
2. **SM-1 / SM-3 — `ticket_status` missing `CANCELLED`:** Only four values exist; the state
   machine requires five, including the terminal `CANCELLED` state.
3. **§3.2 — `tickets.description` nullable:** Requirements say NOT NULL, non-empty after trim.
4. **DM-3 — `tickets.assigned_to` nullable with `ON DELETE SET NULL`:** Requirements (DM-3) say
   the column is NOT NULL because a ticket is never in an unassigned state; the FK must use
   `ON DELETE RESTRICT` to prevent losing the assignee reference.
5. **DM-8–DM-11 — `attachments` table absent:** The full metadata table for §3.4 does not exist.

## Approach

Pure DDL migration — no new routes, controllers, services, or Zod schemas. Append a single
versioned migration block (dated 2026-06-29) to `src/db/schema.sql` per db-conventions.md:
"Future changes: append versioned blocks with a date comment at the bottom of schema.sql." Every
statement must be idempotent. `migrate.ts` runs the whole file via a single `client.query(sql)`
call in auto-commit mode (no explicit BEGIN/COMMIT), so each statement commits independently —
`ALTER TYPE ... ADD VALUE IF NOT EXISTS` runs safely in Postgres 16.

The FK replacement pattern for `assigned_to` uses `DROP CONSTRAINT IF EXISTS` followed by a
`DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` guard on the re-add, making
the sequence safe to re-run. The `UPDATE ... WHERE col IS NULL` guards for `description` and
`assigned_to` are no-ops on a clean DB and idempotent on subsequent runs.

## Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/db/schema.sql` | Modify | Append 2026-06-29 versioned migration block (5 gap-closure items) |
| `.claude/task.md` | Modify | Check off 2 already-done items; check off 6 newly-addressed items after migration runs |

## Schema Changes

Append the following block verbatim to the bottom of `src/db/schema.sql`. Do not touch any
existing lines above it.

```sql
-- =============================================================================
-- Migration 2026-06-29: gap closure for Phase 1 (5 pending items)
-- Requirements: DM-3, DM-8, DM-9, DM-10, DM-11, SM-1, SM-3, §3.2, RBAC-1
-- =============================================================================

-- Gap 1: Add URGENT to ticket_priority ENUM.
-- CRITICAL remains in the DB type for backwards compatibility.
-- The application TypeScript union (TicketPriority) must include URGENT and must NOT include CRITICAL.
ALTER TYPE ticket_priority ADD VALUE IF NOT EXISTS 'URGENT';

-- Gap 2: Add CANCELLED to ticket_status ENUM (SM-1, SM-3).
ALTER TYPE ticket_status ADD VALUE IF NOT EXISTS 'CANCELLED';

-- Gap 3: Make tickets.description NOT NULL (§3.2).
-- Patch any existing NULL rows before applying the constraint.
UPDATE tickets SET description = '' WHERE description IS NULL;
ALTER TABLE tickets ALTER COLUMN description SET NOT NULL;

-- Gap 4: Make tickets.assigned_to NOT NULL with ON DELETE RESTRICT (DM-3, DM-4).
-- Step 4a: Assign any orphaned (NULL) tickets to the first seeded ADMIN. No-op if none exist.
UPDATE tickets
  SET assigned_to = (
    SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at ASC LIMIT 1
  )
  WHERE assigned_to IS NULL;

-- Step 4b: Drop existing FK (auto-named tickets_assigned_to_fkey by Postgres; IF EXISTS is idempotent).
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_assigned_to_fkey;

-- Step 4c: Promote column to NOT NULL (idempotent — no error if already NOT NULL in Postgres).
ALTER TABLE tickets ALTER COLUMN assigned_to SET NOT NULL;

-- Step 4d: Re-add FK with ON DELETE RESTRICT (DO block guards against duplicate_object on re-run).
DO $$ BEGIN
  ALTER TABLE tickets
    ADD CONSTRAINT tickets_assigned_to_fkey
      FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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

## Zod Schemas

Not applicable — schema-only migration. No new request or response schemas are introduced.
The `TicketPriority` and `TicketStatus` TypeScript unions will be defined when the `tickets`
module is created (Phase 4):
- `TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'` — `CRITICAL` is intentionally excluded
- `TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'CANCELLED'`

## Business Logic (per endpoint)

Not applicable — no new endpoints or service functions.

## RBAC & Authorization

Not applicable — no new endpoints.

## State Machine (if applicable)

The migration adds `CANCELLED` to the `ticket_status` ENUM (Gap 2), enabling SM-3
(`CANCELLED` as a terminal state) and completing the SM-1 allowed-transition set:

```
OPEN         -> IN_PROGRESS
IN_PROGRESS  -> RESOLVED
RESOLVED     -> CLOSED
OPEN         -> CANCELLED
IN_PROGRESS  -> CANCELLED
```

The transition-enforcement logic lives in the tickets service (Phase 4, FR-5). This migration
only unlocks the ENUM value; no trigger or constraint enforces the state machine at the DB layer.

## Cache Strategy

Not applicable — no cache keys are introduced by this migration. The attachments table
introduced in Gap 5 will use `ticket:{id}:attachments` (TTL: `config.redis.ttlSeconds`),
invalidated on every upload and delete. That cache key is planned in the attachments module
(Phase 6) and is not wired here.

## Queue / Job Strategy (if applicable)

Not applicable.

## Error Cases

Not applicable for a schema migration. The migration script exits with code 1 on any Postgres
error via the existing `migrate().catch(...)` handler in `migrate.ts`.

One edge case to be aware of during manual recovery: if `UPDATE tickets SET assigned_to = ...`
returns no rows from the ADMIN subquery (i.e., db:seed has not been run yet), the `SET NOT NULL`
in Gap 4 step 4c will fail with a constraint violation if any ticket rows have a NULL
`assigned_to`. Resolution: always run `npm run db:seed` before `npm run db:migrate` on a fresh
database, or run seed and migrate together via `npm run db:setup`.

## Risks

**ENUM `ADD VALUE` is non-transactional in Postgres < 12.** We are on Postgres 16 so this is
safe, but the value addition is permanent — there is no rollback. If the migration is interrupted
after `ADD VALUE` and before later steps, subsequent re-runs are still idempotent because of
`IF NOT EXISTS`.

**`CRITICAL` persists in the DB type.** Any future agent inserting a row with
`priority = 'CRITICAL'` through a raw DB client would succeed at the Postgres layer. Application
code must guard this exclusively through the Zod schema (`z.enum(['LOW','MEDIUM','HIGH','URGENT'])`)
which rejects `CRITICAL` at the API boundary.

**FK replacement window.** Between `DROP CONSTRAINT IF EXISTS` and `ADD CONSTRAINT` in Gap 4
steps 4b/4d there is a short window with no referential integrity on `assigned_to`. Because
`migrate.ts` runs with a single client (no concurrent writers during migration), this window is
safe in practice.

**`assigned_to` NOT NULL with no admin rows.** If the `users` table is empty when the migration
runs, the `UPDATE` in Gap 4 step 4a will set `assigned_to = NULL` (the subquery returns nothing),
and step 4c will then fail because NULL values still exist. Always run `db:seed` before
`db:migrate` on a fresh database (or use `db:setup` which chains them).

**No breaking change for existing auth module.** The auth module queries only the `users` table
for `id`, `name`, `email`, `role`, `status`, `password_hash`. None of those columns are touched
by this migration.

## Non-Negotiables Checklist

- [x] No process.env outside src/config/index.ts — migration SQL contains no env reads
- [x] All SQL uses $1, $2 placeholders — no string interpolation — migration block uses no params
- [x] No SELECT * — the UPDATE subquery in Gap 4 selects `id` only
- [x] SQL only in *.service.ts — not applicable (this is DDL in schema.sql, not service code)
- [x] success()/error() from src/utils/response.ts only — not applicable (no HTTP handlers)
- [x] next(err) in every controller catch — not applicable (no controllers)
- [x] return after every error() call — not applicable
- [x] TypeScript strict: no any, no unjustified ! — no TypeScript changes in this migration
- [x] Unused params prefixed with _ — not applicable
- [x] Queue adds fire-and-forget (try/catch, never re-throw) — not applicable

## task.md Items to Check Off

The implementer must update `.claude/task.md` in two passes.

**Pass 1 — mark as already done (before running migration):**

Under `## Phase 1 — Database Schema & Seed`, within the "Schema alignment" sub-list:
- `[x] Migrate ENUM values to uppercase` — completed in commit `347c06b`
- `[x] Remove \`user\` role from \`user_role\` ENUM` — completed in commit `347c06b`;
  schema.sql already defines `user_role AS ENUM ('ADMIN', 'AGENT')` with no third value

**Pass 2 — mark as done after migration runs and tsc/lint pass:**
- `[x] Add \`CANCELLED\` to \`ticket_status\` ENUM` — Gap 2
- `[x] Replace \`critical\` with \`URGENT\` in \`ticket_priority\` ENUM` — Gap 1 (URGENT added; TS union deferred to Phase 4)
- `[x] Make \`tickets.assigned_to\` NOT NULL` — Gap 4
- `[x] Make \`tickets.description\` NOT NULL` — Gap 3
- `[x] Add \`attachments\` table` — Gap 5
- `[x] Add index on \`attachments.ticket_id\` (and \`comment_id\`)` — Gap 5 indexes

## Next Steps (ordered implementation sequence)

1. Append the SQL block from "Schema Changes" above to the bottom of `src/db/schema.sql`
2. Run `npm run db:setup` on a fresh database (seeds admin first, then migrates); on an
   already-seeded DB run `npm run db:migrate` directly
3. Verify in psql:
   - `\dT+ ticket_priority` — must list `LOW, MEDIUM, HIGH, CRITICAL, URGENT`
   - `\dT+ ticket_status` — must list `OPEN, IN_PROGRESS, RESOLVED, CLOSED, CANCELLED`
   - `\d tickets` — `description` and `assigned_to` both show `not null`; `assigned_to` FK shows `RESTRICT`
   - `\d attachments` — table exists with all 9 columns and the UNIQUE constraint on `storage_key`
   - `\di attachments*` — two indexes present: `idx_attachments_ticket_id`, `idx_attachments_comment_id`
4. Run `npx tsc --noEmit` — must produce zero errors (no TypeScript changes in this phase)
5. Run `npm run lint:fix` — must produce zero lint violations
6. Run `npm test` — existing auth module tests must continue to pass
7. Update `.claude/task.md` per the two-pass instructions above
8. Proceed to Phase 3 (Config Additions & Queue Setup) or Phase 4 (Tickets Module) per task.md
