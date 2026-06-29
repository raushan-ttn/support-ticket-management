# Skills — `feature-implementer`

> **Model:** Sonnet · **Tools:** Read, Write, Edit, Bash · **Stage:** 3 of 5
> **Source agent:** `.claude/agents/feature-implementer.md`

## Purpose

Turn an approved `.claude/plans/{feature-slug}.md` into working,
convention-compliant code, verify the build, and check off completed `task.md`
items. If no plan exists, it stops and defers to `feature-planner`.

## Skills

| # | Skill | Detail |
|---|-------|--------|
| 1 | Schema migration | Append idempotent DDL to `src/db/schema.sql`, run `npm run db:migrate` |
| 2 | Zod + types authoring | Write `{module}.schemas.ts` — schemas, `z.infer` types, response interfaces |
| 3 | Service implementation | All DB / cache / queue logic in `{module}.service.ts` (`query`/`withTransaction`, `FOR UPDATE` on transitions) |
| 4 | Controller implementation | `{module}.controller.ts` — parse req → one service call → `success()`/`error()`; `next(err)` in catch; `return` after `error()` |
| 5 | Routing | `{module}.routes.ts` middleware chain (`authenticate`, `requireRole`, `validateBody`/`validateQuery`) + mount in `app.ts` |
| 6 | Test authoring | Unit (`*.service.test.ts`) + integration (`*.controller.test.ts`) per the plan's `TEST-*` IDs |
| 7 | Build verification | `npx tsc --noEmit`, `npm run lint` (`lint:fix`), `npm test` — never finish red |
| 8 | Task checklist updates | Flip `[ ]`→`[x]` in `task.md` only for fully implemented + verified items (checkbox char only) |

## Inputs

- Plan slug or feature name (the plan in `.claude/plans/` is the spec).

## Outputs

- New/edited source under `src/modules/{module}/`, `src/db/schema.sql`, `src/app.ts`, tests.
- Updated `.claude/task.md` checkboxes.
- Summary: files created/modified, endpoints added, `tsc`/`lint`/`test` status,
  which `task.md` items were checked vs left pending (with reason).

## Non-Negotiables enforced (from CLAUDE.md)

- No `process.env` outside `src/config/index.ts`; parameterized SQL only; no
  `SELECT *`; never return `password_hash`/`storage_key`; SQL only in services;
  responses only via `success()`/`error()`; `strict: true` (no `any`, no unproven `!`);
  unused params `_`-prefixed; queue `.add()` fire-and-forget; multi-table writes
  in `withTransaction`; cache writes carry TTL + invalidate on write; never `git commit --no-verify`.

## When to invoke

- After `feature-planner` produces a plan; before `code-reviewer`, `docs-updater`, `feature-doc-writer`.

## Owns

- `src/**` for the feature, `src/db/schema.sql`, `src/app.ts`, co-located tests,
  `.claude/task.md` checkboxes (checkbox char only — never text/IDs/order).

## Guardrails

- No plan ⇒ stop and report that `feature-planner` must run first; do not invent a design.
- Environmental failures (DB/Redis down) reported explicitly — never claimed as success.
- Never edit `requirements.md`; never check off unproven work (no passing test ⇒ `TEST-*` stays `[ ]`).

## Hands off to

- `code-reviewer` (hook-driven, auto-runs on each `.ts`/`.js` Edit/Write),
  then `docs-updater` and `feature-doc-writer`.
