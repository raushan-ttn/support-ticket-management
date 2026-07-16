# AI Prompts — Implementation

> Same caveat as `planning.md` — no verbatim transcript exists. Templates below are from
> `tool-workflow.md` §5 (Code Generation), the actual pattern this project's modules were built with.

## Code generation prompt

```
Generate the tickets service layer for src/modules/tickets/.
Follow auth module style. Use query<T>() from src/config/postgres.ts.
Use parameterized SQL ($1, $2). Never SELECT *.
Use success()/error() from src/utils/response.ts in the controller.
Follow all Non-Negotiables in CLAUDE.md and .claude/plans/tickets-module.md.
```

## Incremental generation discipline actually followed

Every module was generated one layer at a time — schemas → service → controller → routes —
validating (`tsc`/lint) after each step rather than generating a whole module in one shot, to
reduce drift from project conventions (`tool-workflow.md` §5, "Incremental generation").

## Constraints repeated in every implementation prompt (the 12 Non-Negotiables)

See `CLAUDE.md` Non-Negotiables and `tool-workflow.md` §5 for the full list — every
implementation prompt in this project carried an explicit instruction to follow them rather
than relying on the model to infer them from context alone.

## Structural equivalent: the `feature-implementer` agent

In practice, later modules (attachments, the Phase 9 test suite) were built via the
`feature-implementer` agent (`.claude/agents/feature-implementer.md`) reading an approved plan
from `.claude/plans/{slug}.md`, rather than this prompt being typed by hand each time — see
`tool-workflow.md` §1 and the `/build-feature` command.

## Related Files
- `tool-workflow.md` §5 — full code generation section
- `implementation-plan.md` — what was actually built, phase by phase
- `.claude/agents/feature-implementer.md` — the agent definition that automated this pattern
