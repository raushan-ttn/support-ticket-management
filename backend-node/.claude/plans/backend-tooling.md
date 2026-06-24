# Backend Tooling Setup — TypeScript, ESLint, Prettier, Husky

## Goal

Setup the Express.js monolith (previously plain JavaScript from express-generator) to **TypeScript**, and configure **ESLint**, **Prettier**, and **Husky** with `lint-staged` for a consistent, type-safe development workflow.

---

## What Changed

### JS → TS Migration

All source files converted from CommonJS `.js` to ES-module-style `.ts` with strict typing. Old `.js` files deleted.

### Project Structure (post-migration)

```
backend-node/
├── bin/
│   └── www.ts                        ← HTTP server entry point (typed)
├── src/
│   ├── app.ts                        ← Express app
│   ├── config/
│   │   └── index.ts                  ← Typed Config interface, reads .env
│   ├── middlewares/
│   │   └── errorHandler.ts           ← AppError interface, 4-arg handler
│   ├── utils/
│   │   └── response.ts               ← Typed success / error helpers
│   └── modules/
│       ├── auth/
│       │   ├── auth.routes.ts
│       │   ├── auth.controller.ts
│       │   └── auth.service.ts       ← RegisterPayload / LoginPayload interfaces
│       ├── users/
│       │   ├── user.routes.ts
│       │   ├── user.controller.ts
│       │   └── user.service.ts       ← UserPayload interface
│       └── tickets/
│           ├── ticket.routes.ts
│           ├── ticket.controller.ts
│           └── ticket.service.ts     ← TicketPayload / TicketFilters interfaces
├── dist/                             ← Compiled output (gitignored)
├── .husky/
│   └── pre-commit                    ← Runs lint-staged before every commit
├── tsconfig.json
├── eslint.config.js                  ← ESLint v10 flat config
├── .prettierrc
├── .prettierignore
├── nodemon.json
└── package.json
```

---

## Configuration Files

### `tsconfig.json`

| Option            | Value      | Reason                                  |
| ----------------- | ---------- | --------------------------------------- |
| `target`          | `ES2020`   | Modern JS output                        |
| `module`          | `commonjs` | Node.js compatible                      |
| `outDir`          | `./dist`   | Compiled output                         |
| `rootDir`         | `./`       | Covers both `bin/` and `src/`           |
| `strict`          | `true`     | Full type safety                        |
| `esModuleInterop` | `true`     | Clean default imports from CJS packages |
| `sourceMap`       | `true`     | Debuggable output                       |

### `eslint.config.js` (flat config — required for ESLint v10+)

- Parser: `@typescript-eslint/parser`
- Plugin: `@typescript-eslint`
- Extends: `plugin:@typescript-eslint/recommended` + `eslint-config-prettier`
- Key rules: `no-unused-vars` (ignores `_` prefix args), `no-explicit-any` warn

### `.prettierrc`

```json
{
  "semi": true,
  "trailingComma": "all",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}
```

### `nodemon.json`

Watches `src/` and `bin/` for `.ts` changes, executes via `ts-node`.

### `.husky/pre-commit`

Runs `npx lint-staged` from `backend-node/` before every commit.

> Note: `.git` root is at parent `support-ticket-management/` — `git config core.hooksPath` is set to `backend-node/.husky` to bridge this.

### `lint-staged` (in `package.json`)

Runs on staged `*.ts` files: ESLint auto-fix → Prettier write.

---

## npm Scripts

| Script         | Command                                        | Purpose                              |
| -------------- | ---------------------------------------------- | ------------------------------------ |
| `dev`          | `nodemon`                                      | Hot-reload dev server via ts-node    |
| `build`        | `tsc`                                          | Compile to `dist/`                   |
| `start`        | `node dist/bin/www.js`                         | Run compiled production build        |
| `lint`         | `eslint . --ext .ts`                           | Check all TypeScript files           |
| `lint:fix`     | `eslint . --ext .ts --fix`                     | Auto-fix ESLint issues               |
| `format`       | `prettier --write "src/**/*.ts" "bin/**/*.ts"` | Format all files                     |
| `format:check` | `prettier --check ...`                         | CI formatting check                  |
| `prepare`      | `cd .. && husky backend-node/.husky`           | Install Husky hooks on `npm install` |

---

## Dependencies Added

### Dev

| Package                            | Version | Purpose                                           |
| ---------------------------------- | ------- | ------------------------------------------------- |
| `typescript`                       | `^6`    | TypeScript compiler                               |
| `ts-node`                          | `^10`   | Run `.ts` files directly                          |
| `@types/node`                      | `^26`   | Node.js type definitions                          |
| `@types/express`                   | `^4.17` | Express 4 types (pinned to v4 to match Express 4) |
| `@types/cookie-parser`             | `^1.4`  | cookie-parser types                               |
| `@types/morgan`                    | `^1.9`  | morgan types                                      |
| `@types/debug`                     | `^4.1`  | debug types                                       |
| `eslint`                           | `^10`   | Linter                                            |
| `@typescript-eslint/parser`        | `^8`    | TS-aware ESLint parser                            |
| `@typescript-eslint/eslint-plugin` | `^8`    | TS lint rules                                     |
| `eslint-config-prettier`           | `^10`   | Disables ESLint rules that conflict with Prettier |
| `prettier`                         | `^3`    | Code formatter                                    |
| `husky`                            | `^9`    | Git hooks manager                                 |
| `lint-staged`                      | `^17`   | Run linters on staged files only                  |

---

## Key Decisions

- **`@types/express@4` not `@5`** — Express v4 is installed; using v5 types causes `req.params.id` to infer as `string | string[]` under strict mode.
- **ESLint flat config** — ESLint v10 dropped support for `.eslintrc.*`; `eslint.config.js` with CommonJS `module.exports` is used (no `"type": "module"` in `package.json`).
- **Husky in nested package** — since `.git` lives one level up from `backend-node/`, `git config core.hooksPath backend-node/.husky` is set and `prepare` script does `cd .. && husky backend-node/.husky`.
- **`_` prefix convention** — unused handler parameters prefixed with `_` (e.g. `_req`, `_next`, `_filters`) to satisfy ESLint's `no-unused-vars` without disabling the rule.

---

## Next Steps

- [ ] Add database integration (Mongoose)
  - [ ] Define `User` and `Ticket` Mongoose models with TypeScript interfaces
  - [ ] Wire models into service files
- [ ] Implement authentication
  - [ ] Hash passwords with `bcrypt` (`@types/bcrypt`)
  - [ ] Sign JWTs with `jsonwebtoken` (`@types/jsonwebtoken`)
  - [ ] `authenticate` middleware for protected routes
- [ ] Input validation — `zod` or `express-validator` with TypeScript support
- [ ] Role-based access control (admin / agent / user)
- [ ] Pagination on list endpoints
- [ ] Tests — Jest + Supertest (`ts-jest` for TypeScript)
- [ ] Update the initial-setup plan's "Next Steps" to mark linter/formatter as done
