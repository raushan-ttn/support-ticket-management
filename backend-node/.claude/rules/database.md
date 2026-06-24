# Database Rules

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
- ENUM values are PostgreSQL ENUM types; TypeScript mirrors: `type UserRole = 'admin' | 'agent' | 'user'`
- Adding an ENUM value: `ALTER TYPE <name> ADD VALUE '<value>'` — never drop/recreate

### Sensitive Columns
- Never include `password_hash` in any SELECT returned to a controller
- Explicitly list safe columns on every user query

---

## Redis

### Connection
- Use helpers from `src/config/redis.ts`: `setCache`, `getCache<T>`, `deleteCache`, `deleteCacheByPattern`
- Never create a second ioredis instance

### Keys
- `keyPrefix: 'stm:'` is auto-prepended by ioredis — never add it manually
- Pattern: `{resource}:{id}` → `tickets:uuid-123`, `users:uuid-456`, `tickets:all`

### Cache Rules
- Never cache without a TTL — always pass an expiry (default: `config.redis.ttlSeconds`)
- Invalidate on write: call `deleteCache`/`deleteCacheByPattern` after any create/update/delete
- Cache read-heavy, infrequently-mutated data (ticket list, single ticket, user profile)
- Do not cache write results, auth tokens, or volatile paginated results
