# CLAUDE.md — Support Ticket Management (backend-node)

## Stack
Node.js 24 · Express 4 · TypeScript strict · PostgreSQL 16 (`ttn_stm`) · Redis 7
Entry: `bin/www.ts` → `src/app.ts` · API prefix: `/api/v1/`

## Architecture: Monolith Modular
```
bin/www.ts              server bootstrap + graceful shutdown
src/
  app.ts                middleware stack + route mounting
  config/
    index.ts            ALL env vars → typed Config (only place process.env is read)
    postgres.ts         pg.Pool singleton: query<T>(), withTransaction()
    redis.ts            ioredis singleton: setCache/getCache/deleteCache helpers
  db/
    schema.sql          idempotent DDL — source of truth
    migrate.ts          npm run db:migrate
    admin-seed.ts       npm run db:seed
  middlewares/
    errorHandler.ts     global 4-arg error handler (always last in app.ts)
  modules/{module}/
    {module}.routes.ts      HTTP verb + path → controller only
    {module}.controller.ts  parse req → call service → send response
    {module}.service.ts     business logic + DB/cache calls
  utils/
    response.ts         success() / error() — only way to send responses
```

## Non-Negotiables
1. Never read `process.env` outside `src/config/index.ts`
2. Never interpolate values into SQL — always use `$1, $2, ...` params
3. Never `SELECT *` — always name columns; never return `password_hash`
4. Never put SQL in controllers or route files
5. Always use `success()` / `error()` from `src/utils/response.ts` — no raw `res.json()`
6. Always `next(err)` in controller catch — never `res.status(500).json()` in catch
7. Always `return` after calling `error()` to prevent "headers already sent"
8. TypeScript `strict: true` — no `any`, no `!` assertion without proof
9. Prefix unused params with `_` (`_req`, `_next`, `_filters`)
10. Never `git commit --no-verify`

## Rules Reference
| Topic | File |
|-------|------|
| Security, Auth, RBAC, File Uploads | `.claude/rules/security.md` |
| API Design, TypeScript, Code Structure, Testing | `.claude/rules/api-conventions.md` |
| PostgreSQL, Redis, BullMQ | `.claude/rules/db-conventions.md` |

## Environment Variables
| Variable | Default | Notes |
|----------|---------|-------|
| `NODE_ENV` | `development` | `test` uses `ttn_stm_test` DB |
| `PORT` | `3000` | |
| `PG_HOST/PORT/USER/PASSWORD` | `localhost/5432/postgres/postgres` | |
| `PG_DATABASE` | `ttn_stm` | |
| `PG_POOL_MIN/MAX` | `2/10` | |
| `PG_IDLE_TIMEOUT_MS` | `30000` | |
| `PG_CONNECTION_TIMEOUT_MS` | `5000` | |
| `PG_SSL` | `false` | `true` in production |
| `REDIS_HOST/PORT` | `localhost/6379` | |
| `REDIS_PASSWORD` | _(empty)_ | |
| `REDIS_DB` | `0` | |
| `REDIS_KEY_PREFIX` | `stm:` | auto-prepended by ioredis |
| `REDIS_TTL_SECONDS` | `3600` | |
| `JWT_SECRET` | `changeme` | change in production |
| `JWT_EXPIRES_IN` | `7d` | |
| `ADMIN_NAME/EMAIL/PASSWORD` | `Super Admin/admin@ttn.com/Admin@123` | seed only |

## Docker Infrastructure (global containers)
| Service | Container | Port |
|---------|-----------|------|
| PostgreSQL 16 | `global-postgres` | `5432` |
| Redis 7 | `global-redis` | `6379` |
| Adminer | `global-adminer` | `8080` |
| Redis UI | `global-redis-ui` | `8081` |

## Scripts
`npm run dev` · `npm run build` · `npm start` · `npm run lint:fix` · `npm run format`
`npm run db:migrate` · `npm run db:seed` · `npm run db:setup` · `npm test` · `npm run test:watch` · `npm run test:coverage`

## Agents & Automation
Sub-agents live in `.claude/agents/*.md` (auto-discovered — never registered in settings). They cannot call each other; the main session orchestrates the pipeline.

| Agent | Model | Role |
|-------|-------|------|
| `requirement-fetcher` | Haiku | Extract relevant spec from `requirements.md` + `task.md` (with done/pending status) |
| `feature-planner` | Sonnet | File-level plan → `.claude/plans/{slug}.md` (planning only) |
| `feature-implementer` | Sonnet | Implement from plan; run tsc/lint/test; check off `task.md` items |
| `code-reviewer` | Opus | Review a single-file diff against these conventions |
| `docs-updater` | Haiku | Update `CHANGELOG.md`, `README.md`, `CLAUDE.md` Plans/Scripts |
| `feature-doc-writer` | Sonnet | Write `documents/{slug}.md` feature reference |

- **`/build-feature <name>`** (`.claude/commands/build-feature.md`) runs the full chain: requirements → plan → implement → review → docs, with checkpoints after plan and after implementation.
- **`code-reviewer` is hook-driven**: `settings.json` `PostToolUse` → `.claude/hooks/file-review.sh` auto-reviews every `.ts`/`.js` Edit/Write. All other agents are invoked on demand via the Agent tool.
- **Settings split**: shared config (permissions, MCP servers, hooks) in committed `.claude/settings.json`; machine-specific bits in `.claude/settings.local.json`.

## Plans
`.claude/plans/backend-tooling.md` · `.claude/plans/backend-database.md` · `.claude/plans/backend-schema.md`
`.claude/plans/schema-alignment.md` · `.claude/plans/auth-validation-upload.md` · `.claude/plans/phase-0-gaps.md` · `.claude/plans/phase-1-schema-alignment.md` · `.claude/plans/tickets-module.md` · `.claude/plans/comments-module.md` · `.claude/plans/notifications-email.md` · `.claude/plans/attachments-module.md` · `.claude/plans/testing-strategy.md`
