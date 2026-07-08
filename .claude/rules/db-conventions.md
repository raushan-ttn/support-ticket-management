# DB Conventions

Covers: PostgreSQL queries and schema, Redis caching, and direct (non-queued) email notifications.

---

## PostgreSQL

### Connection
- Import `query<T>()` / `withTransaction()` from `src/config/postgres.ts` — never import `pg` directly
- `pool` is a shared singleton — never create additional `Pool` instances in service files

### Queries
- **Parameterized always** — `$1, $2, ...` — never string interpolation (SQL injection)
- **Never `SELECT *`** — always name columns explicitly
- Always provide row type generic: `query<UserRow>('SELECT id, email FROM users WHERE id = $1', [id])`
- Guard `rowCount`: `if (result.rowCount && result.rowCount > 0)`

### Transactions
Use `withTransaction(async (client) => { ... })` for any operation touching more than one table.
It handles `BEGIN`/`COMMIT`/`ROLLBACK` and `client.release()` automatically.

State machine transitions must run inside a transaction with a row lock:
```ts
// Inside withTransaction
await client.query('SELECT status FROM tickets WHERE id = $1 FOR UPDATE', [id]);
// validate transition, then update
```

### Schema & Migrations
- All DDL lives in `src/db/schema.sql` — never apply DDL via psql without updating it
- Schema must stay **idempotent**: `IF NOT EXISTS`, `OR REPLACE`, `EXCEPTION WHEN duplicate_object`
- Future changes: append versioned blocks with a date comment at the bottom of `schema.sql`
- Run: `npm run db:migrate`

### Types & IDs
- All PKs are `UUID` via `gen_random_uuid()` — typed as `string` in TypeScript
- All timestamps: `TIMESTAMPTZ` — never `TIMESTAMP` without timezone
- `created_at` is DB-defaulted — never pass it on insert
- `updated_at` on `tickets` is trigger-maintained — never pass it on update
- ENUM values are uppercase snake-case in Postgres; TypeScript mirrors as union types:
  ```ts
  type UserRole      = 'ADMIN' | 'AGENT'
  type TicketStatus  = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'CANCELLED'
  type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  ```
- Adding an ENUM value: `ALTER TYPE <name> ADD VALUE IF NOT EXISTS '<VALUE>'` — never drop/recreate

### Sensitive Columns
- Never include `password_hash` in any SELECT returned to a controller
- Never return `storage_key` from attachment queries — it is an internal backend path
- Explicitly list safe columns on every user query

---

## Redis

### Connection
- Use helpers from `src/config/redis.ts`: `setCache`, `getCache<T>`, `deleteCache`, `deleteCacheByPattern`
- Never create a second ioredis instance for cache operations

### Keys
- `keyPrefix: 'stm:'` is auto-prepended by ioredis — never add it manually in key strings
- Pattern: `{resource}:{id}` → `ticket:uuid-123`, `user:uuid-456`
- Standard keys:
  | Key | Content |
  |-----|---------|
  | `ticket:{id}` | Single ticket row |
  | `ticket:{id}:comments` | Comment list for a ticket |
  | `ticket:{id}:attachments` | Attachment metadata list for a ticket |
  | `tickets:all` / `tickets:all:*` | List/filter results (short TTL or bypass) |
  | `user:{id}` | User profile (read-heavy) |

### Cache Rules
- Never cache without a TTL — always pass an expiry (default: `config.redis.ttlSeconds`)
- **Invalidate on write**: call `deleteCache` / `deleteCacheByPattern` after any create, update, or delete
- Cache read-heavy, infrequently-mutated data (single ticket, comment list, user profile)
- Do not cache write results, auth tokens, or volatile paginated results
- **Never cache attachment bytes** — serve directly from the storage backend
- Attachment *metadata* listings (`ticket:{id}:attachments`) may be cached and must be invalidated on upload/delete
- **Graceful degradation**: if Redis is unreachable, serve from Postgres and log the error — never propagate a cache failure to the client

---

## Email Notifications (Direct, No Queue)

> **Decision (2026-07-08):** No job queue (BullMQ or otherwise) is used. Email is sent
> via a direct call from the service layer. See `requirements.md` §5.4 and
> `.claude/plans/notifications-email.md`.

### Rules
- Notification sends (`sendNewTicketEmail()`, `sendCommentNotificationEmail()`) happen in **services** after a successful DB write — never in controllers
- Always wrap the send call in try/catch; log failure but never re-throw (fire-and-forget) — a failed send is **not** retried
- If SMTP is unavailable, the send is skipped and logged — core ticket/comment APIs continue

> **Note (2026-07-08):** `src/config/queue.ts`, `src/jobs/queues.ts` (BullMQ
> connection/queue definitions), the auto-close scheduling calls in `comment.service.ts`,
> and `systemCloseTicket()` in `ticket.service.ts` have been removed — see `task.md`
> Phase 7/8 cleanup items (completed). Auto-close-on-stale-reply is out of scope
> (`requirements.md` §1.2) — it would have required a Redis-backed delayed-job queue.
