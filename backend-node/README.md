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
- Ticket creation, assignment, and status transitions
- Comments and real-time notifications
- File attachments with storage backend abstraction
- JWT-based session management with Passport
- Redis caching for read-heavy operations
- Email notifications via BullMQ job queue

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

## API Overview

<!-- endpoint table maintained by docs-updater -->

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/v1/auth/register` | Create a new user account |
| `POST` | `/api/v1/auth/login` | Authenticate and receive JWT |
| `GET` | `/api/v1/users` | List all users (ADMIN only) |
| `GET` | `/api/v1/users/:id` | Fetch user profile |
| `POST` | `/api/v1/tickets` | Create a new ticket |
| `GET` | `/api/v1/tickets` | List tickets (filtered by role) |
| `GET` | `/api/v1/tickets/:id` | Fetch ticket details |
| `PATCH` | `/api/v1/tickets/:id` | Update ticket (status, priority) |
| `POST` | `/api/v1/tickets/:id/assign` | Assign ticket to agent (ADMIN only) |
| `POST` | `/api/v1/tickets/:id/comments` | Add comment to ticket |
| `GET` | `/api/v1/tickets/:id/comments` | List ticket comments |
| `POST` | `/api/v1/tickets/:id/attachments` | Upload file attachment |
| `GET` | `/api/v1/tickets/:id/attachments` | List ticket attachments |
| `GET` | `/api/v1/attachments/:id/download` | Download attachment |
| `DELETE` | `/api/v1/attachments/:id` | Delete attachment |

## Environment Variables

See `.sample.env` for a complete list. Key variables:

- `NODE_ENV` — `development`, `test`, or `production`
- `PORT` — HTTP server port (default: 3000)
- `PG_*` — PostgreSQL connection parameters
- `REDIS_*` — Redis cache parameters
- `JWT_SECRET` — Secret key for JWT signing (change in production)
- `CORS_ORIGIN` — Allowed origin for CORS (never wildcard in production)

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
