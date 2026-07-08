# Schema Alignment — Requirements Reconciliation

## Problem

The existing `schema.sql` (from `backend-schema.md`) was drafted before the full requirements
document was finalized. Several fields diverge from the canonical requirements:

1. **ENUM casing** — requirements (§3) mandate uppercase snake-case values (`OPEN`, `ADMIN`, etc.);
   current schema uses lowercase (`open`, `admin`).
2. **Missing `CANCELLED` status** — requirements define five ticket statuses; schema only has four.
3. **Wrong priority value** — requirements use `URGENT`; schema has `critical`.
4. **`user` role** — requirements define exactly two roles: `ADMIN` and `AGENT`; schema has a third `user`.
5. **`assigned_to` nullability** — requirements (DM-3) say `assignedTo` is NOT NULL (auto-assigned on
   create); schema has `ON DELETE SET NULL` making it nullable.
6. **`description` nullability** — requirements (§3.2) say NOT NULL; schema allows NULL.
7. **Missing `attachments` table** — requirements (§3.4) require a full attachment metadata table.

---

## Approach

Append a **versioned migration block** to `schema.sql` (with a date comment per database.md rules).
Each `ALTER` is idempotent where Postgres supports it; `IF NOT EXISTS` guards new objects.

> **Never rename existing ENUMs or drop/recreate** — use `ALTER TYPE ... ADD VALUE` for new values
> and a separate column rename migration with `ALTER TABLE ... RENAME COLUMN` for name changes.
> If changing from lowercase to uppercase values, add new values and migrate in two steps.

---

## Files Changed

```
src/db/schema.sql          ← append versioned block (2026-06-24)
src/config/index.ts        ← add: smtp, queue, storage, attachment-limit config sections
.sample.env                ← add: SMTP_*, QUEUE_*, STORAGE_*, ATTACHMENT_* vars
```

---

## Migration Steps (append to schema.sql)

### Step 1 — Add missing ENUM values

