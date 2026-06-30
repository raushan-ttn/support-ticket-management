# Tickets Module

> **Status:** Implemented
> **Branch:** ticket_module
> **Date:** 2026-06-29
> **Requirements:** FR-1, FR-1a, FR-1b, FR-2, FR-2a, FR-3, FR-4, FR-4a, FR-5, FR-7, FR-7a, SM-1, SM-2, SM-3, SM-4, SM-5, SM-6, RBAC-1, RBAC-3, RBAC-4, RBAC-5, RBAC-6, CACHE-1, CACHE-5, CACHE-6, CACHE-7, CACHE-8, SF-1, SF-2, SF-3, SF-4, SF-5, VAL-1, VAL-2, VAL-3, VAL-4, VAL-5, DM-3, DM-4, DM-5, NFR-2, NFR-3, TEST-1, TEST-2, TEST-3, TEST-4, TEST-5, TEST-6

---

## Overview

The Tickets Module is the central domain of the Support Ticket Management system. It implements the full ticket lifecycle: creation with server-authoritative auto-assignment, RBAC-scoped listing and retrieval, field updates, status transitions through an enforced state machine, and admin-only reassignment.

Every new ticket is forced to `status = OPEN` and auto-assigned to the first seeded ADMIN user, regardless of any client-supplied values (FR-1, FR-1a). This guarantees that the admin queue always has visibility over incoming tickets and that no ticket enters the system in an unassigned or non-open state. The `assignedTo` column is `NOT NULL` by schema constraint (DM-3), reflecting this invariant at the database level.

RBAC access is enforced in two layers: the `requireRole('ADMIN')` middleware guards the assign endpoint at the route level (RBAC-5), while scope filtering for agents (viewing only tickets they created or are assigned to) is applied inside the SQL `WHERE` clause in the service layer — never by filtering an in-memory result set after a full query (SF-5, RBAC-6). The status state machine is evaluated inside a serializable `withTransaction` block with a `SELECT ... FOR UPDATE` row lock, preventing concurrent requests from producing illegal transitions (SM-4, SM-5, NFR-2, NFR-3). Redis caching accelerates single-ticket reads with graceful degradation when Redis is unavailable (CACHE-1, CACHE-7).

---

## Architecture

| File | Role |
|------|------|
| `src/modules/tickets/ticket.routes.ts` | Route definitions + middleware chain (`authenticate`, `requireRole`, `validateBody`, `validateQuery`) |
| `src/modules/tickets/ticket.controller.ts` | Request parsing + UUID param validation + service dispatch + `success()`/`next(err)` |
| `src/modules/tickets/ticket.service.ts` | Business logic, all SQL, Redis cache operations, state machine enforcement |
| `src/modules/tickets/ticket.schemas.ts` | Zod schemas, inferred payload types, `TicketRow` and `TicketListResult` response interfaces |

The module is mounted in `src/app.ts` at `/api/v1/tickets` before the global `errorHandler`.

---

## API Endpoints

### POST /api/v1/tickets

**Auth required:** Yes — ADMIN or AGENT
**Purpose:** Create a new ticket. The server forces `status = OPEN` and `assignedTo = first seeded ADMIN`, ignoring any client-supplied values for those fields. `createdBy` is taken from the verified JWT.

**Request body:**
```json
{
  "title": "string — required, 1–500 chars after trim",
  "description": "string — required, min 1 char after trim",
  "priority": "LOW | MEDIUM | HIGH | URGENT — optional, defaults to MEDIUM"
}
```

