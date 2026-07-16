# AI Prompts — Planning

> **Note:** actual chat transcripts/prompts from Claude Code sessions were never persisted to
> this repo — there's no session log to recover them from. What follows are the real prompt
> *templates* documented in `tool-workflow.md` §3–4 (Requirement Analysis / Planning), which this
> project's sessions were built around, not fabricated examples.

## Requirement analysis prompt (`tool-workflow.md` §3)

```
Given the tickets table in src/db/schema.sql, the state machine in §7 of
.claude/requirements.md, and the RBAC matrix in .claude/rules/security.md,
analyze requirements for POST /api/v1/tickets.

List:
- Required request fields and Zod validations
- Role permissions (ADMIN / AGENT) and what is auto-set server-side
- Edge cases (empty title, invalid priority, unauthenticated access, client-supplied assignedTo)
- Acceptance criteria as a numbered checklist
```

## Planning prompt (`tool-workflow.md` §4)

```
Create an implementation plan for the tickets module following CLAUDE.md and
the requirements in .claude/requirements.md §5.1–5.3 and §7.
Auth module (src/modules/auth/) is the reference pattern.
Output: problem, approach, files to create/modify, key decisions, risks, next steps.
Do not write code yet.
```

Both are also encoded structurally as the `requirement-fetcher` and `feature-planner` agents
in `.claude/agents/`, invoked via `/build-feature` or `/dev-planer` rather than typed by hand
each time — see `tool-workflow.md` §1 and §4.

## Related Files
- `tool-workflow.md` §3–4 — full context and the plan-template this pattern produces
- `.claude/plans/*.md` — actual plan outputs from this pattern
