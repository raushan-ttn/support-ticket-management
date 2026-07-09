# Tickets Module — Implementation Plan

> **Note (2026-07-09):** the `tickets.screenshot` field/column referenced throughout
> this plan (a plain client-supplied URL string, DM-13) has been **removed** — see
> `task.md` Phase 10 cleanup item and `requirements.md` DM-13. It is superseded by the
> `attachments` system (Phase 6). Historical content below is left as-is for context.

## Problem

Implement Phase 4 of the Support Ticket Management backend: the full ticket lifecycle (create, list, get, update, status transition, assign) with RBAC-scoped access, server-authoritative state machine, keyword search, pagination, and Redis caching. This is the central domain module — comments, attachments, and notifications all depend on it (auto-close was later removed from scope).

---

## Approach

Follow the existing `auth` module as the structural pattern: `routes → controller → service` with Zod schemas in `ticket.schemas.ts`. State machine logic lives exclusively in the service layer. RBAC guards (`authenticate`, `requireRole`) and validation middleware (`validateBody`, `validateQuery`) are applied at the route level — never inside controllers or services.

**Phase 4 scope:** 6 ticket endpoints only. Comments are a separate Phase 5 concern (mounted from `tickets.routes.ts`).

---

## Files Created / Modified

| File | Action | Notes |
|------|--------|-------|
| `src/modules/tickets/ticket.schemas.ts` | CREATE | Zod schemas + inferred types + TicketRow interface |
| `src/modules/tickets/ticket.service.ts` | CREATE | All SQL + business logic + cache |
| `src/modules/tickets/ticket.controller.ts` | CREATE | req → service → success()/error() |
| `src/modules/tickets/ticket.routes.ts` | CREATE | Route definitions + middleware chain |
| `src/app.ts` | MODIFY | Mount tickets router at `/api/v1/tickets` |

**Already exists — no changes needed:**
- `src/middlewares/requireRole.ts` — role guard
- `src/middlewares/validateBody.ts` / `validateQuery.ts` — Zod validation middleware

---

## Schema Changes

Migration 2026-07-01 added three nullable columns to `tickets` and one to `comments` (DM-12, DM-13):

| Table      | Column       | Type           | Notes |
|------------|------------- |--------------- |-------|
| `tickets`  | `type`       | `VARCHAR(100)` | nullable — free-text classification (BUG, FEATURE_REQUEST …) |
| `tickets`  | `sub_type`   | `VARCHAR(100)` | nullable — sub-classification (UI, API, AUTHENTICATION …) |
| `tickets`  | `screenshot` | `TEXT`         | nullable — plain URL; NOT a storage key |
| `comments` | `screenshot` | `TEXT`         | nullable — plain URL; NOT a storage key |

Indexes `idx_tickets_type` and `idx_tickets_sub_type` support filter queries.
Free-text (no ENUM) keeps category management schema-free.

---

## Zod Schemas (`ticket.schemas.ts`)

```ts
// Create — FR-1b, VAL-2/VAL-3, DM-12/DM-13
export const createTicketSchema = z.object({
  title:       z.string().trim().min(1).max(500),
  description: z.string().trim().min(1),
  priority:    z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  type:        z.string().trim().max(100).optional(),
  subType:     z.string().trim().max(100).optional(),
  screenshot:  z.string().url().optional(),
});

// Update — FR-4 (no assignedTo — that's assignSchema); nullable allows clearing fields
export const updateTicketSchema = z.object({
  title:       z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().min(1).optional(),
  priority:    z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  type:        z.string().trim().max(100).nullable().optional(),
  subType:     z.string().trim().max(100).nullable().optional(),
  screenshot:  z.string().url().nullable().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field required' });

// Status transition — FR-5, SM-1
export const statusTransitionSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED']),
});

// Assign — FR-7
export const assignSchema = z.object({
  assignedTo: z.string().uuid({ message: 'assignedTo must be a valid UUID' }),
});

// List query — SF-1–SF-4, DM-12; z.coerce.number() required for page/limit (query strings are always string)
export const listTicketsQuerySchema = z.object({
  status:     z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED']).optional(),
  priority:   z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assignedTo: z.string().uuid().optional(),
  type:       z.string().trim().max(100).optional(),   // filter by ticket type
  search:     z.string().trim().max(200).optional(),
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(100).default(20),
  sortBy:     z.enum(['createdAt', 'updatedAt', 'priority']).default('createdAt'),
  order:      z.enum(['asc', 'desc']).default('desc'),
});

// Inferred types
export type CreateTicketPayload   = z.infer<typeof createTicketSchema>;
export type UpdateTicketPayload   = z.infer<typeof updateTicketSchema>;
export type StatusTransitionPayload = z.infer<typeof statusTransitionSchema>;
export type AssignPayload         = z.infer<typeof assignSchema>;
export type ListTicketsQuery      = z.infer<typeof listTicketsQuerySchema>;

// Response interface — no password_hash
export interface TicketRow {
  id:          string;
  title:       string;
  description: string;
  type:        string | null;
  subType:     string | null;
  screenshot:  string | null;
  priority:    TicketPriority;
  status:      TicketStatus;
  assignedTo:  string;
  createdBy:   string;
  createdAt:   string;
  updatedAt:   string;
}

export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketStatus   = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'CANCELLED';
```