**Success response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Printer not working",
    "description": "The office printer on floor 3 is jammed.",
    "priority": "MEDIUM",
    "status": "OPEN",
    "assignedTo": "uuid-of-admin",
    "createdBy": "uuid-of-caller",
    "createdAt": "2026-06-29T10:00:00.000Z",
    "updatedAt": "2026-06-29T10:00:00.000Z"
  }
}
```

**Error cases:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing `title` or `description`; whitespace-only values; invalid `priority` enum value |
| 401 | — | Missing or invalid JWT |
| 500 | — | No ADMIN user found in the database to auto-assign |

---

### GET /api/v1/tickets

**Auth required:** Yes — ADMIN or AGENT
**Purpose:** List tickets with optional filters. ADMIN sees all tickets; AGENT sees only tickets where `assignedTo = callerId` OR `createdBy = callerId`. Scope is enforced in SQL before any filter is applied (SF-5).

**Query parameters:**
```
?status=OPEN
&priority=HIGH
&assignedTo=<uuid>
&search=<keyword>
&page=1
&limit=20
&sortBy=createdAt
&order=desc
```

All query parameters are optional. `page` and `limit` default to `1` and `20`. `sortBy` accepts `createdAt`, `updatedAt`, or `priority`. `order` accepts `asc` or `desc`.

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "tickets": [
      {
        "id": "uuid",
        "title": "string",
        "description": "string",
        "priority": "HIGH",
        "status": "OPEN",
        "assignedTo": "uuid",
        "createdBy": "uuid",
        "createdAt": "ISO8601",
        "updatedAt": "ISO8601"
      }
    ],
    "total": 42,
    "page": 1,
    "limit": 20
  }
}
```

**Error cases:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid `status` or `priority` enum value; invalid UUID for `assignedTo`; `limit` exceeds 100 |
| 401 | — | Missing or invalid JWT |

> List results are not cached. Due to per-caller RBAC scoping combined with dynamic filter parameters, a safe cache key cannot be constructed cheaply. Requests go directly to Postgres (CACHE-6).

---

### GET /api/v1/tickets/:id

**Auth required:** Yes — ADMIN or AGENT
**Purpose:** Retrieve a single ticket by UUID. ADMIN can fetch any ticket. AGENT receives `403` if the ticket is outside their scope (neither `assignedTo` nor `createdBy` matches the caller).

**Path parameter:** `:id` — UUID; validated with `uuidParam.parse()` before reaching the service.

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "string",
    "description": "string",
    "priority": "LOW",
    "status": "IN_PROGRESS",
    "assignedTo": "uuid",
    "createdBy": "uuid",
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601"
  }
}
```

**Error cases:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | `:id` is not a valid UUID |
| 401 | — | Missing or invalid JWT |
| 403 | `FORBIDDEN` | AGENT caller is neither `assignedTo` nor `createdBy` |
| 404 | `NOT_FOUND` | No ticket with the given UUID exists |

> Single ticket reads check `ticket:{id}` in Redis first. On a cache miss, the row is fetched from Postgres and cached with `config.redis.ttlSeconds`. If Redis is unavailable, the request falls through to Postgres transparently (CACHE-7).

---

### PATCH /api/v1/tickets/:id

**Auth required:** Yes — ADMIN or AGENT
**Purpose:** Update one or more of `title`, `description`, `priority` on a ticket. At least one field must be provided. Status transitions and reassignment are handled by dedicated endpoints. AGENT callers must be within scope (`assignedTo` or `createdBy`).

**Request body (at least one field required):**
```json
{
  "title": "string — optional, 1–500 chars",
  "description": "string — optional, min 1 char",
  "priority": "LOW | MEDIUM | HIGH | URGENT — optional"
}
```

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Updated title",
    "description": "Updated description",
    "priority": "HIGH",
    "status": "OPEN",
    "assignedTo": "uuid",
    "createdBy": "uuid",
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601"
  }
}
```

**Error cases:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Empty body; whitespace-only strings; invalid `priority` value |
| 401 | — | Missing or invalid JWT |
| 403 | `FORBIDDEN` | AGENT caller is outside ticket scope |
| 404 | `NOT_FOUND` | Ticket does not exist |

> Update runs inside a `withTransaction` block with `SELECT ... FOR UPDATE` to lock the row before applying changes, preventing lost-update races (NFR-2). Cache is invalidated on success.

---

### PATCH /api/v1/tickets/:id/status

**Auth required:** Yes — ADMIN or AGENT
**Purpose:** Transition a ticket's status through the state machine. Only the transitions defined in §State Machine are accepted. AGENT callers must be the `assignedTo` user on the ticket (not merely the creator).

