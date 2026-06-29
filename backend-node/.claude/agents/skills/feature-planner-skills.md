# Skills — `feature-planner`

> **Model:** Sonnet · **Tools:** Read, Write, Bash · **Stage:** 2 of 5 (planning only)
> **Source agent:** `.claude/agents/feature-planner.md`

## Purpose

Turn extracted requirements into a complete, file-level implementation plan saved
to `.claude/plans/{feature-slug}.md`. Planning only — writes **no** source code.

## Skills

| # | Skill | Detail |
|---|-------|--------|
| 1 | Context assembly | Read `requirements.md`, `schema.sql`, `src/modules/auth/`, `CLAUDE.md`, the three `rules/` files, and overlapping plans |
| 2 | File-level planning | Produce the Files-to-Create/Modify table (routes, controller, service, schemas, schema.sql, app.ts) |
| 3 | Schema design | Author idempotent DDL (`IF NOT EXISTS`, `OR REPLACE`) to append to `schema.sql` |
| 4 | Zod schema spec | Describe each schema's fields/constraints (no TS code) |
| 5 | Per-endpoint logic design | Validation, authz (role + scope), DB op, cache read/write/invalidate, queue enqueue, response shape |
| 6 | RBAC & scope mapping | Endpoint × role table; scope enforced in SQL `WHERE`, never in-memory |
| 7 | State machine / transaction strategy | Transitions involved + `withTransaction` + `FOR UPDATE` plan |
| 8 | Cache & queue strategy | Key/content/TTL/invalidator table; queue name, job type, payload, fire-and-forget point |
| 9 | Risk + Non-Negotiables audit | Security/concurrency/migration risks; tick the CLAUDE.md Non-Negotiables checklist |
| 10 | Implementation sequencing | Ordered Next-Steps list ready for `feature-implementer` |

## Inputs

- Feature name + (ideally) the `requirement-fetcher` output with exact IDs.

## Outputs

- `.claude/plans/{feature-slug}.md` (kebab-case) following the fixed template:
  Problem → Approach → Files → Schema Changes → Zod Schemas → Business Logic →
  RBAC → State Machine → Cache → Queue → Error Cases → Risks → Non-Negotiables
  → Next Steps.
- Printed saved path + one-paragraph summary.

## When to invoke

- After `requirement-fetcher`, before `feature-implementer`.

## Owns

- `.claude/plans/*.md` (creates/updates plan files).

## Guardrails

- No source code — describes what to build, not the implementation.
- Reuse existing utilities (`query`, `withTransaction`, `setCache`, `validateBody`, …).
- Update an existing plan rather than duplicating it.
- If given `requirement-fetcher` output, use those IDs verbatim — don't re-read the spec.

## Hands off to

- `feature-implementer` — pass the plan slug.
