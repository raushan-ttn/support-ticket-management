# Acceptance Criteria — Support Ticket Management (Backend API)

> Extracted from `.claude/requirements.md` §13 (Core Acceptance Criteria) and the verification
> pass logged in `.claude/task.md`. Checkbox state reflects the last verified run
> (2026-07-09, 123/123 tests green on a freshly migrated `ttn_stm_test`), not a live re-run —
> see `test-results.md` for a current run.

## Core Acceptance Criteria (requirements.md §13)

- [x] Ticket created via API; persisted; auto-assigned to admin with `OPEN` status (FR-1)
- [x] Admin sees all tickets; agents scoped to assigned/created (FR-2a, RBAC-3/4)
- [x] Ticket detail retrievable by id — `404`/`403` on miss/out-of-scope (FR-3)
- [x] Title, description, priority updatable; assignee change is admin-only (FR-4, RBAC-5)
- [x] Comments addable and listable; admin reads any ticket's comments (FR-6, FR-8, FR-9)
- [x] Status transitions only through valid paths; invalid → `409` (FR-5, SM-1/SM-2)
- [x] Keyword search and status filter work and respect caller scope (SF-1/SF-2/SF-5)
- [x] Data survives restart (Postgres) (NFR-1)
- [x] Backend validation blocks invalid records (VAL-1…VAL-6)
- [x] Redis cache accelerates reads; degrades gracefully when unavailable (CACHE-1…CACHE-7)
- [x] No secrets committed (TS-5)
- [x] State-machine integration tests pass (TEST-1)
- [x] New ticket emails creator + admin — async, non-blocking, direct call, no queue (FR-10, NFR-8)
- [x] New comment emails all involved parties, de-duplicated, excluding author (FR-11)
- [x] Notification failures logged; never fail the originating request — no retry (NFR-11)
- [x] PNG/JPG files uploadable to a ticket or comment; metadata in Postgres, bytes in storage backend (FR-13, DM-8)
- [x] Upload rejects non-PNG/JPG MIME types, oversize files, over-count requests (FR-13b, VAL-6)
- [x] Attachment metadata (incl. direct-access `url`) returned inline in ticket/comment responses (FR-14)
- [x] No separate attachment endpoints; no bytes cached in Redis (FR-15, CACHE-9)

## Per-Requirement Acceptance Detail (selected, non-obvious)

| Requirement | Acceptance condition |
|---|---|
| FR-1a | Client-supplied `status`/`assignedTo` on create are silently **ignored**, not rejected as errors |
| FR-7 | Assigning to a non-existent user → `400 USER_NOT_FOUND`; non-admin caller → `403` |
| SM-4/SM-5 | Transition validity checked against status read inside the **same transaction** as the write (`FOR UPDATE`), not a client-supplied "current status" |
| FR-11a | Comment-notification recipient resolution reads the ticket's *current* `assignedTo`, never a value cached before the request |
| DM-10 | A comment-level attachment's `commentId` must belong to the same `ticketId` — cross-ticket references rejected |
| CACHE-6 | List/search caching only permitted if the cache key encodes caller scope + filters; otherwise list endpoints bypass cache entirely |

## Known Environment Caveats (not functional defects)

- `ttn_stm_test` must be migrated (`NODE_ENV=test npm run db:migrate`) before running the suite — an unmigrated test DB produces spurious `500`s that look like code defects but aren't.
- Default `npm test` (parallel Jest workers) can show `users_email_key` collisions since all workers share one live test DB. Every suite passes with `--runInBand`. Candidate fix: `maxWorkers: 1` in Jest config, or a per-worker schema/DB, if this causes flaky CI.

## Related Files
- `.claude/requirements.md` §13 — the canonical, unverified checklist
- `.claude/task.md` — per-phase task checklist + the verification note this file is derived from
- `test-strategy.md` / `.claude/plans/phase-9-tests.md` — how these criteria are exercised in tests
- `test-results.md` — actual test run output
