# Tickets & Comments Module

## Problem

Implement the core ticket and comment lifecycle: CRUD, server-authoritative status state machine,
RBAC-scoped listing, keyword search, auto-assignment on create, and comment add/list. This is the
central domain of the system and is referenced by notifications and attachments.

---

## Approach

Follow the existing `auth` module as the structural pattern:
`routes → controller → service` with Zod schemas in a dedicated `*.schemas.ts` file.
State machine logic lives exclusively in the service layer. RBAC guards are middleware applied at
the route level. Comments are a sub-module under `src/modules/comments/` (separate files, nested
routes mounted from `tickets.routes.ts`).

---

## State Machine

All transitions are server-authoritative. The service reads current status inside the same
transaction before writing (SM-4, SM-5).

```
OPEN → IN_PROGRESS
IN_PROGRESS → RESOLVED
RESOLVED → CLOSED
OPEN → CANCELLED
IN_PROGRESS → CANCELLED
```

System-only transition (SM-6 — auto-close job only, not reachable via API):
```
OPEN | IN_PROGRESS → CLOSED   (actor = 'system')
```

Invalid transitions return `409 Conflict` with body:
```json
{ "success": false, "message": "Invalid status transition", "code": "INVALID_STATUS_TRANSITION", "from": "OPEN", "to": "CLOSED" }
```

---

## Files Created / Modified

```
src/modules/tickets/
  ticket.schemas.ts       ← Zod schemas: createTicketSchema, updateTicketSchema,
                             statusTransitionSchema, assignSchema
  ticket.service.ts       ← all SQL + business logic
  ticket.controller.ts    ← parse req → call service → success()/error()
  ticket.routes.ts        ← route definitions + middleware

src/modules/comments/
  comment.schemas.ts      ← Zod schemas: createCommentSchema
  comment.service.ts      ← SQL + notification trigger
  comment.controller.ts
  comment.routes.ts       ← mounted inside ticket.routes.ts

src/middlewares/
  requireRole.ts          ← NEW: requireRole('ADMIN') factory middleware

src/config/index.ts       ← add: defaultAdminEmail from DEFAULT_ADMIN_EMAIL env var
```

---

## Module Specifications

### `ticket.schemas.ts`

```ts
createTicketSchema:   { title: string(1–500), description: string(min 1), priority?: TicketPriority }
updateTicketSchema:   { title?: string, description?: string, priority?: TicketPriority }
                      // assignedTo excluded — handled by assignSchema (admin-only)
statusTransitionSchema: { status: TicketStatus }
assignSchema:         { assignedTo: z.string().uuid() }
```

Zod `.trim()` applied to all string fields. Unknown fields are stripped (`z.object().strip()`).

### `ticket.service.ts`

#### `createTicket(payload, creatorId)`
1. Resolve default admin: `SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1`
   (or from `config.defaultAdminEmail`).
2. `INSERT INTO tickets (title, description, priority, status, assigned_to, created_by)`
   with `status = 'OPEN'` and `assigned_to = adminId` — client-supplied values ignored (FR-1a).
3. Return full ticket row (named columns only, no `password_hash`).
4. After commit: enqueue `new-ticket` email job (FR-10) — fire-and-forget (never blocks response).

#### `listTickets(callerId, callerRole, filters)`
Filters: `{ status?, priority?, assignedTo?, search?, page?, limit?, sortBy?, order? }`.

RBAC scope applied in SQL `WHERE` clause:
- `ADMIN`: no scope restriction.
- `AGENT`: `WHERE assigned_to = $callerId OR created_by = $callerId`.

Search: `AND (title ILIKE $term OR description ILIKE $term)` — parameterized, never interpolated.
Pagination: `LIMIT $limit OFFSET ($page - 1) * $limit`. Default `limit = 20`, max `100`.
Returns `{ tickets: TicketRow[], total: number, page: number, limit: number }`.

#### `getTicketById(id, callerId, callerRole)`
- `SELECT ... FROM tickets WHERE id = $1` — returns `null` if not found (→ 404).
- If role is `AGENT`: verify `assigned_to = callerId OR created_by = callerId` (→ 403 if not).

#### `updateTicket(id, payload, callerId, callerRole)`
- If `assignedTo` is in payload: caller must be `ADMIN` (→ 403 otherwise).
- Verify target user exists before updating `assigned_to`.
- Run inside `withTransaction`: re-read ticket to verify access + apply update.
- Invalidates cache key `ticket:{id}` and `tickets:all` pattern.

