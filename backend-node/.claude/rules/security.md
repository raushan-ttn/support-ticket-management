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
Parameterized queries only (`$1, $2, ...`) — see `database.md`. String interpolation in SQL is never acceptable.

## Input Validation (implement with `zod`)
- Validate all user input at the controller boundary before reaching services
- Reject extra fields (`strict()` mode), validate UUID path params, return 400 with field + reason
- `const body = schema.parse(req.body)` — ZodError becomes a 400 automatically

## Role-Based Access Control
Roles: `admin` > `agent` > `user`. Checks go in middleware — never in service code.

| Action | admin | agent | user |
|--------|:-----:|:-----:|:----:|
| Create ticket | ✅ | ✅ | ✅ |
| View all tickets | ✅ | ✅ | ❌ |
| Assign ticket | ✅ | ✅ | ❌ |
| Close / resolve | ✅ | ✅ | ❌ |
| Delete ticket | ✅ | ❌ | ❌ |
| Manage users | ✅ | ❌ | ❌ |

## Secrets
- `JWT_SECRET`, `PG_PASSWORD`, `ADMIN_PASSWORD` must be long random strings in production
- Never log `config.jwt.secret` or any password field
- `.env` is gitignored — never commit it

## Error Responses
- Never leak stack traces or pg error text in production (`errorHandler` already gates on `NODE_ENV`)
- Return `"Internal Server Error"` for 500s — not internal details

## Future (add when implementing)
- `helmet` for HTTP security headers
- `express-rate-limit` on `/auth/login` and `/auth/register`
- CORS: explicit `origin` — never wildcard `*` in production