---

## Business Logic (`ticket.service.ts`)

### `createTicket(payload, creatorId)` — FR-1, FR-1a

1. Resolve default admin: `SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at ASC LIMIT 1`
2. INSERT ticket with `status = 'OPEN'`, `assigned_to = adminId`, `created_by = creatorId` — client-supplied status/assignedTo are **ignored** (FR-1a).
3. SELECT the newly inserted row by id (named columns only).
4. Fire-and-forget: enqueue `new-ticket` email job (Phase 7 — skip for now, add try/catch stub).
5. Invalidate `tickets:all*` pattern cache.

```sql
INSERT INTO tickets (title, description, priority, status, assigned_to, created_by)
VALUES ($1, $2, $3, 'OPEN', $4, $5)
RETURNING id
```

### `listTickets(callerId, callerRole, filters)` — FR-2, FR-2a, RBAC-3/4, SF-1–SF-5

Build parameterized WHERE clause dynamically:
- **ADMIN**: no scope restriction
- **AGENT**: `AND (t.assigned_to = $callerId OR t.created_by = $callerId)` — in SQL, never in-memory
- Optional filters appended: `status`, `priority`, `assignedTo`
- Search: `AND (t.title ILIKE $term OR t.description ILIKE $term)` — wrap term in `%...%`
- Pagination: `LIMIT $limit OFFSET ($page - 1) * $limit`
- Sorting: map `sortBy` camelCase → column name; validate against allowlist before interpolating column name

Returns `{ tickets: TicketRow[], total: number, page: number, limit: number }`.

**Column SELECT:**
```sql
SELECT t.id, t.title, t.description,
       t.type, t.sub_type AS "subType", t.screenshot,
       t.priority, t.status,
       t.assigned_to AS "assignedTo", t.created_by AS "createdBy",
       t.created_at AS "createdAt", t.updated_at AS "updatedAt"
FROM tickets t
```

### `getTicketById(id, callerId, callerRole)` — FR-3

1. `SELECT ... FROM tickets WHERE id = $1` → null → throw 404 `NOT_FOUND`.
2. If `AGENT`: verify `assigned_to = callerId OR created_by = callerId` → throw 403 `FORBIDDEN` if not.
3. Cache: check `ticket:{id}` first; populate on miss; return.

### `updateTicket(id, payload, callerId, callerRole)` — FR-4, FR-4a

Run inside `withTransaction`:
1. `SELECT ... FROM tickets WHERE id = $1 FOR UPDATE` — lock + verify exists (404).
2. Verify caller scope (403 for agent outside scope).
3. Build SET clause from non-undefined payload fields (title, description, priority only — no status or assignedTo here).
4. `UPDATE tickets SET ... WHERE id = $1`.
5. Invalidate `ticket:{id}` and `deleteCacheByPattern('tickets:all')`.

### `transitionStatus(id, newStatus, callerId, callerRole)` — FR-5, SM-1–SM-5

```ts
const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN:        ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['RESOLVED', 'CANCELLED'],
  RESOLVED:    ['CLOSED'],
  CLOSED:      [],
  CANCELLED:   [],
};
```

Run inside `withTransaction`:
1. `SELECT status FROM tickets WHERE id = $1 FOR UPDATE` — lock row (SM-4, SM-5).
2. Validate `VALID_TRANSITIONS[currentStatus].includes(newStatus)` → throw 409 `INVALID_STATUS_TRANSITION` if not.
3. Verify caller scope (agent: must be assigned to ticket).
4. `UPDATE tickets SET status = $2 WHERE id = $1`.
5. Invalidate cache.

### `systemCloseTicket(id)` — SM-6 (internal, not exported to controller) — dead code, pending removal

Was intended for the auto-close job worker (formerly Phase 8), which is now **removed
from scope** (required a BullMQ delayed-job queue not part of this implementation —
`requirements.md` §1.2). This function is implemented in code but unreachable by
anything; tracked for removal in `task.md` Phase 8.

### `assignTicket(ticketId, targetUserId)` — FR-7

1. Verify `targetUserId` exists: `SELECT id FROM users WHERE id = $1` → throw 400 `USER_NOT_FOUND` if not found.
2. Verify ticket exists (404).
3. `UPDATE tickets SET assigned_to = $1 WHERE id = $2`.
4. Invalidate cache.

---

## Routes (`ticket.routes.ts`)

```
POST   /                   authenticate, validateBody(createTicketSchema),       controller.create
GET    /                   authenticate, validateQuery(listTicketsQuerySchema),   controller.list
GET    /:id                authenticate,                                          controller.getById
PATCH  /:id                authenticate, validateBody(updateTicketSchema),        controller.update
PATCH  /:id/status         authenticate, validateBody(statusTransitionSchema),    controller.transitionStatus
POST   /:id/assign         authenticate, requireRole('ADMIN'), validateBody(assignSchema), controller.assign
```

