# API Conventions

Covers: URL design, HTTP semantics, response shape, Zod validation, TypeScript style, code structure, and testing.

---

## URL Structure
- Base: `/api/v1/{resource}` — plural nouns, kebab-case, no verbs
- Health check: `GET /health` (outside versioned prefix)
- Nested: `GET /api/v1/tickets/:id/comments`

## HTTP Methods
| Operation | Method | Success code |
|-----------|--------|-------------|
| List | `GET /` | 200 |
| Get single | `GET /:id` | 200 / 404 |
| Create | `POST /` | 201 |
| Full replace | `PUT /:id` | 200 |
| Partial update | `PATCH /:id` | 200 |
| Delete | `DELETE /:id` | 204 (no body) |

## Response Envelope (fixed — never deviate)
```
Success: { "success": true,  "data": <payload|null|[]> }
Error:   { "success": false, "message": "<string>", "code"?: "<string>" }
```
Use `success(res, data, httpCode?)` / `error(res, message, httpCode?, code?)` from `src/utils/response.ts`. Never call `res.json()` directly.

## Status Codes
| Scenario | Code |
|----------|------|
| Missing/invalid token | 401 |
| Insufficient role | 403 |
| Not found | 404 |
| Validation failure | 400 |
| Invalid status transition | 409 |
| Unsupported file MIME type | 415 |
| Server error | 500 |

## Error Codes
| Code | Scenario |
|------|---------|
| `INVALID_STATUS_TRANSITION` | Transition not in the state machine allowed set |
| `NOT_FOUND` | Resource does not exist |
| `FORBIDDEN` | Caller lacks permission |
| `USER_NOT_FOUND` | `assignedTo` UUID references a non-existent user |
| `VALIDATION_ERROR` | Zod parse failure |
| `INVALID_COMMENT_REFERENCE` | `commentId` doesn't belong to the parent ticket |

Usage: `error(res, 'Invalid status transition', 409, 'INVALID_STATUS_TRANSITION')`

## Query Filters (list endpoints)
`?status=OPEN&priority=HIGH&assignedTo=<uuid>&page=1&limit=20&sortBy=createdAt&order=desc`
- Keys `camelCase`; ENUM values uppercase to match DB
- `page` 1-based; `limit` default 20, max 100

## File Upload Endpoints
- Accept `multipart/form-data` via `upload.array('files', maxCount)` — never return `storage_key`
- Download: `stream.pipe(res)` with `Content-Type` + `Content-Disposition` — never buffer in memory

## Versioning
Never modify `v1` endpoints in a breaking way — add `v2` mounted alongside.

## Middleware Order in `app.ts` (fixed)
`helmet` → `cors` → `compression` → `morgan` → `express.json` → `express.urlencoded` → `cookieParser` → `passport.initialize` → `authLimiter` (`/api/v1/auth/*`) → routes → **`errorHandler` (last)**

## Route File Pattern
```ts
router.get('/', authenticate, validateQuery(listSchema), controller.list);
router.post('/', authenticate, validateBody(createSchema), controller.create);
router.post('/:id/assign', authenticate, requireRole('ADMIN'), validateBody(assignSchema), controller.assign);
```
`authenticate` + `requireRole` + `validateBody`/`validateQuery` are route-level middleware — never inside controllers.

---

## Zod Validation

All schemas in `src/modules/{module}/{module}.schemas.ts`. Validated input replaces `req.body`/`req.query` before the controller.

```ts
import { z } from 'zod';

// Body schemas — covers: required string, optional enum with default, .refine, uuid
export const createTicketSchema = z.object({
  title:       z.string().trim().min(1).max(500),
  description: z.string().trim().min(1),
  priority:    z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
});

export const updateTicketSchema = z.object({
  title:    z.string().trim().min(1).max(500).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field required' });

// Query schema — z.coerce.number() required: Express query strings are always `string`
export const listTicketsQuerySchema = z.object({
  status:   z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  search:   z.string().trim().max(200).optional(),
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(20),
  sortBy:   z.enum(['createdAt', 'updatedAt', 'priority']).default('createdAt'),
  order:    z.enum(['asc', 'desc']).default('desc'),
});

// Infer types — never define separately from schemas
export type CreateTicketPayload = z.infer<typeof createTicketSchema>;
export type ListTicketsQuery    = z.infer<typeof listTicketsQuerySchema>;
```

