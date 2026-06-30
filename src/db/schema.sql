-- =============================================================================
-- Support Ticket Management — Schema Migration
-- Database: ttn_stm
-- Run via: npm run db:migrate
-- Idempotent: safe to re-run (all statements use IF NOT EXISTS / OR REPLACE)
-- =============================================================================

-- ─── ENUM Types ───────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('ADMIN', 'AGENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('ACTIVE', 'BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ─── Table: users ─────────────────────────────────────────────────────────────
-- Seeded only. No sign-up UI — admin/agent accounts are created by an admin.

CREATE TABLE IF NOT EXISTS users (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(255) NOT NULL,
  email          VARCHAR(255) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  role           user_role    NOT NULL DEFAULT 'AGENT',
  status         user_status  NOT NULL DEFAULT 'ACTIVE',
  last_logged_in TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Table: tickets ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tickets (
  id           UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  title        VARCHAR(500)    NOT NULL,
  description  TEXT,
  priority     ticket_priority NOT NULL DEFAULT 'MEDIUM',
  status       ticket_status   NOT NULL DEFAULT 'OPEN',
  assigned_to  UUID            REFERENCES users(id) ON DELETE SET NULL,
  created_by   UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ─── Table: comments ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS comments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  message     TEXT        NOT NULL,
  created_by  UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tickets_status      ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority    ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by  ON tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to ON tickets(assigned_to);

CREATE INDEX IF NOT EXISTS idx_comments_ticket_id  ON comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_by ON comments(created_by);

-- ─── Trigger: auto-update tickets.updated_at ──────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_set_updated_at ON tickets;
CREATE TRIGGER tickets_set_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

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