**Request body:**
```json
{
  "status": "OPEN | IN_PROGRESS | RESOLVED | CLOSED | CANCELLED"
}
```

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "string",
    "description": "string",
    "priority": "MEDIUM",
    "status": "IN_PROGRESS",
    "assignedTo": "uuid",
    "createdBy": "uuid",
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601"
  }
}
```

**Error cases:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | `status` is missing or not a valid enum value |
| 401 | — | Missing or invalid JWT |
| 403 | `FORBIDDEN` | AGENT caller is not the `assignedTo` user |
| 404 | `NOT_FOUND` | Ticket does not exist |
| 409 | `INVALID_STATUS_TRANSITION` | The requested transition is not in the allowed set (e.g., `OPEN → CLOSED`) |

**409 error body example:**
```json
{
  "success": false,
  "message": "Invalid status transition from OPEN to CLOSED",
  "code": "INVALID_STATUS_TRANSITION"
}
```

> The transition is validated inside `withTransaction` with `SELECT status FROM tickets WHERE id = $1 FOR UPDATE`. This row lock ensures that if two concurrent requests attempt to transition the same ticket, one waits for the other to commit, and the second evaluates the already-updated status rather than a stale snapshot (SM-4, SM-5).

---

### POST /api/v1/tickets/:id/assign

**Auth required:** Yes — **ADMIN only**
**Purpose:** Assign or reassign a ticket to any valid user. Non-admin callers are rejected by `requireRole('ADMIN')` middleware before reaching the service. Assignment does not change ticket status (FR-7a).

**Request body:**
```json
{
  "assignedTo": "uuid — the target user's ID"
}
```

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "string",
    "description": "string",
    "priority": "MEDIUM",
    "status": "OPEN",
    "assignedTo": "uuid-of-new-assignee",
    "createdBy": "uuid",
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601"
  }
}
```

**Error cases:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | `assignedTo` is missing or not a valid UUID |
| 400 | `USER_NOT_FOUND` | The UUID in `assignedTo` does not reference an existing user |
| 401 | — | Missing or invalid JWT |
| 403 | — | Caller role is AGENT — rejected by `requireRole('ADMIN')` middleware |
| 404 | `NOT_FOUND` | Ticket does not exist |

---

## Data Model Changes

No new tables were introduced for this module. The `tickets` table was fully defined in the initial schema and extended in the Phase 1 schema alignment migration. The relevant DDL is:

```sql
-- ENUM types (idempotent blocks)
DO $$ BEGIN
  CREATE TYPE ticket_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Base table
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tickets_status      ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority    ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by  ON tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to ON tickets(assigned_to);

-- Trigger: keeps updated_at current on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_set_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Phase 1 additions (2026-06-29)
ALTER TYPE ticket_priority ADD VALUE IF NOT EXISTS 'URGENT';
ALTER TYPE ticket_status   ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TABLE tickets ALTER COLUMN description SET NOT NULL;
ALTER TABLE tickets ALTER COLUMN assigned_to SET NOT NULL;
ALTER TABLE tickets
  ADD CONSTRAINT tickets_assigned_to_fkey
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE RESTRICT;
```

**Key schema facts for this module:**

- `description` is `NOT NULL` (VAL-2 enforced at both schema and Zod layers).
- `assigned_to` is `NOT NULL` with `ON DELETE RESTRICT` — a ticket is never unassigned (DM-3, DM-4).
- `updated_at` is trigger-maintained; the service never passes it in `UPDATE` statements.
- `URGENT` was added to `ticket_priority` in Phase 1 (base schema had `CRITICAL`, which is not exposed in the TypeScript union).
- `CANCELLED` was added to `ticket_status` in Phase 1 (SM-1, SM-3).
- Indexes on `status`, `priority`, `created_by`, and `assigned_to` support the filtered list query without full table scans (DM-5).

---

## RBAC