### Path Parameters

```ts
// src/utils/zodHelpers.ts — throws ZodError → errorHandler → 400
export const uuidParam = z.string().uuid({ message: 'Invalid UUID' });
// In controller: const id = uuidParam.parse(req.params.id);
```

### Response Types

Internal data only — plain TypeScript interfaces, not Zod:

```ts
export interface TicketRow {
  id: string; title: string; description: string;
  priority: TicketPriority; status: TicketStatus;
  assignedTo: string; createdBy: string; createdAt: string; updatedAt: string;
}
// Use as generic: query<TicketRow>('SELECT id, title, ... FROM tickets WHERE ...', [id])
```

### `validateBody` / `validateQuery`

```ts
export const validateBody = (schema: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);  // validateQuery uses req.query
    if (!result.success) {
      const message = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      error(res, message, 400, 'VALIDATION_ERROR'); return;
    }
    req.body = result.data;
    next();
  };
```

### Rules
- `z.coerce.number()` for all numeric query params — never `parseInt` (query strings are always `string`)
- `.trim().min(1)` on all string inputs — rejects whitespace-only
- `.default()` on optional fields — services never receive `undefined`
- `z.infer<typeof schema>` for types — never define separately from schemas
- `safeParse` in middleware; `.parse()` for path params only (throws ZodError → errorHandler → 400)

---

## Layer Rules

| Layer | Responsibility | Forbidden |
|-------|---------------|-----------|
| **Routes** | HTTP verb + path → middleware chain → controller | Logic, SQL, config imports |
| **Controllers** | Parse `req`, call one service method, send response | SQL, cache calls, `res.json()` in catch |
| **Services** | Business logic, DB queries, cache, direct notification sends | `req`, `res` references |
| **Storage** | Read/write bytes to backend | Business logic, DB queries |

SQL in a controller or route is a violation. Notification sends are in services only, fire-and-forget (try/catch; never re-throw).

## Module Structure

```
src/modules/{module}/
  {module}.routes.ts      → route definitions + middleware
  {module}.controller.ts  → req → service → success()/error()
  {module}.service.ts     → business logic + DB/cache/notification calls
  {module}.schemas.ts     → Zod schemas + inferred types + response interfaces
  {module}.middleware.ts  → middleware coupled to this module's schemas (optional —
                             e.g. a multer config that imports the module's mime
                             allowlist); module-independent middleware never goes here

src/jobs/
  mailer.ts / notifications.ts

src/storage/
  index.ts (IStorageBackend + factory) / local.ts / s3.ts
```

Modules: `auth`, `users`, `tickets`, `comments`, `attachments`. Shared logic → `src/utils/`.

