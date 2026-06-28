# Plan: Auth Validation, File Upload & Security Middleware Infrastructure

> ### ⚠️ Reconciliation with requirements (2026-06-28)
> This plan was written early; parts have since diverged from the canonical spec and the as-built code. Treat the following as authoritative over the body below:
> - **No `/register` endpoint.** `requirements.md` DM-1 says users are **seeded only** — no user-management/registration API. The shipped `auth.routes.ts` correctly exposes only `POST /login` and `GET /me`. The `registerSchema`, `register()` service, and `POST /register` documented below were **not built** and must not be added.
> - **ENUM casing is uppercase.** The Zod example using `['low','medium','high','critical']` is stale. Use `['LOW','MEDIUM','HIGH','URGENT']` per §3.2 / `schema-alignment.md` (note `URGENT`, not `critical`).
> - **Upload middleware is superseded.** The disk-storage `upload.ts` (5 MB, JPEG/PNG/GIF/PDF hardcoded) described here is replaced by the **memory-storage, config-driven** version in `attachments-module.md` (env-driven MIME allowlist + size + per-request count, `415` on bad MIME). Use that plan for attachments.
> - Auth/JWT/bcrypt/helmet/cors/compression/rate-limit infrastructure below is accurate and shipped.

## Scope
Wired up Zod request validation, Passport-local + Passport-JWT authentication, bcrypt password hashing, JWT signing, Multer file uploads, a hardened global error handler, and security/performance middleware (helmet, cors, compression, express-rate-limit).

---

## Packages Added

### Auth & Validation
| Package | Type | Purpose |
|---------|------|---------|
| `zod` | dep | Schema-based request/response validation |
| `passport` | dep | Authentication framework |
| `passport-local` | dep | Email/password strategy — used only on login |
| `passport-jwt` | dep | JWT Bearer strategy — used on all protected routes |
| `multer` | dep | Multipart file upload handling |
| `jsonwebtoken` | dep | JWT signing and verification |
| `@types/passport` | devDep | TypeScript types |
| `@types/passport-local` | devDep | TypeScript types |
| `@types/passport-jwt` | devDep | TypeScript types |
| `@types/multer` | devDep | TypeScript types |
| `@types/jsonwebtoken` | devDep | TypeScript types |

`bcrypt` and `@types/bcrypt` were already present.

### Security & Performance
| Package | Type | Purpose |
|---------|------|---------|
| `helmet` | dep | Sets secure HTTP response headers (XSS, clickjacking, MIME sniffing) |
| `cors` | dep | Cross-origin resource sharing with explicit origin config |
| `compression` | dep | gzip response compression |
| `express-rate-limit` | dep | Rate limiting — applied to auth routes |
| `http-status-codes` | dep | Named HTTP status code constants for use across the codebase |
| `@types/cors` | devDep | TypeScript types |
| `@types/compression` | devDep | TypeScript types |

---

## Files Created

### `src/types/express.d.ts`
Global namespace augmentation — declares `Express.User` shape used by passport and auth controller.
```ts
interface Express.User { id, name, email, role, status }
```

### `src/config/passport.ts`
Registers two Passport strategies:

**LocalStrategy** (email/password — login only):
1. Queries DB: `SELECT id, name, email, password_hash, role, status FROM users WHERE email = $1`
2. Returns 401 info if user not found
3. Returns 401 info if `status = 'blocked'`
4. `bcrypt.compare(password, password_hash)` — returns 401 info on mismatch
5. Strips `password_hash` before calling `done(null, safeUser)` → populates `req.user`

**JwtStrategy** (Bearer token — all protected routes):
1. `ExtractJwt.fromAuthHeaderAsBearerToken()` — reads `Authorization: Bearer <token>`
2. Verifies signature with `config.jwt.secret`
3. Queries DB: `SELECT id, name, email, role, status FROM users WHERE id = $1` using `payload.sub`
4. Returns `done(null, false)` if user not found or `status = 'blocked'`
5. Returns `done(null, user)` on success → populates `req.user`

### `src/middlewares/authenticate.ts`
Route-level middleware wrapping the JWT strategy.
- Calls `passport.authenticate('jwt', { session: false }, callback)`
- On error: `next(err)`
- On missing/invalid token: `error(res, 'Unauthorized', 401); return`
- On success: sets `req.user = user` and calls `next()`

Usage: `router.get('/', authenticate, controller.getAll)`

### `src/middlewares/validateBody.ts`
Factory middleware: `validateBody(schema)`.
- Runs `schema.safeParse(req.body)`
- On failure: returns `400` with `field: message; field2: message2` string via `error()`
- On success: replaces `req.body` with the parsed (typed) data and calls `next()`

### `src/middlewares/upload.ts`
Multer disk storage configuration.
- Destination: `uploads/` (created with `mkdirSync` if missing)
- Filename: `{timestamp}-{random}{ext}`
- Filter: JPEG, PNG, GIF, PDF only — other types throw a 400 `AppError`
- Limit: 5 MB per file
- Export: `upload` (multer instance — use `.single()`, `.array()`, `.fields()`)

### `src/modules/auth/auth.schemas.ts`
Zod schemas + inferred types for the auth module.

```ts
registerSchema: { name: string(2–255), email: email, password: string(8–100) }
loginSchema:    { email: email, password: string(min 1) }

export type RegisterPayload = z.infer<typeof registerSchema>
export type LoginPayload    = z.infer<typeof loginSchema>
```

---

## Files Modified