```sql
-- 2026-06-24: align ENUMs with requirements
DO $$ BEGIN
  ALTER TYPE ticket_status  ADD VALUE IF NOT EXISTS 'CANCELLED';
  ALTER TYPE ticket_status  ADD VALUE IF NOT EXISTS 'OPEN';
  ALTER TYPE ticket_status  ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
  ALTER TYPE ticket_status  ADD VALUE IF NOT EXISTS 'RESOLVED';
  ALTER TYPE ticket_status  ADD VALUE IF NOT EXISTS 'CLOSED';
  ALTER TYPE ticket_priority ADD VALUE IF NOT EXISTS 'URGENT';
  ALTER TYPE user_role       ADD VALUE IF NOT EXISTS 'AGENT';
  ALTER TYPE user_role       ADD VALUE IF NOT EXISTS 'ADMIN';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

> **Note:** Postgres ENUM `ADD VALUE` is not transactional — it cannot be rolled back. Run in a
> dedicated migration step. New uppercase values coexist with old lowercase values during the
> transition; application code should write uppercase going forward.

### Step 2 — Migrate existing rows to uppercase ENUM values

A one-time data migration must be run before old lowercase values are retired:

```sql
UPDATE users   SET role     = UPPER(role::text)::user_role   WHERE role::text != UPPER(role::text);
UPDATE tickets SET status   = UPPER(status::text)::ticket_status     WHERE status::text != UPPER(status::text);
UPDATE tickets SET priority = UPPER(priority::text)::ticket_priority WHERE priority::text != UPPER(priority::text);
```

### Step 3 — Fix `assigned_to` to NOT NULL

```sql
-- Requires all tickets to have an assigned_to before applying NOT NULL
-- Run data fix first: UPDATE tickets SET assigned_to = <admin_id> WHERE assigned_to IS NULL;
ALTER TABLE tickets
  DROP CONSTRAINT IF EXISTS tickets_assigned_to_fkey,
  ALTER COLUMN assigned_to SET NOT NULL,
  ADD CONSTRAINT tickets_assigned_to_fkey
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE RESTRICT;
```

### Step 4 — Fix `description` to NOT NULL

```sql
-- Requires all existing NULL descriptions to be patched first
UPDATE tickets SET description = '' WHERE description IS NULL;
ALTER TABLE tickets ALTER COLUMN description SET NOT NULL;
```

### Step 5 — Create `attachments` table

```sql
CREATE TABLE IF NOT EXISTS attachments (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID          NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  comment_id   UUID          REFERENCES comments(id) ON DELETE SET NULL,
  filename     VARCHAR(500)  NOT NULL,
  storage_key  VARCHAR(1000) NOT NULL,
  mime_type    VARCHAR(255)  NOT NULL,
  size_bytes   INTEGER       NOT NULL CHECK (size_bytes > 0),
  uploaded_by  UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_ticket_id  ON attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_attachments_comment_id ON attachments(comment_id);
```

---

## New Config Sections (`src/config/index.ts`)

### SMTP (for direct, non-queued email notifications — see `notifications-email.md`)

| Variable | Default | Notes |
|----------|---------|-------|
| `SMTP_HOST` | `localhost` | |
| `SMTP_PORT` | `1025` | Mailhog default for dev |
| `SMTP_USER` | _(empty)_ | |
| `SMTP_PASS` | _(empty)_ | |
| `SMTP_FROM` | `noreply@ttn.com` | |
| `SMTP_SECURE` | `false` | `true` for TLS in prod |

### Queue — removed 2026-07-08 (BullMQ no longer used)

| Variable | Default | Notes |
|----------|---------|-------|
| `QUEUE_CONCURRENCY` | `5` | **Unused** — worker concurrency for a BullMQ worker that was never built; no queue is used |
| `QUEUE_ATTEMPTS` | `3` | **Unused** — retry attempts per job; direct email calls have no retry |
| `QUEUE_BACKOFF_MS` | `5000` | **Unused** — exponential backoff base; not applicable without a queue |

These three should be removed from `src/config/index.ts` and `.sample.env` as part of the Phase 7/8 cleanup (`task.md`).

### Storage (attachment backend)

| Variable | Default | Notes |
|----------|---------|-------|
| `STORAGE_BACKEND` | `local` | `local` or `s3` |
| `STORAGE_LOCAL_DIR` | `uploads/` | Relative to project root |
| `S3_BUCKET` | _(required if s3)_ | |
| `S3_REGION` | `us-east-1` | |
| `S3_ACCESS_KEY_ID` | _(required if s3)_ | |
| `S3_SECRET_ACCESS_KEY` | _(required if s3)_ | |
| `S3_ENDPOINT` | _(optional)_ | MinIO / custom S3-compatible endpoint |

### Attachment Limits

| Variable | Default | Notes |
|----------|---------|-------|
| `ATTACHMENT_MAX_SIZE_BYTES` | `10485760` | 10 MB per file |
| `ATTACHMENT_MAX_COUNT` | `5` | Files per request |
| `ATTACHMENT_ALLOWED_TYPES` | `image/jpeg,image/png,image/gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document` | CSV of allowed MIME types |

### Default Admin (for auto-assignment)

| Variable | Default | Notes |
|----------|---------|-------|
| `DEFAULT_ADMIN_EMAIL` | `admin@ttn.com` | Resolved at startup; cached in memory |

---

## TypeScript Type Changes

- `UserRole`: `type UserRole = 'ADMIN' | 'AGENT'` (remove `'user'`)
- `TicketStatus`: `type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'CANCELLED'`
- `TicketPriority`: `type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'`

---

## Risks

- **Existing data** — the test DB `ttn_stm_test` and dev DB `ttn_stm` have lowercase values; the
  data migration (Step 2) must run before application code is updated to write uppercase values.
- **`assigned_to` NOT NULL** — any existing ticket with a NULL `assigned_to` blocks Step 3. Run
  `db:seed` to ensure an admin exists, then patch tickets before altering the column.
- **`CANCELLED` / `URGENT` ENUM adds are non-transactional** — on failure, the value may or may not
  have been added; the migration script must be idempotent (`IF NOT EXISTS`).
- **Old lowercase values** — application code must consistently write and compare uppercase values
  once the migration runs; mixing cases in queries will cause silent mismatches.

---

## Next Steps

- [ ] Append migration block to `src/db/schema.sql`
- [ ] Add new config sections to `src/config/index.ts` and `.sample.env`
- [ ] Update TypeScript union types (`UserRole`, `TicketStatus`, `TicketPriority`)
- [ ] Run migration against `ttn_stm` and `ttn_stm_test`
- [ ] Verify existing seed and auth module still work with uppercase ENUM values
