# Backend Database Setup — PostgreSQL & Redis Connection Services

## Goal

Wire the Express TypeScript monolith to a globally running **PostgreSQL 16** and **Redis 7** (both in Docker) with typed connection wrapper services, a shared config layer, and graceful startup/shutdown lifecycle.

---

## Infrastructure (Global Docker Containers)

| Service  | Container        | Image              | Host Port | Credentials                              |
| -------- | ---------------- | ------------------ | --------- | ---------------------------------------- |
| Postgres | `global-postgres`| `postgres:16-alpine` | `5432`  | user: `postgres` / pass: `postgres`      |
| Redis    | `global-redis`   | `redis:7-alpine`   | `6379`    | no password                              |
| Adminer  | `global-adminer` | `adminer`          | `8080`    | Web UI for Postgres                      |
| Redis UI | `global-redis-ui`| `redis-commander`  | `8081`    | Web UI for Redis                         |

> App database `support_tickets` was created manually:
> `docker exec global-postgres psql -U postgres -c "CREATE DATABASE support_tickets;"`

---

## Files Added / Changed

```
backend-node/
├── src/
│   └── config/
│       ├── index.ts        ← expanded: postgres + redis typed config blocks
│       ├── postgres.ts     ← NEW: pg.Pool connection wrapper service
│       └── redis.ts        ← NEW: ioredis connection wrapper service
├── bin/
│   └── www.ts              ← updated: bootstrap() + graceful shutdown
├── .env                    ← NEW: actual local values (gitignored)
└── .sample.env             ← NEW: committed template (replaces .env.example)
```

---

## Config (`src/config/index.ts`)

All database settings are read from environment variables with defaults. Full `Config` interface:

```typescript
interface Config {
  env: string;
  port: number;
  postgres: {
    host, port, user, password, database,
    poolMin, poolMax, idleTimeoutMs, connectionTimeoutMs, ssl
  };
  redis: {
    host, port, password, db, keyPrefix, ttlSeconds
  };
  jwt: { secret, expiresIn };
}
```

---

## PostgreSQL Wrapper (`src/config/postgres.ts`)

Uses `pg.Pool` (shared singleton, exported as default).

| Export | Signature | Purpose |
|--------|-----------|---------|
| `connectPostgres` | `() => Promise<void>` | Runs `SELECT NOW()` to verify pool; called at boot |
| `query<T>` | `(sql, params?) => Promise<QueryResult<T>>` | Generic typed query for all service files |
| `withTransaction<T>` | `(fn: (client) => Promise<T>) => Promise<T>` | Wraps callback in `BEGIN / COMMIT / ROLLBACK` |
| `disconnectPostgres` | `() => Promise<void>` | Drains pool cleanly on shutdown |
| `pool` (default) | `pg.Pool` | Raw pool for advanced use |

Pool config pulled from `config.postgres.*`:
- `min: 2`, `max: 10`
- `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`
- `ssl: false` (toggle via `PG_SSL=true`)
- Pool error events logged to console

---

## Redis Wrapper (`src/config/redis.ts`)

Uses `ioredis` with `lazyConnect: true` (default export).

| Export | Signature | Purpose |
|--------|-----------|---------|
| `connectRedis` | `() => Promise<void>` | Connects + sends `PING`; called at boot |
| `disconnectRedis` | `() => Promise<void>` | Graceful `QUIT` on shutdown |
| `setCache` | `(key, value, ttlSeconds?) => Promise<void>` | JSON-serialise + set with EX |
| `getCache<T>` | `(key) => Promise<T \| null>` | JSON-parse on hit, `null` on miss |
| `deleteCache` | `(key) => Promise<void>` | Delete single key |
| `deleteCacheByPattern` | `(pattern) => Promise<void>` | KEYS + bulk DEL |
| `redis` (default) | `ioredis.Redis` | Raw client for pub/sub or advanced use |

Key behaviours:
- `keyPrefix: 'stm:'` — all keys namespaced automatically by ioredis
- `retryStrategy`: exponential backoff, `200ms × attempt`, cap `2000ms`, max 5 retries
- Lifecycle events (`connect`, `ready`, `error`, `close`, `reconnecting`) all logged

---

## Server Lifecycle (`bin/www.ts`)

```
bootstrap()
  ├── connectPostgres()   ← must succeed before HTTP opens
  ├── connectRedis()      ← must succeed before HTTP opens
  └── server.listen(port)

SIGTERM / SIGINT
  └── server.close()
        ├── disconnectPostgres()
        ├── disconnectRedis()
        └── process.exit(0)
```

Bootstrap failure → `process.exit(1)` with error logged.

---

## Environment Variables

### `.sample.env` (committed — use as template)

```
# App
NODE_ENV=development
PORT=3000

# PostgreSQL
PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=your_pg_password_here
PG_DATABASE=support_tickets
PG_POOL_MIN=2
PG_POOL_MAX=10
PG_IDLE_TIMEOUT_MS=30000
PG_CONNECTION_TIMEOUT_MS=5000
PG_SSL=false

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_KEY_PREFIX=stm:
REDIS_TTL_SECONDS=3600

# JWT
JWT_SECRET=your_super_secret_key_here
JWT_EXPIRES_IN=7d
```

### `.env` (gitignored — local Docker values)
Same shape with actual credentials: `PG_PASSWORD=postgres`, `JWT_SECRET=dev_jwt_secret_changeme_in_prod`.

---

## Dependencies Added

| Package        | Version | Type | Purpose                   |
| -------------- | ------- | ---- | ------------------------- |
| `pg`           | latest  | prod | PostgreSQL client + pool  |
| `ioredis`      | latest  | prod | Redis client              |
| `@types/pg`    | latest  | dev  | TypeScript types for `pg` |

> `ioredis` ships its own types — no `@types/ioredis` needed.

---

## Key Decisions

- **`pg` over `Sequelize`/`TypeORM`** — raw SQL via `query()` keeps the wrapper minimal; an ORM layer can be added on top later without changing the connection layer.
- **`ioredis` over `redis` (node-redis)** — better TypeScript support, built-in retry logic, and cleaner pub/sub API for future use.
- **`lazyConnect: true`** — Redis client is created at module load but only physically connects when `connectRedis()` is called in `bootstrap()`, keeping startup order explicit.
- **`keyPrefix: 'stm:'`** — ioredis prepends this to every key automatically, so service code never needs to manually namespace cache keys.
- **Shared singleton pool/client** — both `pool` (pg) and `redis` (ioredis) are module-level singletons; importing from `src/config/postgres` or `src/config/redis` always returns the same instance.

---

## Next Steps

- [ ] Write DB migration tooling (e.g. `node-pg-migrate` or raw SQL scripts in `src/db/migrations/`)
- [ ] Define `users` and `tickets` table schemas and run initial migration
- [ ] Replace stub service implementations with real `query()` calls
- [ ] Add Redis caching layer to ticket list / findById calls
- [ ] Implement authentication (bcrypt + JWT, auth middleware)
- [ ] Input validation with `zod`
- [ ] Role-based access control (admin / agent / user)
- [ ] Tests — Jest + Supertest with a test database