**Middleware placement:** `src/middlewares/` holds only middleware with zero module imports (`authenticate`, `errorHandler`, `requireRole`, `validateBody`, `validateQuery`). Middleware that imports from a specific module (e.g. that module's `.schemas.ts`) belongs in that module as `{module}.middleware.ts`, not in `src/middlewares/`.

## File & Naming Conventions

| Token | Convention |
|-------|-----------|
| TS files | `camelCase` (`ticket.service.ts`) |
| SQL files | `kebab-case` (`schema.sql`) |
| Variables / functions | `camelCase` |
| Interfaces | `PascalCase` — never `I`-prefix |
| Constants | `SCREAMING_SNAKE` |
| Env variables | `SCREAMING_SNAKE` |
| PG columns / tables / ENUMs | `snake_case` |
| Redis keys | `{resource}:{id}` |

## Error Handling
- Controllers: `try/catch` → `next(err)` in catch — never `res.status(5xx).json()`
- Services: throw with `statusCode` for domain errors (`400`, `403`, `404`, `409`)
- Always `return` after `error(res, ...)` to prevent double-send

## Comments
Only when the **why** is non-obvious. Never describe what the code does.

## Formatting & Linting
- Prettier (pre-commit): `singleQuote: true`, `semi: true`, `trailingComma: all`, `printWidth: 100`, `tabWidth: 2`
- ESLint: `no-unused-vars` error (prefix with `_`), `no-explicit-any` warn. Fix: `npm run lint:fix`

---

## TypeScript

- `strict: true` — never disable; `target: ES2020`, `module: commonjs`, `esModuleInterop: true`, output to `dist/`
- Controllers always `Promise<void>`; use `interface` for shapes, `type` for unions only
- No `any` — use `unknown` + type guards. No `!` without proof — prefer `?.`
- Guard pg `rowCount`: `if (result.rowCount && result.rowCount > 0)`
- All I/O: `async/await` — no callbacks or `.then()`. Exception: notification sends (`sendNewTicketEmail()`, `sendCommentNotificationEmail()`) are fire-and-forget
- Imports: ES `import` only; group built-ins → third-party → internal; `* as` for services; destructure for types

**Exports:**
| Layer | Style |
|-------|-------|
| Router, App, Middleware, Config | `export default` |
| Controllers, Services, Utils, DB helpers | Named exports |

Never mix in one file.

---

## Testing

**Stack:** `jest` + `supertest` + `ts-jest` (co-located `*.test.ts`)

**Test DB:** `ttn_stm_test` — never `ttn_stm`. `NODE_ENV=test` routes automatically.
- `afterEach`: `TRUNCATE attachments, comments, tickets, users RESTART IDENTITY CASCADE`
- `afterAll`: `pool.end()`

**File location:** co-locate with source (`ticket.service.test.ts`, `ticket.controller.test.ts`)

**Test types:**
- **Unit (services):** `jest.mock` on `query` from `src/config/postgres.ts` — happy path, nulls, violations
- **Integration (controllers):** `supertest(app)` + real test DB — status codes, envelope shape, 401/403
- **Middleware:** 100% coverage — `errorHandler` (statusCode mapping, no stack in prod), `authenticate` (missing/invalid/expired)
- **Job workers:** call handler functions directly (bypass queue); `jsonTransport` for email capture

**Assertion order** — always status code first:
```ts
expect(res.status).toBe(200);
expect(res.body.success).toBe(true);
expect(res.body.data).toMatchObject({ title: 'Test' });
```

**Test data:** factory functions in `tests/factories.ts` — never inline literals.

**Jest config (`package.json`):**
```json
"jest": { "preset": "ts-jest", "testEnvironment": "node",
  "setupFilesAfterFramework": ["./jest.setup.ts"],
  "testMatch": ["**/*.test.ts"],
  "collectCoverageFrom": ["src/**/*.ts", "!src/db/**"] }
```
Scripts: `"test": "jest"` · `"test:watch": "jest --watch"` · `"test:coverage": "jest --coverage"`

**Coverage targets:**
| Layer | Minimum |
|-------|---------|
| Services | 90% |
| Controllers | 80% |
| Middleware / Utils | 100% |
| Job workers | 80% |

### Notification Tests (TEST-7)
`NODE_ENV=test` activates `jsonTransport`; call `sendNewTicketEmail()` / `sendCommentNotificationEmail()` directly (no queue/worker). Assert:
- New-ticket send goes to creator + admin; de-duplicated if same person
- Comment-notification excludes the comment author; correct recipient set for all role combos

### Attachment Tests (TEST-9)
`STORAGE_BACKEND=local`, `STORAGE_LOCAL_DIR=.tmp/test-uploads`; clean up in `afterAll`. Assert:
- Allowed MIME + within size → `201`; `storageKey` absent from response
- Disallowed MIME → `415`; oversize → `400`; over file count → `400`
- Download → `200` with correct `Content-Type` + `Content-Disposition: attachment`
- Caller without ticket access → `403` on list/download
- Delete by non-uploader non-admin → `403`; by uploader → `204`
