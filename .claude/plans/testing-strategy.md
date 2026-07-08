# Plan: Testing Strategy (Phase 9)

> **Requirements:** TEST-1 … TEST-7, TEST-9, NFR-2/3, plus the per-module acceptance criteria (§13)
> **Date:** 2026-06-28 · **Updated:** 2026-07-08 (TEST-8/auto-close removed from scope)
> **Status:** Planned — no test files exist yet (`find src -name '*.test.ts'` is empty)

## Problem
The spec makes integration tests **mandatory** for the state machine (TEST-1) and requires test coverage across tickets, RBAC scoping, validation, notifications, and attachments (TEST-2…TEST-7, TEST-9). Today there is no test harness, no test DB wiring, and no factories — the test scenarios live only as scattered "Next Steps" bullets in the module plans. This plan consolidates them into one strategy so `feature-implementer` adds tests consistently as each module lands.

## Approach
Follow `.claude/rules/api-conventions.md` → Testing. Stack: **jest + supertest + ts-jest**, co-located `*.test.ts`. Two test styles:
- **Unit (services):** `jest.mock` the `query` / `withTransaction` from `src/config/postgres.ts`; assert pure logic (state-machine function, recipient de-dup, validation branches).
- **Integration (controllers):** `supertest(app)` against the real **`ttn_stm_test`** DB; assert status code → envelope → payload.

`NODE_ENV=test` must route to `ttn_stm_test` (verify in `src/config/index.ts`) and activate nodemailer `jsonTransport` and `STORAGE_BACKEND=local`. Email notification functions are called **directly** in tests — there is no queue/worker, no BullMQ (see `notifications-email.md`). Auto-close (formerly TEST-8) is **removed from scope**, not deferred — see `requirements.md` §1.2 Out of Scope.

## Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `jest.setup.ts` | Create | `afterEach` TRUNCATE; `afterAll` `pool.end()` + worker/queue close |
| `package.json` | Modify | Add `jest` config block + `test` / `test:watch` / `test:coverage` scripts |
| `tests/factories.ts` | Create | Factory fns: `makeUser`, `makeAdmin`, `makeAgent`, `makeTicket`, `makeComment`, `makeAttachment`, `authHeader(user)` |
| `tests/helpers/db.ts` | Create | Truncate helper, seed-minimal helper, JWT mint helper for a seeded user |
| `src/modules/tickets/ticket.service.test.ts` | Create | Unit: state machine, auto-assign, scope WHERE building |
| `src/modules/tickets/ticket.controller.test.ts` | Create | Integration: TEST-1/2/3/4/5 |
| `src/modules/comments/comment.controller.test.ts` | Create | Integration: add/list, scope, ordering |
| `src/jobs/notifications.test.ts` | Create | TEST-7 — `sendNewTicketEmail`/`sendCommentNotificationEmail` recipient sets via `jsonTransport` (direct call, no queue) |
| `src/modules/attachments/attachment.controller.test.ts` | Create | TEST-9 — upload/list/download/delete + RBAC |
| `src/middlewares/*.test.ts` | Create | `errorHandler`, `authenticate`, `requireRole`, `validateBody` — 100% target |

## Test DB & Isolation
- DB: **`ttn_stm_test`** — never `ttn_stm`. Created via `db:migrate` against `NODE_ENV=test`.
- `afterEach`: `TRUNCATE attachments, comments, tickets, users RESTART IDENTITY CASCADE`.
- `afterAll`: `pool.end()` and `redis.quit()` to avoid open-handle leaks.
- Each test seeds its own users/tickets via factories — never rely on prior test state or inline literals.

## Test Matrix (requirement → test)

| Test ID | Type | Asserts |
|---------|------|---------|
| **TEST-1** | Integration | All valid transitions (`OPEN→IN_PROGRESS`, `IN_PROGRESS→RESOLVED`, `RESOLVED→CLOSED`, `OPEN→CANCELLED`, `IN_PROGRESS→CANCELLED`) succeed; representative invalid ones → `409` + `INVALID_STATUS_TRANSITION` with `from`/`to` |
| **TEST-2** | Integration | Create ignores client `status`/`assignedTo`; result is `OPEN` + assigned to admin (FR-1/1a) |
| **TEST-3** | Integration | Admin lists all; agent list scoped to assigned-or-created; scope applied before paging (FR-2a, SF-5) |
| **TEST-4** | Integration | Assign is admin-only (`403` for agent); non-existent target → `400` `USER_NOT_FOUND` (FR-7) |
| **TEST-5** | Integration | Missing/empty `title`/`description`/`message` and bad enum → `400` `VALIDATION_ERROR` (VAL-2/3) |
| **TEST-6** | Unit (stretch) | Pure state-machine fn; validation rules; cache-invalidation calls |
| **TEST-7** | Unit (direct call) | `sendNewTicketEmail` → creator+admin de-duplicated; `sendCommentNotificationEmail` excludes author; correct set per role combo; `jsonTransport`, no real mail (FR-10/11) |
| **TEST-9** | Integration | Allowed MIME+size → `201`, `storageKey` absent; disallowed → `415`; oversize/over-count → `400`; download → `200` + `Content-Type` + `Content-Disposition: attachment`; no parent access → `403`; delete by non-uploader non-admin → `403`, by uploader → `204`; `STORAGE_BACKEND=local`, cleanup in `afterAll` |

## Coverage Targets (enforced via jest `coverageThreshold`)
| Layer | Minimum |
|-------|---------|
| Services | 90% |
| Controllers | 80% |
| Middleware / Utils | 100% |
| Job workers | 80% |

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
Scripts: `"test": "jest"` · `"test:watch": "jest --watch"` · `"test:coverage": "jest --coverage"`.

## Risks
- **Open handles**: ioredis + pg must all be closed in `afterAll` or Jest hangs. Run with `--detectOpenHandles` while stabilizing.
- **ENUM casing**: tests must use uppercase values — they will fail until `schema-alignment.md` is applied to `ttn_stm_test`.
- **Test-DB drift**: `db:migrate` must be re-run against `ttn_stm_test` after any `schema.sql` change; add a pretest hook if drift recurs.
- **Stale queue calls in `comment.service.ts`**: `emailQueue.add()`/`autoCloseQueue.add()` calls (and `systemCloseTicket()` in `ticket.service.ts`) are dead code from before the direct-call/no-auto-close decision — see `notifications-email.md` Cleanup section and `task.md` Phase 7/8. Tests exercising `addComment()` should not assume a worker processes these; once cleanup lands, assert on the direct `sendCommentNotificationEmail()` call instead.

## Non-Negotiables Checklist
- [ ] Tests use `ttn_stm_test`, never `ttn_stm`
- [ ] No inline data literals — factories only
- [ ] Assertion order: status code → `success` flag → `data`
- [ ] No real mail (`jsonTransport`); no real S3 (`local` backend)
- [ ] All async handles closed in `afterAll`

## Next Steps (ordered)
1. Confirm `NODE_ENV=test` → `ttn_stm_test` in `src/config/index.ts`; create the DB and migrate it
2. Add jest config + scripts to `package.json`; write `jest.setup.ts`
3. Write `tests/factories.ts` + `tests/helpers/db.ts`
4. Middleware tests (fast, 100% target) — establishes the harness
5. Per-module tests added alongside each module as it is implemented (TEST-1…5 with tickets/comments)
6. Notification tests (TEST-7, direct call) after `notifications-email.md` lands
7. Attachment tests (TEST-9) after the attachments module lands
8. Wire `coverageThreshold`; run `npm run test:coverage` and close gaps
