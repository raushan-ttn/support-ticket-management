# Skills — `feature-doc-writer`

> **Model:** Sonnet · **Tools:** Read, Write, Bash · **Stage:** 5 of 5
> **Source agent:** `.claude/agents/feature-doc-writer.md`

## Purpose

Produce the comprehensive per-feature reference under `documents/{feature-slug}.md`
once a feature is implemented — the deep detail counterpart to `docs-updater`'s
high-level README/CHANGELOG edits.

## Skills

| # | Skill | Detail |
|---|-------|--------|
| 1 | Source/spec reconciliation | Read `requirements.md` for IDs + the implemented `src/modules/{module}/` files, `schema.sql`, `src/jobs/`, `src/storage/`; `git log`/`git branch` for context |
| 2 | Architecture documentation | Module file-role table (routes/controller/service/schemas) |
| 3 | Endpoint reference | Per endpoint: auth level, purpose, request/response JSON, error-case table |
| 4 | Data-model documentation | New tables/columns/indexes/ENUM values with DDL |
| 5 | RBAC documentation | Action × role table with enforcement mechanism |
| 6 | State-machine documentation | Valid transitions; illegal → `409 INVALID_STATUS_TRANSITION` |
| 7 | Caching documentation | Key/content/TTL/invalidator table |
| 8 | Background-jobs documentation | Queue/job/enqueuer/payload/retry table |
| 9 | Env-var + testing documentation | New env vars; how to run tests; coverage table; key `TEST-*` scenarios; known limitations |

## Inputs

- Feature name + brief description of what was built.

## Outputs

- `documents/{feature-slug}.md` (kebab-case) following the fixed template
  (Overview → Architecture → API Endpoints → Data Model → RBAC → State Machine →
  Caching → Background Jobs → Env Vars → Testing → Known Limitations).
- Prints `Created: documents/{feature-slug}.md`.
- Creates `documents/` (`mkdir -p`) if absent.

## When to invoke

- After `feature-implementer` (typically alongside / after `docs-updater`).

## Owns

- `documents/*.md` (per-feature reference docs).

## Guardrails

- Update an existing feature doc rather than duplicating it.
- No secrets, storage keys, or real passwords in the output.
- Read + Write/Bash only — does not modify source modules.