### `src/middlewares/errorHandler.ts`
- **Fixed rule violation**: replaced `process.env.NODE_ENV` with `config.env`
- Added `ZodError` branch: formats `err.issues` into a `400` field-error string
- 5xx messages are hidden in production (`'Internal Server Error'`); full message shown in development
- Stack trace only appended in `development`

### `src/config/index.ts`
Added two new config sections:
- `cors.origin` — from `CORS_ORIGIN` env var, defaults to `http://localhost:5173`
- `rateLimit.windowMs` — from `RATE_LIMIT_WINDOW_MS`, defaults to `900000` (15 min)
- `rateLimit.max` — from `RATE_LIMIT_MAX`, defaults to `20` requests per window

### `src/app.ts`
Full middleware stack (in order):
1. `helmet()` — secure HTTP headers
2. `cors({ origin: config.cors.origin, credentials: true })` — explicit CORS
3. `compression()` — gzip responses
4. `morgan('dev')` — request logging
5. `express.json()` / `express.urlencoded()` — body parsing
6. `cookieParser()` — cookie parsing
7. `passport.initialize()` — passport session init
8. `authLimiter` on `/api/v1/auth/*` — rate limiter (20 req / 15 min)
9. Route mounts: `/api/v1/auth`, `/api/v1/users`, `/api/v1/tickets`
10. `errorHandler` — global 4-arg error handler (always last)

Rate limiter config (`authLimiter`):
```ts
rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
})
```

### `src/modules/auth/auth.routes.ts`
- `POST /register` → `validateBody(registerSchema)` → `controller.register`
- `POST /login` → `validateBody(loginSchema)` → custom passport callback → `controller.login`

The custom passport callback pattern keeps the `error()` envelope consistent:
```ts
passport.authenticate('local', { session: false }, (err, user, info) => {
  if (err)   return next(err);
  if (!user) { error(res, info?.message ?? 'Invalid credentials', 401); return; }
  req.user = user;
  next();
})(req, res, next);
```

### `src/modules/auth/auth.service.ts`
Replaced TODO stubs with real implementations:

**`register(payload)`**
1. Check `users` table for existing email → throw `409` if taken
2. `bcrypt.hash(password, 12)`
3. `INSERT INTO users` → return `id, name, email, role, status`

**`signToken(user)`**
1. `UPDATE users SET last_logged_in = NOW()` for the authenticated user
2. `jwt.sign({ sub: id, role }, secret, { expiresIn })` using `config.jwt.*`
3. Returns `{ token, user }`

### `src/modules/auth/auth.controller.ts`
- `register`: unchanged pattern — calls `authService.register(req.body)`, responds 201
- `login`: reads `req.user` (set by passport middleware), calls `authService.signToken(req.user)`, responds 200

---

## Auth Flow (Login)

```
POST /api/v1/auth/login
  │
  ├─ validateBody(loginSchema)          → 400 if email/password invalid shape
  │
  ├─ passport.authenticate('local')
  │     ├─ query DB by email            → 401 "Invalid email or password" if not found
  │     ├─ check status === 'active'    → 401 "Account is blocked" if blocked
  │     └─ bcrypt.compare              → 401 "Invalid email or password" if mismatch
  │         └─ done(null, safeUser) → req.user populated
  │
  └─ controller.login
        └─ authService.signToken(req.user)
              ├─ UPDATE last_logged_in
              └─ jwt.sign → { token, user }
```

---

## Usage: File Upload on a Route

```ts
import { upload } from '../../middlewares/upload';

// single file field named "attachment"
router.post('/', authenticate, upload.single('attachment'), controller.createOne);

// multiple files (up to 3)
router.post('/', authenticate, upload.array('files', 3), controller.createOne);
```

In the controller, the uploaded file is on `req.file` (single) or `req.files` (array/fields).
The path on disk is `req.file.path` (e.g. `uploads/1719234567890-123456789.pdf`).

---

## Usage: Zod Validation on Any Route

```ts
import { validateBody } from '../../middlewares/validateBody';
import { z } from 'zod';

const createTicketSchema = z.object({
  title:    z.string().min(1).max(500),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

router.post('/', authenticate, validateBody(createTicketSchema), controller.createOne);
```

`req.body` after `validateBody` is fully typed and safe — no need to validate again in the service.

---

## Constants & Limits

| Setting | Value | Location |
|---------|-------|----------|
| bcrypt salt rounds | `12` | `auth.service.ts` `SALT_ROUNDS` |
| Max file size | `5 MB` | `upload.ts` `MAX_FILE_SIZE_BYTES` |
| Allowed MIME types | JPEG, PNG, GIF, PDF | `upload.ts` `ALLOWED_MIME_TYPES` |
| Upload directory | `uploads/` | `upload.ts` `UPLOAD_DIR` |
| JWT expiry | `config.jwt.expiresIn` (default `7d`) | `config/index.ts` |
| CORS origin | `config.cors.origin` (default `http://localhost:5173`) | `config/index.ts` → `CORS_ORIGIN` |
| Rate limit window | `config.rateLimit.windowMs` (default `900000` ms / 15 min) | `config/index.ts` → `RATE_LIMIT_WINDOW_MS` |
| Rate limit max | `config.rateLimit.max` (default `20` req/window) | `config/index.ts` → `RATE_LIMIT_MAX` |

---

## Environment Variables (full list)

| Variable | Default | Notes |
|----------|---------|-------|
| `CORS_ORIGIN` | `http://localhost:5173` | Frontend origin; never use `*` in production |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window in ms (15 min) |
| `RATE_LIMIT_MAX` | `20` | Max auth requests per window |
