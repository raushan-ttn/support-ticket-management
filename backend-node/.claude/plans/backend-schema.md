# Backend Schema — PostgreSQL Tables, Migration & Admin Seed

## Goal

Define the three core tables (`users`, `tickets`, `comments`) in the `ttn_stm` PostgreSQL database, provide an idempotent SQL migration file, and a TypeScript seeder that inserts the initial admin user.

---

## Files Added / Changed

```
backend-node/
├── src/
│   ├── config/
│   │   └── index.ts          ← updated: PG_DATABASE default → 'ttn_stm'
│   └── db/
│       ├── schema.sql        ← NEW: idempotent DDL (ENUMs, tables, indexes, trigger)
│       ├── migrate.ts        ← NEW: ts-node runner that executes schema.sql
│       └── admin-seed.ts     ← NEW: idempotent admin user seeder
├── .env                      ← updated: PG_DATABASE + ADMIN_* vars
└── .sample.env               ← updated: same vars with placeholders
```

---

## Database

| Setting  | Value        |
| -------- | ------------ |
| Host     | `localhost`  |
| Port     | `5432`       |
| User     | `postgres`   |
| Database | `ttn_stm`    |
| Container| `global-postgres` (shared Docker) |

---

## Schema

### ENUM Types

| Type              | Values                                       |
| ----------------- | -------------------------------------------- |
| `user_role`       | `admin`, `agent`, `user`                     |
| `user_status`     | `active`, `blocked`                          |
| `ticket_priority` | `low`, `medium`, `high`, `critical`          |
| `ticket_status`   | `open`, `in_progress`, `resolved`, `closed`  |

Declared with `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` so re-runs are safe.

---

### Table: `users`

| Column          | Type           | Constraints                          | Default              |
| --------------- | -------------- | ------------------------------------ | -------------------- |
| `id`            | `UUID`         | PK                                   | `gen_random_uuid()`  |
| `name`          | `VARCHAR(255)` | NOT NULL                             |                      |
| `email`         | `VARCHAR(255)` | NOT NULL, UNIQUE                     |                      |
| `password_hash` | `VARCHAR(255)` | NOT NULL                             |                      |
| `role`          | `user_role`    | NOT NULL                             | `'user'`             |
| `status`        | `user_status`  | NOT NULL                             | `'active'`           |
| `last_logged_in`| `TIMESTAMPTZ`  | nullable                             |                      |
| `created_at`    | `TIMESTAMPTZ`  | NOT NULL                             | `NOW()`              |

> Seeded only — no sign-up UI. Accounts are created by an admin.

---

### Table: `tickets`

| Column        | Type             | Constraints                              | Default             |
| ------------- | ---------------- | ---------------------------------------- | ------------------- |
| `id`          | `UUID`           | PK                                       | `gen_random_uuid()` |
| `title`       | `VARCHAR(500)`   | NOT NULL                                 |                     |
| `description` | `TEXT`           | nullable                                 |                     |
| `priority`    | `ticket_priority`| NOT NULL                                 | `'medium'`          |
| `status`      | `ticket_status`  | NOT NULL                                 | `'open'`            |
| `assigned_to` | `UUID`           | FK → `users.id` ON DELETE SET NULL       |                     |
| `created_by`  | `UUID`           | NOT NULL, FK → `users.id` ON DELETE RESTRICT |                 |
| `created_at`  | `TIMESTAMPTZ`    | NOT NULL                                 | `NOW()`             |
| `updated_at`  | `TIMESTAMPTZ`    | NOT NULL                                 | `NOW()`             |

> `updated_at` is maintained automatically by the `tickets_set_updated_at` trigger.

---

### Table: `comments`

| Column       | Type         | Constraints                              | Default             |
| ------------ | ------------ | ---------------------------------------- | ------------------- |
| `id`         | `UUID`       | PK                                       | `gen_random_uuid()` |
| `ticket_id`  | `UUID`       | NOT NULL, FK → `tickets.id` ON DELETE CASCADE |                |
| `message`    | `TEXT`       | NOT NULL                                 |                     |
| `created_by` | `UUID`       | NOT NULL, FK → `users.id` ON DELETE RESTRICT |               |
| `created_at` | `TIMESTAMPTZ`| NOT NULL                                 | `NOW()`             |

