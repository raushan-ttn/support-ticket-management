# Phase 1 Schema Alignment

> **Status:** Implemented
> **Branch:** auth_setup
> **Date:** 2026-06-29
> **Requirements:** DM-3, DM-4, DM-8, DM-9, DM-10, DM-11, SM-1, SM-3, RBAC-1, TS-3, §3.2, §3.4

---

## Overview

Phase 1 schema alignment is a pure DDL migration that closes five gaps between the initial schema shipped in Phase 0 and the data-model requirements in §3. No new API endpoints were introduced; all changes are confined to `src/db/schema.sql`. The migration is appended as a versioned block dated 2026-06-29 and is fully idempotent — it is safe to re-run `npm run db:migrate` against a database that already has some or all of these changes applied.

The gaps addressed fall into three categories: two ENUM extensions to bring the priority and status types in line with the state-machine and TypeScript union definitions; two NOT NULL promotions on `tickets.description` and `tickets.assigned_to` to honour the non-nullable contracts in §3.2 and DM-3; and the creation of the `attachments` table required by §3.4 (DM-8 through DM-11). Together, these changes unblock Phase 4 (Tickets Module), Phase 6 (Attachments Module), and the full state-machine implementation in Phase 9 (Tests).

`CRITICAL` is intentionally left in the `ticket_priority` Postgres ENUM. Postgres does not support dropping individual enum values, so the value is retained at the DB layer for safety. The application boundary — the TypeScript `TicketPriority` union and the Zod validation schema defined in Phase 4 — will be `'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'` with no `CRITICAL`, ensuring clients can never submit or receive that value through the API.

---

## Architecture

This feature introduces no new modules. The sole source change is an append to the existing DDL file.

| File | Role |
|------|------|
| `src/db/schema.sql` | Idempotent DDL — source of truth for all Postgres schema. A versioned migration block dated 2026-06-29 was appended at the bottom. |
| `src/db/migrate.ts` | Migration runner — executes `schema.sql` against the configured database. Unchanged; already handles idempotent re-runs. |

---

## API Endpoints

No new API endpoints were introduced by this migration. The schema changes underpin endpoints implemented in later phases (tickets, attachments).

---

## Data Model Changes

### Gap 1 — `URGENT` added to `ticket_priority` ENUM

Requirement §3.2 specifies `LOW | MEDIUM | HIGH | URGENT`. The initial schema only contained `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. `URGENT` is added; `CRITICAL` is left in place (cannot be dropped in Postgres — the guard is at the TypeScript/Zod layer in Phase 4).

```sql
ALTER TYPE ticket_priority ADD VALUE IF NOT EXISTS 'URGENT';
```

### Gap 2 — `CANCELLED` added to `ticket_status` ENUM (SM-1, SM-3)

The state machine (§7) defines `CANCELLED` as a terminal state reachable from `OPEN` and `IN_PROGRESS`. The initial schema only contained `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`.

```sql
ALTER TYPE ticket_status ADD VALUE IF NOT EXISTS 'CANCELLED';
```

After this migration the full `ticket_status` ENUM is:
`OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`, `CANCELLED`

### Gap 3 — `tickets.description` promoted to NOT NULL (§3.2)

§3.2 requires `description` to be NOT NULL and non-empty after trim. A NULL-patch guard runs first so the `ALTER` is idempotent on a populated database.

```sql
-- Patch any existing NULL rows before applying the constraint.
UPDATE tickets SET description = '' WHERE description IS NULL;
ALTER TABLE tickets ALTER COLUMN description SET NOT NULL;
```

### Gap 4 — `tickets.assigned_to` promoted to NOT NULL with ON DELETE RESTRICT (DM-3, DM-4)

DM-3 states `assignedTo` is non-nullable because a ticket is never in an unassigned state (FR-1 auto-assigns every ticket to the admin on creation). The original column was `REFERENCES users(id) ON DELETE SET NULL`, allowing orphaned rows. Four idempotent steps are applied:

```sql
-- Step 4a: Assign orphaned (NULL) rows to the first seeded ADMIN. No-op if none exist.
UPDATE tickets
  SET assigned_to = (
    SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at ASC LIMIT 1
  )
  WHERE assigned_to IS NULL;

-- Step 4b: Drop existing FK (auto-named by Postgres).
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_assigned_to_fkey;

-- Step 4c: Promote to NOT NULL.
ALTER TABLE tickets ALTER COLUMN assigned_to SET NOT NULL;

-- Step 4d: Re-add FK with ON DELETE RESTRICT (DO block prevents duplicate_object on re-run).
DO $$ BEGIN
  ALTER TABLE tickets
    ADD CONSTRAINT tickets_assigned_to_fkey
      FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

`ON DELETE RESTRICT` (not `CASCADE`) is intentional: losing the assignee reference must be an explicit operation, not a side-effect of deleting a user row.

### Gap 5 — `attachments` table created (§3.4, DM-8–DM-11)

Postgres stores attachment **metadata only**; binary bytes live in the storage backend (TS-9). Authorization on any attachment is exactly authorization on its parent ticket (`ticket_id` drives scoping — DM-9).

```sql
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

-- DM-11: Indexes to support listing without full scans.
CREATE INDEX IF NOT EXISTS idx_attachments_ticket_id  ON attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_attachments_comment_id ON attachments(comment_id);
```

**Column design notes:**