| Action | ADMIN | AGENT | Enforcement |
|--------|:-----:|:-----:|-------------|
| Create ticket | ✅ | ✅ | `authenticate` middleware only; both roles allowed |
| List tickets (all) | ✅ | ❌ | SQL `WHERE` clause omitted for ADMIN; no in-memory filter |
| List tickets (own scope) | ✅ | ✅ | SQL `WHERE (assigned_to = $callerId OR created_by = $callerId)` for AGENT |
| Get ticket by ID | ✅ (any) | ✅ (own scope) | Service checks `assignedTo` / `createdBy` after DB fetch; 403 on mismatch |
| Update ticket fields | ✅ (any) | ✅ (own scope) | `SELECT ... FOR UPDATE` in transaction; service 403 if AGENT out of scope |
| Transition status | ✅ (any) | ✅ (assigned only) | Service checks `assigned_to = callerId` for AGENT; creator-only does not suffice |
| Assign / reassign | ✅ | ❌ | `requireRole('ADMIN')` middleware on route; 403 before controller is reached |

Authorization is always derived from the verified JWT payload (`req.user.id`, `req.user.role`) — never from request body fields (RBAC-6).

---

## State Machine

Valid user-initiated transitions (SM-1):

```
OPEN        → IN_PROGRESS
OPEN        → CANCELLED
IN_PROGRESS → RESOLVED
IN_PROGRESS → CANCELLED
RESOLVED    → CLOSED
```

Terminal states with no outgoing transitions (SM-3):
- `CLOSED`
- `CANCELLED`

Any transition not in the list above — including same-state no-ops (e.g., `OPEN → OPEN`) and any transition out of a terminal state — is rejected with `409 INVALID_STATUS_TRANSITION` (SM-1, SM-2).

**System-only transition (SM-6):**

```
OPEN        → CLOSED  (auto-close job only)
IN_PROGRESS → CLOSED  (auto-close job only)
```

This transition is implemented in `systemCloseTicket()` in the service and is **not reachable** through `PATCH /api/v1/tickets/:id/status`. It is used exclusively by the auto-close background job (Phase 8 / FR-12). The function re-validates the ticket's current status inside a transaction before applying the close, skipping the close if the ticket has already moved to a terminal or `RESOLVED` state (FR-12c, SM-7).

The state machine definition in the service:

```ts
const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN:        ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['RESOLVED', 'CANCELLED'],
  RESOLVED:    ['CLOSED'],
  CLOSED:      [],
  CANCELLED:   [],
};
```

---

## Caching

| Cache key | Content | TTL | Invalidated by |
|-----------|---------|-----|----------------|
| `ticket:{id}` | Single `TicketRow` object | `config.redis.ttlSeconds` (default 3600s) | `updateTicket`, `transitionStatus`, `assignTicket`, `createTicket` (pattern) |
| `tickets:all*` | Pattern-matched list keys | n/a | Any mutation via `deleteCacheByPattern('tickets:all*')` |

The `stm:` key prefix is applied automatically by ioredis (`keyPrefix` in the Redis config) — it must not be added manually in key strings.

List results from `GET /api/v1/tickets` bypass the cache entirely. Per-caller RBAC scoping combined with up to six independent filter dimensions makes it impractical to key list results correctly without risking cross-scope cache pollution (CACHE-6).

All cache reads and writes are wrapped in `try/catch`. A Redis failure logs the error and falls through to Postgres — it never propagates a `500` to the caller (CACHE-7, CACHE-8). This means the API continues to function correctly when Redis is unavailable, with the only impact being increased database load.

---

## Background Jobs

The tickets module exposes `systemCloseTicket(id)` as a named export from `ticket.service.ts` for consumption by the auto-close job worker (Phase 8). No BullMQ queues are added by the tickets module itself. Notification jobs (email on ticket create) are a Phase 7 concern; the current implementation does not enqueue them yet.

| Function | Used by | Behavior |
|----------|---------|----------|
| `systemCloseTicket(id)` | `src/jobs/autoCloseWorker.ts` (Phase 8) | Closes `OPEN` or `IN_PROGRESS` tickets; no-op if already terminal or `RESOLVED`; invalidates cache |

---

## Environment Variables

No new environment variables are introduced by the tickets module. The following existing variables influence its behavior:

| Variable | Default | Purpose |
|----------|---------|---------|
| `REDIS_TTL_SECONDS` | `3600` | TTL applied when writing `ticket:{id}` to cache |
| `PG_DATABASE` | `ttn_stm` | Target database (`ttn_stm_test` when `NODE_ENV=test`) |

---

## Testing

### How to run

