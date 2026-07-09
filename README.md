# Support Ticket Management — Backend API

Node.js 24 · Express 4 · TypeScript strict · PostgreSQL 16 · Redis 7

## Setup

```bash
npm install
npm run db:setup   # migrate + seed
npm run dev
```

## Features

<!-- feature list maintained by docs-updater -->

- User authentication and role-based access control (ADMIN, AGENT)
- Ticket lifecycle management: creation, listing, retrieval, updates, assignment, and state machine status transitions
- Comment threads per ticket, with user attribution (`createdByName`) and inline file attachments
- File attachments (image/jpeg, image/png only) — multiple files per ticket or per comment; uploaded inline via `multipart/form-data` on ticket create/update and comment creation, no standalone attachment endpoints. Attachment metadata (`id`, `filename`, `mimeType`, `sizeBytes`, `uploadedBy`, `createdAt`, `url`) is embedded in ticket and comment responses; `storageKey` is never exposed. `url` is an absolute, browser-openable URL (`APP_URL` + storage key for local dev, S3 object URL for prod). Local filesystem (dev, served via `express.static`) or S3 (prod) storage backend, selected via `STORAGE_BACKEND`
- JWT-based session management with Passport
- Redis caching for read-heavy operations, including per-ticket attachment metadata (`ticket:{id}:attachments`)
- Email notifications (planned): direct SMTP/nodemailer send, fire-and-forget, no job queue, for new tickets and comments — see `.claude/plans/notifications-email.md`. Auto-close-on-stale-reply is out of scope (would have required a BullMQ delayed-job queue).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start dev server with hot reload (nodemon) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled server (production) |
| `npm run lint:fix` | Fix ESLint violations |
| `npm run format` | Format code with Prettier |
| `npm run db:migrate` | Run database migrations |
| `npm run db:seed` | Seed admin user |
| `npm run db:setup` | Migrate + seed (first time setup) |
| `npm test` | Run Jest test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Generate coverage report |

## API Documentation

Interactive API documentation is available via **Swagger UI** at `GET /api-docs` after starting the server. The raw OpenAPI 3.0.3 schema is served at `GET /api-docs.json` for client SDK generation and integrations.

## API Overview

<!-- endpoint table maintained by docs-updater -->

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/v1/auth/register` | Create a new user account |
| `POST` | `/api/v1/auth/login` | Authenticate and receive JWT |
| `GET` | `/api/v1/users` | List all users (ADMIN only) |
| `GET` | `/api/v1/users/:id` | Fetch user profile |
| `POST` | `/api/v1/tickets` | Create a new ticket; accepts optional `files` (image/jpeg, image/png, multipart/form-data) as ticket-level attachments |
| `GET` | `/api/v1/tickets` | List tickets (filtered by role) |
| `GET` | `/api/v1/tickets/:id` | Fetch ticket details, including inline `attachments` array |
| `PATCH` | `/api/v1/tickets/:id` | Update ticket title, description, or priority; accepts optional `files` to add further ticket-level attachments |
| `PATCH` | `/api/v1/tickets/:id/status` | Transition ticket status through valid state machine paths |
| `POST` | `/api/v1/tickets/:id/assign` | Assign ticket to user (ADMIN only) |
| `POST` | `/api/v1/tickets/:ticketId/comments` | Add comment to ticket with optional comment-level attachments (`files`, image/jpeg or image/png, multipart/form-data) |
| `GET` | `/api/v1/tickets/:ticketId/comments` | List ticket comments ordered by creation time, each with an inline `attachments` array; RBAC-scoped; Redis-cached |
| `GET` | `/api/v1/tickets/:ticketId/comments/:commentId` | Fetch single comment by ID, including inline `attachments` array; RBAC-scoped |

There are no standalone `/api/v1/attachments/*` endpoints — attachments are uploaded as part of the ticket/comment mutation endpoints above and accessed via the `url` field embedded in ticket/comment responses (served directly from the storage backend; local dev via `express.static`, S3 via object URL in prod).

## Environment Variables

See `.sample.env` for a complete list. Key variables:

- `NODE_ENV` — `development`, `test`, or `production`
- `PORT` — HTTP server port (default: 3000)
- `PG_*` — PostgreSQL connection parameters
- `REDIS_*` — Redis cache parameters
- `JWT_SECRET` — Secret key for JWT signing (change in production)
- `CORS_ORIGIN` — Allowed origin for CORS (never wildcard in production)
- `APP_URL` — base URL used to build absolute attachment `url`s for the local storage backend (default: `http://localhost:{PORT}`)
- `STORAGE_BACKEND` — `local` (default) or `s3`; selects the attachment storage backend
- `STORAGE_LOCAL_DIR` — local storage root (default: `public`), served statically at `/`
- `S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_ENDPOINT` — S3-compatible storage config (used when `STORAGE_BACKEND=s3`)
- `ATTACHMENT_MAX_FILE_SIZE_BYTES` — per-file size limit for attachments (default: 10 MB)
- `ATTACHMENT_MAX_FILES_PER_REQUEST` — per-request attachment file count limit (default: 5)

## Testing

```bash
npm test              # Run all tests
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report
```

Tests use SQLite in-memory database (`NODE_ENV=test`) and Jest with supertest for HTTP assertions. See `.claude/rules/api-conventions.md` for testing conventions.

## Documentation

- **Architecture & conventions:** `CLAUDE.md`
- **Security & RBAC rules:** `.claude/rules/security.md`
- **API & TypeScript rules:** `.claude/rules/api-conventions.md`
- **Database & cache rules:** `.claude/rules/db-conventions.md`
- **Change history:** `CHANGELOG.md`