Note: `validateQuery` is on GET / — required for proper coercion and validation of query params.

---

## Controller (`ticket.controller.ts`)

Pattern for all methods:
```ts
export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await ticketService.createTicket(req.body, req.user!.id);
    success(res, result, 201);
  } catch (err) {
    next(err);
  }
};
```

- Parse `req.params.id` with `uuidParam.parse()` — throws ZodError → errorHandler → 400.
- `req.user` is always populated (passport `authenticate` runs first).
- Never call `res.json()` directly; always use `success()` / `error()`.
- Always `return` after `error()`.

---

## Mount in `app.ts`

Insert before the `errorHandler` line:
```ts
import ticketRouter from './modules/tickets/ticket.routes';
app.use('/api/v1/tickets', ticketRouter);
```

---

## Cache Strategy

| Operation | Cache action |
|-----------|-------------|
| `getTicketById` | Read `ticket:{id}`; write on miss with default TTL |
| `listTickets` | Bypass cache (RBAC-scoped lists + dynamic filters — hard to key correctly) |
| Any mutation | `deleteCache('ticket:' + id)` + `deleteCacheByPattern('tickets:all')` |
| Redis unreachable | Log error, continue from Postgres — never propagate (CACHE-7) |

---

## RBAC Summary

| Endpoint | Role | Guard |
|----------|------|-------|
| POST / | ADMIN, AGENT | `authenticate` only |
| GET / | ADMIN, AGENT | `authenticate` + SQL scope |
| GET /:id | ADMIN, AGENT | `authenticate` + service scope check |
| PATCH /:id | ADMIN, AGENT | `authenticate` + service scope check |
| PATCH /:id/status | ADMIN, AGENT | `authenticate` + service scope check |
| POST /:id/assign | ADMIN only | `authenticate` + `requireRole('ADMIN')` |

---

## State Machine

```
OPEN → IN_PROGRESS
IN_PROGRESS → RESOLVED
RESOLVED → CLOSED
OPEN → CANCELLED
IN_PROGRESS → CANCELLED

[system-only, dead code] OPEN | IN_PROGRESS → CLOSED  (was for the removed auto-close job, formerly Phase 8)
```

Invalid transitions → `409 Conflict`:
```json
{ "success": false, "message": "Invalid status transition from OPEN to CLOSED", "code": "INVALID_STATUS_TRANSITION" }
```

---

## Error Cases

| Scenario | HTTP | Code |
|----------|------|------|
| Missing/invalid body fields | 400 | `VALIDATION_ERROR` |
| Invalid UUID param | 400 | `VALIDATION_ERROR` |
| Ticket not found | 404 | `NOT_FOUND` |
| Agent accessing out-of-scope ticket | 403 | `FORBIDDEN` |
| Non-admin calling assign endpoint | 403 | (requireRole middleware) |
| assignedTo user doesn't exist | 400 | `USER_NOT_FOUND` |
| Invalid status transition | 409 | `INVALID_STATUS_TRANSITION` |

---

## Risks

- **Concurrent status transitions** — mitigated by `SELECT ... FOR UPDATE` inside `withTransaction` (SM-5).
- **Admin resolution on every create** — a DB query on every ticket create. Acceptable for now; can cache admin ID in memory at startup later.
- **Dynamic SQL for list filters** — build params array carefully to match `$1, $2, ...` positions; off-by-one causes silent wrong results.
- **sortBy column injection** — `sortBy` comes from validated enum but must be mapped to a column name allowlist before being interpolated into the ORDER BY clause. Never interpolate raw user input.

---

## Non-Negotiables Checklist

- [x] Never read `process.env` outside `src/config/index.ts`
- [x] Never interpolate values into SQL — always `$1, $2, ...` params
- [x] Never `SELECT *` — name all columns; never return `password_hash`
- [x] No SQL in controllers or route files
- [x] Always use `success()` / `error()` from `src/utils/response.ts`
- [x] Always `next(err)` in controller catch — never `res.status(500).json()`
- [x] Always `return` after calling `error()`
- [x] TypeScript `strict: true` — no `any`, no `!` assertion without proof
- [x] Prefix unused params with `_`
- [x] `validateQuery` on GET / (not just validateBody)

---

## Next Steps (ordered)

1. `ticket.schemas.ts` — Zod schemas + types + TicketRow interface
2. `ticket.service.ts` — all 6 service functions + cache helpers
3. `ticket.controller.ts` — 6 controller methods
4. `ticket.routes.ts` — route definitions + middleware chain
5. `src/app.ts` — mount tickets router
6. `ticket.service.test.ts` — unit tests (mocked query) for TEST-1–TEST-5
7. `ticket.controller.test.ts` — integration tests (supertest + real test DB)