---

### Indexes

| Index                    | Table      | Column(s)     | Purpose                        |
| ------------------------ | ---------- | ------------- | ------------------------------ |
| `idx_tickets_status`     | `tickets`  | `status`      | Filter by status               |
| `idx_tickets_priority`   | `tickets`  | `priority`    | Filter by priority             |
| `idx_tickets_created_by` | `tickets`  | `created_by`  | Tickets by reporter            |
| `idx_tickets_assigned_to`| `tickets`  | `assigned_to` | Tickets by assignee            |
| `idx_comments_ticket_id` | `comments` | `ticket_id`   | All comments on a ticket       |
| `idx_comments_created_by`| `comments` | `created_by`  | Comments by a specific user    |

---

### Trigger

`tickets_set_updated_at` — fires `BEFORE UPDATE` on `tickets`, sets `NEW.updated_at = NOW()`.
Declared with `DROP TRIGGER IF EXISTS` + `CREATE OR REPLACE FUNCTION` so re-runs are safe.

---

## Migration Runner (`src/db/migrate.ts`)

Reads `schema.sql` as a string and executes it via a raw `pg.PoolClient` (simple query protocol supports multiple statements). Closes the pool when done.

```bash
npm run db:migrate
```

---

## Admin Seed (`src/db/admin-seed.ts`)

Idempotent: checks `SELECT id FROM users WHERE email = $1` before inserting.

| Step | Action |
|------|--------|
| 1 | Read `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` from env |
| 2 | Query for existing admin by email |
| 3 | If found → log and skip |
| 4 | Hash password with `bcrypt` (12 salt rounds) |
| 5 | `INSERT INTO users ... RETURNING id` with role `'admin'`, status `'active'` |

```bash
npm run db:seed
```

---

## npm Scripts

| Script        | Command                                      | Purpose                        |
| ------------- | -------------------------------------------- | ------------------------------ |
| `db:migrate`  | `ts-node src/db/migrate.ts`                  | Apply `schema.sql`             |
| `db:seed`     | `ts-node src/db/admin-seed.ts`               | Insert admin user (idempotent) |
| `db:setup`    | `npm run db:migrate && npm run db:seed`      | Full fresh setup in one shot   |

---

## Environment Variables Added

```
# PostgreSQL (updated)
PG_DATABASE=ttn_stm

# Admin Seed
ADMIN_NAME=Super Admin
ADMIN_EMAIL=admin@ttn.com
ADMIN_PASSWORD=Admin@123          # .env only — placeholder in .sample.env
```

---

## Key Decisions

- **UUID PKs with `gen_random_uuid()`** — built-in to Postgres 13+, no extension needed, better for distributed inserts than sequential integers.
- **ENUM types over CHECK constraints** — self-documenting, enforced at DB level, easily extended via `ALTER TYPE`.
- **`ON DELETE SET NULL` for `assigned_to`** — deleting an agent un-assigns their tickets rather than blocking the delete or cascading.
- **`ON DELETE RESTRICT` for `created_by`** — prevent deleting a user who owns tickets/comments; must re-assign ownership first.
- **`ON DELETE CASCADE` for `comments.ticket_id`** — deleting a ticket wipes its comments; comments have no standalone meaning.
- **Trigger for `updated_at`** — DB-level guarantee that `updated_at` is always accurate regardless of which service layer updates the row.
- **`bcrypt` with 12 rounds** — industry-standard; ~300ms hash time on modern hardware is acceptable for login, not for bulk ops.
- **Idempotent migration** — `IF NOT EXISTS` + ENUM exception handling + `DROP TRIGGER IF EXISTS` means `db:migrate` is safe to re-run without wiping data.

---

## Next Steps

- [ ] Wire `query()` calls into `users`, `tickets`, `comments` service files (replace stubs)
- [ ] Implement login endpoint: verify password with `bcrypt.compare`, sign JWT, update `last_logged_in`
- [ ] Add `authenticate` middleware to protect routes
- [ ] Role-based access control (admin / agent / user guards)
- [ ] Input validation with `zod` on all create/update endpoints
- [ ] Add future migrations as versioned SQL files (e.g. `001_initial.sql`, `002_add_tags.sql`)
- [ ] Tests — Jest + Supertest against a dedicated `ttn_stm_test` database
