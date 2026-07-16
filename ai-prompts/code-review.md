# AI Prompts — Code Review

> Same caveat as `planning.md` — no verbatim transcript exists. Templates below are from
> `tool-workflow.md` §9, the real pattern behind the entries in `code-review-notes.md` and
> `review-fixes.md`.

## General review prompt

```
Review this diff against CLAUDE.md Non-Negotiables and .claude/rules/.
List violations by severity (blocker / warning / suggestion).
[paste diff or file paths]
```

## Security review prompt

```
Audit src/modules/tickets/ against .claude/rules/security.md and .claude/rules/db-conventions.md.
Check: RBAC on each endpoint (ADMIN / AGENT only), Zod validation,
no password_hash or storage_key leakage, parameterized SQL,
state machine enforced in transaction, error code field on domain errors.
```

## SQL injection audit prompt

```
Are all SQL parameters in src/modules/tickets/ticket.service.ts
using $N placeholders? Flag any string interpolation.
```

## Structural equivalent: the `code-reviewer` agent hook

In practice, this pattern runs automatically rather than being typed per-diff: `code-reviewer`
(`.claude/agents/code-reviewer.md`) is invoked via a `PostToolUse` hook
(`.claude/hooks/file-review.sh`) on every `.ts`/`.js` `Edit`/`Write` — see `tool-workflow.md` §1
and §9. The actual findings this process caught are logged in `code-review-notes.md`; the fixes
that resulted are indexed in `review-fixes.md`.

## Related Files
- `tool-workflow.md` §9 — full code review section
- `code-review-notes.md` — actual findings caught
- `review-fixes.md` — action-item index of fixes those findings produced
- `.claude/hooks/file-review.sh` — the automation that runs this on every edit