| Column | Constraint | Rationale |
|--------|-----------|-----------|
| `ticket_id` | NOT NULL, FK → tickets CASCADE | Authorization scope; deleting a ticket cascades to its attachments |
| `comment_id` | NULLABLE, FK → comments SET NULL | Attachment belongs to a ticket directly, or optionally to one comment on that ticket (DM-10) |
| `storage_key` | TEXT NOT NULL UNIQUE | Server-generated UUID-based path; UNIQUE prevents duplicate storage objects; never returned in API responses |
| `uploaded_by` | NOT NULL, FK → users RESTRICT | Must preserve uploader reference; deleting the user row is blocked (not cascaded) |
| `size_bytes` | CHECK (size_bytes > 0) | Rejects zero-byte rows at the DB layer as a safety net |

---

## RBAC

This migration introduces no new RBAC rules. The `attachments` table schema is designed to support the access-control rules that Phase 6 will enforce:

| Action | ADMIN | AGENT | Future enforcement |
|--------|:-----:|:-----:|-------------------|
| Upload attachment | ✅ | ✅ (accessible ticket only) | `ticket_id` scope check in `attachment.service.ts` |
| List attachment metadata | ✅ | ✅ (accessible ticket only) | `ticket_id` scope check in `attachment.service.ts` |
| Download attachment | ✅ | ✅ (accessible ticket only) | `ticket_id` scope check in `attachment.service.ts` |
| Delete attachment | ✅ | ✅ (own uploads only) | SQL `WHERE uploaded_by = $1 OR role = 'ADMIN'` in Phase 6 |

---

## State Machine (tickets.status)

This migration enables the full state machine defined in §7 by adding `CANCELLED` to the `ticket_status` ENUM. The authoritative transition set (enforced in Phase 4 `ticket.service.ts`) is:

```
OPEN         -> IN_PROGRESS
IN_PROGRESS  -> RESOLVED
RESOLVED     -> CLOSED
OPEN         -> CANCELLED
IN_PROGRESS  -> CANCELLED
```

`CLOSED` and `CANCELLED` are terminal states (SM-3): no outgoing transitions. Illegal transitions will return `409 INVALID_STATUS_TRANSITION` once the transition-validation logic is implemented in Phase 4.

Additionally, SM-6 defined a **system-only** privileged transition `{OPEN, IN_PROGRESS} -> CLOSED` for the auto-close background job (formerly FR-12). **Removed 2026-07-08:** auto-close was dropped from scope (required a BullMQ delayed-job queue not part of this implementation — `requirements.md` §1.2). `systemCloseTicket()` in `ticket.service.ts` still implements this transition but is dead code pending removal (`task.md` Phase 8).

---

## Caching

No caching changes were introduced. The `attachments` metadata listing key (`ticket:{id}:attachments`) is defined in `db-conventions.md` and will be implemented in Phase 6. Per CACHE-9, attachment binary bytes are never cached in Redis.

---

## Background Jobs

No background jobs were added or modified by this migration.

---

## Environment Variables

No new environment variables introduced. The migration runs under the existing `PG_*` connection variables consumed by `src/config/index.ts`.

---

## Testing

### How to run

```bash
# Apply migration to the development database
npm run db:migrate

# Apply to a fresh database (migrate + seed)
npm run db:setup

# Verify the test database has the schema applied
NODE_ENV=test npm run db:migrate
```

### Schema idempotency verification

The migration block uses guards throughout:
- `ALTER TYPE ... ADD VALUE IF NOT EXISTS` — ENUM additions
- `UPDATE ... WHERE ... IS NULL` — NULL-patch before NOT NULL promotion
- `ALTER TABLE ... DROP CONSTRAINT IF EXISTS` — FK removal before re-add
- `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` — FK re-add
- `CREATE TABLE IF NOT EXISTS` — table creation
- `CREATE INDEX IF NOT EXISTS` — index creation

Re-running `npm run db:migrate` against a fully-migrated database produces no errors and makes no changes.

### Test coverage

Integration tests covering the schema-dependent behaviour live in Phase 9:

| Test requirement | What it validates |
|-----------------|-------------------|
| TEST-1 | All five valid state-machine transitions succeed; representative invalid transitions return `409` — requires `CANCELLED` in the ENUM (Gap 2) |
| TEST-2 | Ticket creation auto-assigns to admin with `OPEN` — requires `assigned_to NOT NULL` (Gap 4) and `description NOT NULL` (Gap 3) |
| TEST-9 | Attachment upload, list, download, delete — requires the `attachments` table (Gap 5) |

---

## Known Limitations / Future Work

- **`CRITICAL` remains in the Postgres ENUM.** Postgres does not support dropping ENUM values. The value is suppressed at the application boundary via the TypeScript `TicketPriority` union (`'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'`) and the Zod validation schema in Phase 4. Any direct SQL query that reads or compares `priority` against a hard-coded set must not include `CRITICAL` in the permitted set.
- **`description` NULL-patch uses an empty string.** Existing rows with a NULL description are patched to `''` before the NOT NULL constraint is applied. An empty string technically satisfies NOT NULL but not the application-layer `min(1)` trim validation. This is an acceptable data-hygiene trade-off for a dev/test database; production databases are expected to have no such rows.
- **`storage_key` uniqueness is enforced at the DB layer only.** Phase 6 (`attachment.service.ts`) must generate UUID-based storage keys server-side to honour this constraint and FR-13c. Clients have no influence over storage key values.
- **`comment_id` cross-ticket validation (DM-10) is not a DB constraint.** Ensuring a given `comment_id` belongs to the same `ticket_id` is a business-logic check that must be implemented in `attachment.service.ts` in Phase 6 — the schema alone cannot enforce it.