#### `transitionStatus(id, newStatus, callerId, callerRole)`
Run inside `withTransaction`:
1. `SELECT status FROM tickets WHERE id = $1 FOR UPDATE` — lock row.
2. Validate transition is in the allowed set; throw `409` if not.
3. `UPDATE tickets SET status = $2 WHERE id = $1`.
4. If transitioning to `RESOLVED` or `CLOSED`: cancel any pending auto-close job.
5. Invalidates cache.

#### `systemTransitionStatus(id, newStatus)` — internal, not exported to controller
Used only by auto-close job worker. Skips user RBAC; logs actor as `'system'`.

#### `assignTicket(ticketId, targetUserId, callerId)`
- Verify `targetUserId` exists in `users` table (→ 400 if not found).
- `UPDATE tickets SET assigned_to = $1 WHERE id = $2`.
- Replaces pending auto-close job key if one exists.
- Invalidates cache.

### `comment.service.ts`

#### `addComment(ticketId, message, authorId, authorRole)`
- Verify ticket exists and caller has access (same scope as `getTicketById`).
- `INSERT INTO comments (ticket_id, message, created_by)`.
- After commit (fire-and-forget):
  - Enqueue `comment-notification` email job (FR-11).
  - If `authorId === ticket.assignedTo`: schedule/replace auto-close delayed job (FR-12f).
  - If `authorId === ticket.createdBy` and ticket is non-terminal: cancel pending auto-close (FR-12a).
- Invalidates cache key `ticket:{ticketId}:comments`.

#### `listComments(ticketId, callerId, callerRole)`
- Verify ticket access.
- `SELECT id, ticket_id, message, created_by, created_at FROM comments WHERE ticket_id = $1 ORDER BY created_at ASC`.
- Cache under `ticket:{ticketId}:comments`.

### `requireRole.ts` middleware

```ts
export const requireRole = (...roles: UserRole[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      error(res, 'Forbidden', 403); return;
    }
    next();
  };
```

### `ticket.routes.ts` (route definitions)

```
POST   /                         authenticate, validateBody(createTicketSchema),    controller.create
GET    /                         authenticate,                                       controller.list
GET    /:id                      authenticate,                                       controller.getOne
PATCH  /:id                      authenticate, validateBody(updateTicketSchema),     controller.update
PATCH  /:id/status               authenticate, validateBody(statusTransitionSchema), controller.transition
POST   /:id/assign               authenticate, requireRole('ADMIN'), validateBody(assignSchema), controller.assign
GET    /:id/comments             authenticate,                                       commentController.list
POST   /:id/comments             authenticate, validateBody(createCommentSchema),    commentController.create
```

---

## Caching

| Operation | Cache action |
|-----------|-------------|
| `listTickets` | Read `tickets:all:{scope}:{filters}` (short TTL 60s or bypass) |
| `getTicketById` | Read/write `ticket:{id}` |
| `listComments` | Read/write `ticket:{id}:comments` |
| Any mutation (create/update/assign/status) | Delete `ticket:{id}`, `tickets:all` pattern |
| Add comment | Delete `ticket:{ticketId}:comments` |

Cache misses fall back to Postgres; Redis errors are logged and never propagated (CACHE-7).

---

## Error Codes (ERR-3)

| Code | HTTP | Scenario |
|------|------|---------|
| `NOT_FOUND` | 404 | Ticket or comment does not exist |
| `FORBIDDEN` | 403 | Caller outside ticket scope or non-admin on admin route |
| `INVALID_STATUS_TRANSITION` | 409 | Transition not in allowed set |
| `USER_NOT_FOUND` | 400 | `assignedTo` UUID references non-existent user |
| `VALIDATION_ERROR` | 400 | Zod parse failure |

---

## Risks

- **Concurrent status transitions** — mitigated by `SELECT ... FOR UPDATE` inside transaction (SM-5).
- **Auto-assignment resolution** — default admin lookup adds a DB query on every create; cache the
  admin ID in memory at startup (resolved from `DEFAULT_ADMIN_EMAIL` config).
- **Cache list invalidation** — `tickets:all:*` is a pattern delete; `deleteCacheByPattern` uses
  `KEYS` which can be slow on large keyspaces. Consider `SCAN`-based implementation in production.

---

## Next Steps

- [ ] Write Zod schemas (`ticket.schemas.ts`, `comment.schemas.ts`)
- [ ] Implement `requireRole` middleware
- [ ] Implement `ticket.service.ts` (createTicket, listTickets, getTicketById, updateTicket, transitionStatus, assignTicket)
- [ ] Implement `ticket.controller.ts`
- [ ] Implement `ticket.routes.ts`
- [ ] Implement `comment.service.ts` (addComment, listComments)
- [ ] Implement `comment.controller.ts`, `comment.routes.ts`
- [ ] Mount ticket router in `src/app.ts` at `/api/v1/tickets`
- [ ] Integration tests (TEST-1 through TEST-5)
