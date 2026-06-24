# Security Rules

## Authentication
- JWT via `Authorization: Bearer <token>` header — never query string (appears in logs)
- Token signed with `config.jwt.secret`; expiry `config.jwt.expiresIn`
- `authenticate` middleware validates on every protected route
- User identity always derived from verified token — never trust `req.body.userId`

## Passwords
- Hash with `bcrypt` at 12 salt rounds (`SALT_ROUNDS = 12`)
- Never store or log plain-text passwords
- Never return `password_hash` in any response — always exclude from SELECT
- Compare with `bcrypt.compare(plain, hash)` — never re-hash and string-compare

## SQL Injection
Parameterized queries only (`$1, $2, ...`) — see `db-conventions.md`. String interpolation in SQL is never acceptable.

## Input Validation
- Validate all user input with `zod` at the route boundary (via `validateBody` middleware) before reaching services
- Reject extra fields (`.strip()` or `.strict()`), validate UUID path params, return `400` with field + reason
- `const body = schema.parse(req.body)` — `ZodError` is caught by `errorHandler` and becomes a `400` automatically
- Client validation is never trusted — server-side validation is always authoritative

## Role-Based Access Control
Roles: `ADMIN` > `AGENT`. Two roles only — no `user` role (requirements §4, RBAC-1).
Checks go in middleware (`requireRole`) — never in service code.

| Action | ADMIN | AGENT |
|--------|:-----:|:-----:|
| Create ticket | ✅ | ✅ |
| View all tickets | ✅ | ❌ (own only) |
| View own tickets (assigned or created) | ✅ | ✅ |
| Assign / reassign ticket | ✅ | ❌ |
| Transition status | ✅ | ✅ (assigned tickets only) |
| Add comment | ✅ | ✅ (accessible tickets only) |
| View all comments | ✅ | ❌ (accessible tickets only) |
| Upload / list / download attachments | ✅ | ✅ (accessible tickets only) |
| Delete attachment | ✅ | ✅ (own uploads only) |
| Manage users | ✅ | ❌ |

**Enforcement pattern:**
- Global role guard (`requireRole('ADMIN')`) applied at route level via middleware.
- Scope filtering (agent sees only own tickets) applied in the SQL `WHERE` clause inside the service — never by filtering in-memory after a full query.
- Authorization checked against the **verified JWT payload** — never against `req.body` fields.

## Secrets
- `JWT_SECRET`, `PG_PASSWORD`, `ADMIN_PASSWORD`, `S3_SECRET_ACCESS_KEY` must be long random strings in production
- Never log `config.jwt.secret` or any password/key field
- `.env` is gitignored — never commit it

## Error Responses
- Never leak stack traces or pg error text in production (`errorHandler` already gates on `NODE_ENV`)
- Return `"Internal Server Error"` for 500s — no internal details

## File Uploads
- Validate MIME type from multer's `file.mimetype` against a configured allowlist; reject with `415`
- Enforce per-file size limit and per-request file count via multer limits (stream-level, not post-read)
- Sanitize original filename with `sanitize-filename` before storing in Postgres — never trust the client name
- Storage keys are server-generated (UUID-based) — clients cannot influence the storage path (no path traversal)
- Never store file bytes in Redis; never serve raw `storage_key` values in API responses (internal only)

## Already Implemented
- `helmet` for HTTP security headers
- `express-rate-limit` on `/api/v1/auth/*`
- CORS: explicit `origin` from `CORS_ORIGIN` env — never wildcard `*` in production
- `passport-jwt` strategy + `authenticate` middleware for all protected routes
