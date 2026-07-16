# PR History — Support Ticket Management (Backend API)

> Derived from real merged PRs (`gh pr list --state merged`), not fabricated — this is the actual
> shipped history of the backend, in merge order. Full diffs/discussion: `gh pr view <number>`.

## Merged PRs (chronological)

| # | Date | Branch | Title |
|---|---|---|---|
| 1 | 2026-06-24 | `backend_setup` | feat: backend Node.js setup with TypeScript, PostgreSQL, Redis & modular architecture |
| 2 | 2026-06-24 | `backend_setup` | feat: backend Node.js setup with auth, validation, and security middleware |
| 3 | 2026-06-24 | `backend_setup` | chore: consolidate Claude rules, add module plans and project config |
| 4 | 2026-06-26 | `auth_setup` | feat: finalize auth module with JWT middleware, RBAC, and agent seeding |
| 5 | 2026-06-29 | `fix/phase-0-gaps` | fix(phase-0): close infrastructure gaps blocking later phases |
| 6 | 2026-06-29 | `auth_setup` | fix(schema): normalize all ENUM values to uppercase |
| 7 | 2026-06-29 | `auth_setup` | feat(schema): Phase 1 database schema gap closure |
| 8 | 2026-06-29 | `storage_change` | feat(storage): file storage abstraction with date-based local layout (TS-9) |
| 9 | 2026-06-29 | `phase2-auth-gaps` | feat(auth): close Phase 2 gaps — shared middleware, tests, and storage fixes |
| 10 | 2026-06-29 | `queue_setup` | feat(config): close Phase 3 — SMTP + BullMQ config and queue connection |
| 11 | 2026-06-29 | `ticket_module` | feat(tickets): Phase 4 — Tickets Module |
| 12 | 2026-06-30 | `fe_nextjs_setup` | feat(fe): Next.js frontend setup with tickets UI *(frontend later moved to a separate repo)* |
| 13 | 2026-06-30 | `cursor-ai-config` | chore(cursor): consolidated Cursor AI config for fe-nextjs |
| 14 | 2026-07-01 | `auth_setup` | feat(tickets): add type/subType/screenshot fields and fix updateTicket null guard |
| 15 | 2026-07-02 | `feat/comments-module` | feat(comments): comments module with screenshot support |
| 16 | 2026-07-08 | `attachments_setup` | feat(attachments): storage abstraction & inline ticket/comment attachments |
| 17 | 2026-07-08 | `chore/remove-bullmq-modular-middleware` | chore: remove BullMQ, direct email notifications, modularize middleware |
| 18 | 2026-07-08 | `feat/swagger-api-docs` | feat: add Swagger/OpenAPI docs for all API endpoints |
| 19 | 2026-07-09 | `chore/remove-screenshot-field` | chore: drop screenshot field, fix ticket list attachments, absolute attachment URLs |
| 20 | 2026-07-09 | `feat/phase-9-tests` | feat: Phase 9 test suite + attachment download/delete endpoints |
| 21 | 2026-07-09 | `docs/ai-process-artifacts` | docs: add AI-process artifacts (RBAC contract, debug/review logs, retrospective) |

## Representative Full Descriptions

### #20 — feat: Phase 9 test suite + attachment download/delete endpoints

> Adds a comprehensive backend test suite: 187 tests across 13 suites, with shared factory
> functions (`tests/factories.ts`), 100% middleware coverage, and direct-notification (TEST-7)
> coverage. Implements the two attachment endpoints required for TEST-9 coverage:
> `GET /api/v1/tickets/:ticketId/attachments/:attachmentId/download` and
> `DELETE /api/v1/tickets/:ticketId/attachments/:attachmentId`, both RBAC-scoped (ADMIN or
> ticket-accessible AGENT; AGENT delete limited to own uploads). Adds an `extra` field mechanism
> to `errorHandler` so domain errors (e.g. 409 invalid status transitions) can expose structured
> fields like `from`/`to`. Sets `maxWorkers: 1` in Jest config to avoid DB pool contention across
> parallel test workers.
>
> **Test plan:** `tsc --noEmit -p tsconfig.test.json` passes; `NODE_ENV=test npm test --
> --runInBand` — 13 suites / 187 tests passing against `ttn_stm_test`.

### #19 — chore: drop screenshot field, fix ticket list attachments, absolute attachment URLs

> Removes the `screenshot` column/field from `tickets` and `comments` (DM-13/DM-13a) — the
> `attachments` system already covers file uploads for both. Comment file uploads now go
> through the shared `uploadAttachmentFiles` middleware; `comment.middleware.ts` is deleted.
> Fixes `GET /api/v1/tickets` (list), which previously hardcoded `attachments: []` for every
> ticket instead of fetching them. Adds `APP_URL` config so local-storage attachment URLs are
> absolute rather than relative.
>
> **Test plan:** `tsc --noEmit` clean; `npm run lint` clean; `npm test -- --runInBand` —
> 123/123 passing (parallel workers flake on the shared test DB with duplicate-key races
> unrelated to this change; serial run is green).

### #17 — chore: remove BullMQ, direct email notifications, modularize middleware

> The pivot documented in `.claude/plans/notifications-email.md` and `design-notes.md`: drops
> the BullMQ job queue entirely, replaces queued email sends with direct fire-and-forget calls,
> and removes the associated auto-close-on-stale-reply feature (required a delayed-job queue
> that's no longer part of the implementation).

### #21 — docs: add AI-process artifacts (RBAC contract, debug/review logs, retrospective)

> Reviewed a reference "AI assessment" repo's lifecycle-documentation set and compared it
> against what this repo already had, to avoid duplicating existing docs. Added
> `api-contract.md`, `debugging-notes.md`, `code-review-notes.md`, `reflection.md`, and
> `final-ai-usage-summary.md` — each seeded with real project history rather than placeholder
> content — and wired them into a **Process Docs** section in `CLAUDE.md`. Notably, this PR
> *deliberately skipped* a `tool-workflow.md` file as "fully redundant with the existing
> `.claude/workflow.md`" — a decision this session's restructuring (moving `workflow.md` to
> root as `tool-workflow.md`, alongside `test-strategy.md`) has since revisited.

## Related Files
- `CHANGELOG.md` — dated, feature-level change log (not 1:1 with PRs, but overlapping)
- `implementation-plan.md` — the same history organized by phase/plan instead of by PR
- `review-fixes.md` — fixes that came out of code review specifically, a subset of the above
