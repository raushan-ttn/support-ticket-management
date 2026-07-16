# Requirements Analysis — Support Ticket Management (Backend API)

> **Canonical spec:** `.claude/requirements.md` (kept in `.claude/` because `requirement-fetcher`,
> `feature-planner`, and `feature-implementer` read that exact path at runtime). This file is an
> analytical summary for assessment/review purposes — if it ever disagrees with
> `.claude/requirements.md`, the canonical file wins.

## 1. Scope

**In scope:** ticket CRUD + state machine, comments, RBAC (`ADMIN`/`AGENT`), Redis caching,
direct (non-queued) email notifications, file attachments (local + S3 storage abstraction).

**Explicitly out of scope** (`.claude/requirements.md` §1.2):
- Frontend application/UI (frontend is a pure consumer of this API, now developed in a separate repo)
- User self-registration/management UI — users are seeded only (DM-1/DM-2)
- SLA timers, audit exports
- Auto-close-on-stale-reply background job — **removed 2026-07-08**, would have required a
  Redis-backed delayed job queue (BullMQ), which this implementation deliberately excludes.
  Left dead code (`systemCloseTicket()`, `SM-6`, `autoCloseQueue` calls) is tracked for cleanup
  in `.claude/task.md` Phase 8.

## 2. Requirement Categories & IDs

| Category | ID prefix | Section | Count (approx) |
|---|---|---|---|
| Technology/infra | `TS-*` | §2 | 9 |
| Data model | `DM-*` | §3 | 13 |
| RBAC | `RBAC-*` | §4 | 6 |
| Functional (tickets/comments) | `FR-*` | §5.1–5.3 | 16 |
| Notifications | `FR-10/11` | §5.4 | 4 |
| Attachments | `FR-13/14/15/16` | §5.6 | 6 |
| Search/filter | `SF-*` | §6 | 5 |
| State machine | `SM-*` | §7 | 5 (2 removed) |
| Validation | `VAL-*` | §8.1 | 6 |
| Error taxonomy | `ERR-*` | §8.2 | 5 |
| Caching | `CACHE-*` | §9 | 9 |
| Non-functional | `NFR-*` | §10 | 13 (2 removed) |
| Testing | `TEST-*` | §11 | 9 (1 removed) |

## 3. Key Architectural Decisions Driven by Requirements

- **RBAC is two roles only** (`ADMIN`, `AGENT`) — RBAC-1 explicitly excludes a generic `user`
  role, which shaped the entire authorization model (route-level `requireRole`, SQL `WHERE`
  scoping in services — never in-memory filtering).
- **`assignedTo` is NOT NULL on tickets** (DM-3) — a direct consequence of FR-1's mandatory
  auto-assignment to the admin queue. There is no "unassigned" ticket state.
- **State machine is server-authoritative and transactional** (SM-4/SM-5) — every transition
  reads current status with `SELECT ... FOR UPDATE` inside the same transaction as the write,
  to avoid lost-update races under concurrent requests.
- **No job queue** (TS-8, removed) — email notifications are direct, fire-and-forget calls from
  the service layer instead of BullMQ jobs. This was a deliberate scope cut (see
  `.claude/plans/notifications-email.md`) that also killed the auto-close feature, since that
  depended on a delayed-job queue.
- **Attachments are metadata-only in Postgres** (DM-8, CACHE-9) — bytes live in a swappable
  storage backend (`local` for dev, `S3` for prod) behind `IStorageBackend`; `storageKey` is
  never returned in API responses, only a derived, absolute `url`.

## 4. Requirement Evolution (from dated notes in `.claude/requirements.md`)

| Date | Change |
|---|---|
| 2026-07-08 | TS-8/NFR-9/NFR-10/TEST-8/SM-6/SM-7/FR-12 removed — auto-close + BullMQ dropped from scope entirely |
| 2026-07-09 | DM-13/DM-13a (`screenshot` columns on tickets/comments) removed in favor of the unified `attachments` system |
| 2026-07-09 | TS-9/FR-13c corrected: attachment `url` must be an **absolute** URL, not the previously-specified relative `/uploads/…` path |
| 2026-07-09 | FR-14 bug fix noted: `GET /api/tickets` previously hardcoded `attachments: []` instead of fetching them |

## 5. Gaps / Ambiguities Called Out in the Spec Itself (§12 Assumptions)

- Admin resolution for auto-assignment: config-driven, falls back to first seeded `ADMIN` —
  round-robin across multiple admins was considered and rejected for simplicity.
- Attachment limits (size/count) are env-configured with suggested defaults (5 MB/file, 5
  files/request) — not hardcoded requirements.
- Virus/malware scanning of uploads is explicitly out of scope.
- Idempotency keys on ticket creation are optional/stretch (NFR-7) — not implemented.

## Related Files
- `.claude/requirements.md` — canonical, full requirement text (read by AI agents)
- `.claude/task.md` — phase-by-phase implementation checklist traceable to these IDs
- `acceptance-criteria.md` — the checklist extracted from §13 plus per-phase criteria
- `data-model.md` — schema derived from §3
