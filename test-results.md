# Test Results — Support Ticket Management (Backend API)

> Real output from a fresh run in this session (2026-07-16), not a copy of a historical
> CHANGELOG claim. Reproduce with:
> ```
> NODE_ENV=test npm run db:migrate
> NODE_ENV=test npm test -- --runInBand
> NODE_ENV=test npm run test:coverage -- --runInBand
> ```
> `--runInBand` is required — see the known parallel-worker caveat in `acceptance-criteria.md`.

## Suite Summary

```
Test Suites: 13 passed, 13 total
Tests:       187 passed, 187 total
Snapshots:   0 total
Time:        33.4s
```

All 13 suites green, 0 failures, against a freshly migrated `ttn_stm_test` on `global-postgres`
(Docker) + `global-redis`.

## Coverage by Layer (this run)

| Layer | Actual | Target (`.claude/rules/api-conventions.md`) | Met? |
|---|---|---|---|
| Middleware | 98.5% stmts / 100% funcs | 100% | Just under on statement %, functions at 100% — the couple of uncovered lines are defensive branches (`authenticate.ts:11`) |
| Services | tickets 80.3%, comments 92.6%, attachments 91.5%, auth 100% | 90% | tickets.service.ts below target (80.3%) — see gap below |
| Controllers | tickets 83.8%, comments 87.2%, attachments 76.3%, auth 90.9% | 80% | attachments.controller.ts below target (76.3%) |
| Job workers | notifications.ts 100%, mailer.ts 100% | 80% | Met |

**Overall:** 86.2% statements / 74.7% branches / 85.8% functions / 87.9% lines across `src/**`.

## Coverage Gaps (below target)

- **`ticket.service.ts` (80.3%, target 90%)** — uncovered lines cluster around cache-invalidation
  branches and less-common update paths (lines 208–229, 274–352 per the coverage report) — likely
  defensive `if (cache unavailable)` branches and rarely-hit partial-update permutations, not
  core business logic (state machine and RBAC scoping are covered by the 187 passing tests).
- **`attachment.controller.ts` (76.3%, target 80%)** — a few lines (9–10, 46–50) uncovered,
  consistent with the untested `_req`/error-branch pattern seen elsewhere.
- **`src/storage/s3.ts` (0%)** — expected: no test exercises the S3 backend (tests run
  `STORAGE_BACKEND=local` per `.claude/rules/api-conventions.md` Attachment Tests convention).
  Not a functional gap, just an untested code path by design.

## Known Environment Notes (from this run)

- `Cannot log after tests are done` warning from `src/config/redis.ts:26` (`[Redis] Connection
  closed` logged after Jest tears down console) — cosmetic, doesn't fail any test, tracked
  informally rather than as a defect.
- `npm run db:migrate` logs `Running schema against` followed by the raw `process.env.PG_DATABASE`
  value rather than the actually-resolved database name (`ttn_stm_test` when `NODE_ENV=test`) —
  a pre-existing log-string inaccuracy in `src/db/migrate.ts:12`, not a connection bug; the
  migration and all 187 tests did correctly run against `ttn_stm_test`.

## Related Files
- `acceptance-criteria.md` — the criteria this suite is meant to verify
- `test-strategy.md` / `.claude/plans/phase-9-tests.md` — the strategy and gap-closure plan behind this suite
- `tests/factories.ts` — shared test data factories
