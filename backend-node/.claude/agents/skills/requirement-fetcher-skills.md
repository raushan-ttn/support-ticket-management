# Skills — `requirement-fetcher`

> **Model:** Haiku · **Tools:** Read · **Stage:** 1 of 5 (pipeline entry point)
> **Source agent:** `.claude/agents/requirement-fetcher.md`

## Purpose

Anchor every feature in the canonical spec before any planning or code. Reads
`.claude/requirements.md`, `.claude/rules/security.md`, and `.claude/task.md`,
then returns only the subset relevant to the requested feature — never inventing
or inferring beyond what the documents state.

## Skills

| # | Skill | Detail |
|---|-------|--------|
| 1 | Requirement extraction | Pull every applicable ID (`FR-*`, `SM-*`, `RBAC-*`, `CACHE-*`, `NFR-*`, `TEST-*`, `VAL-*`, `ERR-*`) for the feature |
| 2 | Data-model scoping | List affected tables/fields from §3; flag NOT NULL, FK, UNIQUE, trigger-maintained columns |
| 3 | Endpoint mapping | List affected endpoints from §5.1 as `METHOD /path — auth level — purpose` |
| 4 | RBAC resolution | Quote exact `RBAC-*` rule text and the role matrix from `security.md` |
| 5 | Validation/error/cache rules | Surface `VAL-*`, `ERR-*` (status \| code \| trigger), `CACHE-*` keys + invalidation |
| 6 | Test-ID mapping | List each `TEST-*` with a one-line assertion summary |
| 7 | Task-checklist tracing | Match feature to `task.md` Phase(s); preserve `[x]`/`[ ]` state + trailing IDs; emit a status summary |

## Inputs

- A feature name or prompt describing what is to be built.

## Outputs

- A structured summary with these sections (omit empty ones): Feature, Relevant
  Requirement IDs, Data Model, Endpoints, Business Rules, RBAC Constraints,
  Validation Rules, Caching Rules, Error Codes, Test Requirements, Acceptance
  Criteria, Task Checklist (with `Status: Phase N — x/y items done`).

## When to invoke

- **First**, at the start of any feature implementation, before `feature-planner`.

## Owns (canonical sources)

- `.claude/requirements.md` (read-only canonical spec)
- `.claude/task.md` (read-only progress tracker)
- `.claude/rules/security.md` (RBAC matrix)

## Guardrails

- Read-only — never writes.
- Never adds requirements not present in the documents.
- `requirements.md` is canonical; if it conflicts with `task.md`, defer to
  `requirements.md` and flag the discrepancy.

## Hands off to

- `feature-planner` — consumes the extracted IDs so the plan need not re-read the spec.
