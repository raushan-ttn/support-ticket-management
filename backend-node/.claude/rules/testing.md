# Testing Rules

## Stack
`jest` + `supertest` + `ts-jest` + `@types/jest` + `@types/supertest`

Install: `npm install --save-dev jest supertest ts-jest @types/jest @types/supertest`

## Test Database
- Dedicated DB: `ttn_stm_test` (never run tests against `ttn_stm`)
- Set `NODE_ENV=test` — config routes to test DB automatically
- Run `npm run db:migrate` with `PG_DATABASE=ttn_stm_test` before first run
- `afterEach`: `TRUNCATE comments, tickets, users RESTART IDENTITY CASCADE`
- `afterAll`: `pool.end()`

## File Location
Co-locate with source:
```
src/modules/tickets/
  ticket.service.ts
  ticket.service.test.ts      ← unit (mock DB)
  ticket.controller.test.ts   ← integration (supertest)
```

## Test Types
**Unit (services)** — mock `query` from `src/config/postgres.ts` with `jest.mock`.
Test: happy path, not-found/null, business rule violations, edge cases (empty array, null fields).

**Integration (controllers)** — use `supertest(app)`, hit real test DB.
Test: correct status codes, response envelope shape, 404 on missing, 401/403 on protected routes.

**Middleware** — 100% coverage required.
Test `errorHandler`: correct status from `err.statusCode`, no stack in production.
Test `authenticate`: rejects missing/invalid/expired tokens.

## Assertion Order
Always assert status code first — a wrong status makes all other assertions misleading:
```ts
expect(res.status).toBe(200);
expect(res.body.success).toBe(true);
expect(res.body.data).toMatchObject({ title: 'Test' });
```

## Test Data
Use factory functions in `tests/factories.ts` — never inline literals across test files.

## Jest Config (package.json)
```json
"jest": {
  "preset": "ts-jest",
  "testEnvironment": "node",
  "setupFilesAfterFramework": ["./jest.setup.ts"],
  "testMatch": ["**/*.test.ts"],
  "collectCoverageFrom": ["src/**/*.ts", "!src/db/**"]
}
```
Scripts: `"test": "jest"` · `"test:watch": "jest --watch"` · `"test:coverage": "jest --coverage"`

## Coverage Targets
| Layer | Minimum |
|-------|---------|
| Services | 90% |
| Controllers | 80% |
| Middleware / Utils | 100% |
