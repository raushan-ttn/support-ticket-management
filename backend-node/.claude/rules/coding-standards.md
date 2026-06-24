# Coding Standards

## Layer Rules (Monolith Modular)
- **Routes** — HTTP verb + path → controller method. No logic, no SQL, no imports from config
- **Controllers** — parse `req`, call one service method, send response via `success()`/`error()`. No SQL, no cache calls
- **Services** — all business logic, DB queries, cache interactions. No `req`/`res` references

Never skip a layer. SQL in a controller or route is a violation.

## File & Naming Conventions
| Token | Convention |
|-------|-----------|
| TS files | `camelCase` (`errorHandler.ts`, `ticket.service.ts`) |
| SQL files | `kebab-case` (`schema.sql`) |
| Variables / functions | `camelCase` |
| Interfaces | `PascalCase` (`RegisterPayload`) |
| True constants | `SCREAMING_SNAKE` (`SALT_ROUNDS`) |
| Env variables | `SCREAMING_SNAKE` (`PG_HOST`) |
| PostgreSQL columns / tables / ENUMs | `snake_case` |
| Redis keys | `{resource}:{id}` (prefix auto-added by ioredis) |

## Module Structure
- One module per domain entity: `auth`, `users`, `tickets`, `comments`
- Each module has exactly: routes + controller + service
- Shared logic → `src/utils/`; middleware → `src/middlewares/`

## Error Handling
- Controllers: `try/catch` everywhere; `next(err)` in catch — never `res.status(5xx)` in catch
- Services: throw errors with `statusCode` attached for domain errors (404, 403, 400)
- Never swallow errors with an empty catch

## Comments
Only when the **why** is non-obvious (hidden constraint, workaround, subtle invariant).
Never describe what the code does.

## Formatting (.prettierrc — enforced pre-commit)
`singleQuote: true` · `semi: true` · `trailingComma: all` · `printWidth: 100` · `tabWidth: 2`

## Linting (eslint.config.js — enforced pre-commit)
- `no-unused-vars` error — prefix unused params with `_`
- `no-explicit-any` warn — resolve before merging
- Auto-fix: `npm run lint:fix`
