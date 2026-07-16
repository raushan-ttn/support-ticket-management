# AI Prompts — Design

> Same caveat as `planning.md`: no verbatim session transcript exists to recover from. This
> project doesn't separate "design" from "planning" as a distinct prompting phase — `tool-workflow.md`
> §4 covers both under one plan template (problem → approach → files → key decisions → risks →
> next steps). What follows is that template and how it was actually applied.

## Plan template used for every design decision (`tool-workflow.md` §4)

```
Each plan in .claude/plans/ should cover:
1. Problem — what we are building and why
2. Approach — libraries, patterns, module layout
3. Files changed — created / modified with brief purpose
4. Key Decisions — why specific approaches were chosen over alternatives
5. Risks — security, migration, breaking changes
6. Next Steps — ordered implementation checklist
```

## Resuming/extending an existing design

```
Follow .claude/plans/tickets-module.md.
Implement the service layer only (ticket.service.ts).
Do not touch routes or controllers yet.
```

## Requirements-to-design gap checklist actually used

Before any plan was considered ready for implementation, it was checked against:

```
| Requirement area | Key check |
| RBAC | Only ADMIN and AGENT roles exist — no user role |
| ENUM values | All DB enums use uppercase |
| State machine | Only transitions in §7 are valid |
| Auto-assignment | assignedTo is always server-set on create |
| Async notifications | Email delivery is direct, non-queued, fire-and-forget |
| Storage | Attachment bytes never in Postgres/Redis |
| Error codes | Domain errors include a machine-readable code field |
```

The actual decisions and risks this template produced across all 11 plans are consolidated in
`design-notes.md` — that file is the real output, this one is the prompt shape that produced it.

## Related Files
- `tool-workflow.md` §4 — full planning/design section
- `design-notes.md` — consolidated real decisions/risks from applying this template
- `.claude/plans/*.md` — individual plan outputs