```bash
# Set up schema and seed data first (required for integration tests)
npm run db:setup

# Run all tests serially (recommended — integration tests share a real DB)
npm test -- --runInBand

# Run only the tickets module tests
npm test -- --runInBand --testPathPattern="ticket"

# Coverage report
npm run test:coverage
```

Integration tests require `NODE_ENV=test`, which routes all queries to the `ttn_stm_test` database. The test suite creates users directly via SQL and signs JWTs without hitting the auth endpoints, avoiding rate limiter interference.

### Test coverage

| Test file | What it covers |
|-----------|----------------|
| `src/modules/tickets/ticket.service.test.ts` | Unit tests with mocked `query` and `withTransaction`; all service functions tested in isolation |
| `src/modules/tickets/ticket.controller.test.ts` | Integration tests with `supertest` against real test database; HTTP status codes and response envelope shape |

### Key test scenarios

- **TEST-2:** `createTicket` auto-assigns to admin and forces `status = OPEN`, even when called by an AGENT. Verified both at the service unit level (checks the INSERT SQL contains the admin ID) and integration level (asserts `data.assignedTo === admin.id` and `data.status === 'OPEN'`).

- **TEST-5:** Zod schema validation rejects missing `title`, whitespace-only `title`, missing `description`, empty `description`, and invalid `priority` values (e.g., `CRITICAL` is in the DB ENUM but excluded from the TypeScript union and Zod schema).

- **TEST-1 (service):** `transitionStatus` allows all five valid transitions and rejects seven representative invalid ones with `{ statusCode: 409, code: 'INVALID_STATUS_TRANSITION' }`. Agent attempting to transition a ticket not assigned to them gets `{ statusCode: 403, code: 'FORBIDDEN' }`.

- **TEST-1 (controller):** Full end-to-end coverage of all five valid and five invalid transitions against the real test database, confirming the correct HTTP status and `code` field in the response body.

- **TEST-3:** Admin receives all tickets in the list response; AGENT receives only tickets where they are `createdBy` or `assignedTo`, never tickets belonging to other agents.

- **TEST-4:** Agent calling `POST /:id/assign` receives `403`; admin calling it with a non-existent target UUID receives `400 USER_NOT_FOUND`; valid admin reassignment updates `assignedTo` and returns `200`.

- **TEST-6 (cache):** `getTicketById` returns the cached value for ADMIN without hitting the database; falls back to Postgres on cache miss and populates the cache; throws `403 FORBIDDEN` when a cached ticket is outside an AGENT's scope.

---

## Known Limitations / Future Work

- **Admin resolution on every create:** `createTicket` issues a `SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at ASC LIMIT 1` on every invocation. For high-volume systems, the admin ID could be resolved once at startup and held in memory or cached in Redis with a long TTL.

- **List results are not cached:** Dynamic RBAC scoping and multi-dimensional filter params make safe list caching expensive to implement correctly. If list performance becomes a bottleneck, a short-TTL per-caller cache keyed on `{callerId}:{serialized-filters}` could be introduced, with invalidation on any ticket mutation.

- **`CRITICAL` priority value exists in the DB ENUM but is excluded from the API:** The initial schema included `CRITICAL` in `ticket_priority`. Phase 1 added `URGENT`. The TypeScript union and all Zod schemas only expose `LOW | MEDIUM | HIGH | URGENT`. Any row with `priority = CRITICAL` (from before Phase 1) would be returned correctly in reads but could not be set via the API.

- **`systemCloseTicket` is not yet called:** The export exists and is tested as a no-op boundary; the actual auto-close job worker is implemented in Phase 8.

- **Notification emails on ticket create are deferred to Phase 7:** The service does not yet enqueue a `new-ticket` email job after `createTicket`. A try/catch stub placeholder is the intended integration point (FR-10).

- **Agent can update a ticket they created but are not assigned to:** The `updateTicket` service scope check allows callers who are either `assignedTo` or `createdBy`. The requirements are permissive on this point (RBAC-4 says "update fields" without restricting to assigned-only). If stricter access control is wanted for updates, the condition in `updateTicket` should be narrowed to `assignedTo = callerId` only, matching the stricter rule applied in `transitionStatus`.
