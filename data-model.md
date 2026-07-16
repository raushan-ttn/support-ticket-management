# Data Model — Support Ticket Management (Backend API)

> Derived from `src/db/schema.sql` (kept in place — read by `npm run db:migrate`) as of the
> 2026-07-09 migration. See `.claude/requirements.md` §3 for the requirement-level spec (DM-*
> IDs) this schema implements.

## Entity-Relationship Overview

```
users (1) ──< tickets.created_by   (RESTRICT — can't delete a user who created tickets)
users (1) ──< tickets.assigned_to  (RESTRICT — can't delete a user who owns assignments)
users (1) ──< comments.created_by  (RESTRICT)
users (1) ──< attachments.uploaded_by (RESTRICT)

tickets (1) ──< comments.ticket_id     (CASCADE — deleting a ticket wipes its comments)
tickets (1) ──< attachments.ticket_id  (CASCADE — attachments always scoped to a ticket)
comments (1) ──< attachments.comment_id (SET NULL — nullable; null = ticket-level attachment)
```

## Tables

### `users` — seeded only, no registration API (DM-1/DM-2)

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK, `gen_random_uuid()` |
| `name` | VARCHAR(255) | NOT NULL |
| `email` | VARCHAR(255) | NOT NULL, UNIQUE |
| `password_hash` | VARCHAR(255) | NOT NULL — bcrypt, 12 rounds; **never** selected into a controller response |
| `role` | ENUM `user_role` (`ADMIN`, `AGENT`) | NOT NULL, default `AGENT` |
| `status` | ENUM `user_status` (`ACTIVE`, `BLOCKED`) | NOT NULL, default `ACTIVE` |
| `last_logged_in` | TIMESTAMPTZ | nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` |

### `tickets`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `title` | VARCHAR(500) | NOT NULL |
| `description` | TEXT | NOT NULL (patched to `''` for existing NULLs, then constrained — see migration history) |
| `priority` | ENUM `ticket_priority` (`LOW`, `MEDIUM`, `HIGH`, `URGENT`; **`CRITICAL` still exists in the DB type for backwards compatibility but is rejected at the Zod boundary**) | NOT NULL, default `MEDIUM` |
| `status` | ENUM `ticket_status` (`OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`, `CANCELLED`) | NOT NULL, default `OPEN` |
| `assigned_to` | UUID → `users.id` | **NOT NULL**, `ON DELETE RESTRICT` (DM-3: no ticket is ever "unassigned") |
| `created_by` | UUID → `users.id` | NOT NULL, `ON DELETE RESTRICT` |
| `type` | VARCHAR(100) | nullable, free-text, application-governed (DM-12) |
| `sub_type` | VARCHAR(100) | nullable, free-text, application-governed (DM-12) |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` |
| `updated_at` | TIMESTAMPTZ | NOT NULL, **trigger-maintained** (`set_updated_at()`) — never set by application code |

Indexes: `status`, `priority`, `created_by`, `assigned_to`, `type`, `sub_type`.

> **Removed 2026-07-09:** `screenshot` (TEXT) — a plain-URL string field, dropped in favor of
> the `attachments` table exclusively (DM-13).

### `comments`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `ticket_id` | UUID → `tickets.id` | NOT NULL, `ON DELETE CASCADE` |
| `message` | TEXT | NOT NULL |
| `created_by` | UUID → `users.id` | NOT NULL, `ON DELETE RESTRICT` |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` |

Index: `ticket_id`, `created_by`.

> **Removed 2026-07-09:** `screenshot` (TEXT) — same rationale as tickets (DM-13a).

### `attachments` — metadata only; bytes live in the storage backend (DM-8)

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `ticket_id` | UUID → `tickets.id` | NOT NULL, `ON DELETE CASCADE` — drives authorization (DM-9) |
| `comment_id` | UUID → `comments.id` | nullable, `ON DELETE SET NULL` — null = ticket-level attachment (DM-10) |
| `filename` | VARCHAR(255) | NOT NULL — sanitized original client filename |
| `storage_key` | TEXT | NOT NULL, **UNIQUE** — internal path/key; **never returned in any API response** |
| `mime_type` | VARCHAR(127) | NOT NULL |
| `size_bytes` | INTEGER | NOT NULL, `CHECK (size_bytes > 0)` |
| `uploaded_by` | UUID → `users.id` | NOT NULL, `ON DELETE RESTRICT` |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` |

Indexes: `ticket_id`, `comment_id`.

## ENUM Types

| Type | Values | Notes |
|---|---|---|
| `user_role` | `ADMIN`, `AGENT` | Two roles only — RBAC-1, no generic `user` role |
| `user_status` | `ACTIVE`, `BLOCKED` | |
| `ticket_priority` | `LOW`, `MEDIUM`, `HIGH`, `URGENT` (+ legacy `CRITICAL`, DB-only) | App code must only ever write/compare the 4 canonical values |
| `ticket_status` | `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`, `CANCELLED` | See the state machine in `.claude/requirements.md` §7 for legal transitions |

## Migration History (dated blocks in `schema.sql`)

1. **Initial** — `users`/`tickets`/`comments`, base ENUMs, indexes, `updated_at` trigger
2. **2026-06-29** — `URGENT` priority added, `CANCELLED` status added, `description` made
   NOT NULL, `assigned_to` made NOT NULL (with an orphan-ticket backfill to the first seeded
   admin), `attachments` table created
3. **2026-07-01** — `type`/`sub_type` added to tickets; `screenshot` added to tickets and comments
4. **2026-07-09** — `screenshot` dropped from both tables, superseded by `attachments`

## Related Files
- `src/db/schema.sql` — the actual, authoritative DDL (idempotent, append-only)
- `.claude/requirements.md` §3 — the requirement-level data model spec (DM-* IDs)
- `.claude/rules/db-conventions.md` — query/transaction/caching conventions for this schema
