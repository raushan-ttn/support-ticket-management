# Skills — `code-reviewer`

> **Model:** Opus · **Tools:** Read · **Stage:** hook-driven (parallel to implementation)
> **Source agent:** `.claude/agents/code-reviewer.md`
> **Trigger:** `settings.json` `PostToolUse` → `.claude/hooks/file-review.sh` on every `.ts`/`.js` Edit/Write.

## Purpose

Disciplined, single-file diff review against the backend conventions in
`CLAUDE.md` and `.claude/rules/`. Flags only issues visible in added (`+`) lines.

## Skills

| # | Skill | Severity focus | Detail |
|---|-------|----------------|--------|
| 1 | Architecture review | HIGH | SQL only in services; thin controllers; `process.env` only in config; `success()`/`error()` only; `next(err)` + `return` after `error()` |
| 2 | Database review | HIGH | Parameterized SQL (no interpolation); no `SELECT *`; no `password_hash`/`storage_key`; `query`/`withTransaction` only; `rowCount` guard; `FOR UPDATE` on transitions |
| 3 | Redis/BullMQ review | MED | Cache helpers only; TTL always set; invalidate on write; BullMQ own connection; fire-and-forget `.add()` |
| 4 | Security review | HIGH | Identity from verified JWT (not `req.body`); `authenticate`/`requireRole` at route level; SQL-WHERE scope filtering; bcrypt 12; upload MIME allowlist + UUID keys + filename sanitize |
| 5 | TypeScript review | MED/HIGH | No `any` (use `unknown` + guards); no unproven `!`; controllers `Promise<void>`; `interface` for shapes; `z.infer` types; `_`-prefixed unused params |
| 6 | Zod review | MED | Schemas in `{module}.schemas.ts`; `z.coerce.number()` for query nums; `.trim().min(1)`; `safeParse` in middleware, `.parse()` for path params |
| 7 | HTTP/API review | LOW/MED | Correct status codes (201/204/409/415/401/403); standard error codes; no breaking `v1` changes |

## Inputs

- A unified diff (`git diff HEAD`) of a **single** changed file.

## Outputs

- One finding per line, classified `[HIGH]`/`[MED]`/`[LOW]`, with `— line ~<n>`;
  no preamble/summary/headers. Max 8 findings, highest severity first.
- Exactly `✓ No issues found.` when clean.

## Severity rubric

- **[HIGH]** — security vuln, SQL injection, data leak, auth bypass, or critical convention violation causing a production bug.
- **[MED]** — convention violation, TS correctness, missing cache invalidation, wrong status code.
- **[LOW]** — minor style/convention drift not affecting correctness.

## When to invoke

- Automatically via hook on every `.ts`/`.js` Edit/Write; or on demand against a single-file diff.

## Guardrails

- Read-only — never edits.
- Only flag added/changed (`+`) lines; never comment on removed (`-`) lines.
- Never invent issues not visible in the diff.
