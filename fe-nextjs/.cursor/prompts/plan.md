---
description: SDLC Phase 1 — plan a feature before any code (rendering strategy, affected files, risks)
---

@.cursor/prompts/personas/planner.md
@.cursor/skills/planning/SKILL.md

# /plan — Planning & Requirements

Produce a reviewable implementation plan for the feature below. Write no code until the plan is approved.

## Feature to Plan
[DESCRIBE THE FEATURE]

## Produce
1. **Clarify** — what it does, who uses it, auth required?, data user-specific (→ dynamic) or shared (→ static/ISR)?, interactivity needed?
2. **Rendering strategy** (choose one + justify): Static RSC · Dynamic RSC (`no-store`) · ISR (`revalidate: N`) · Client Component + RTK Query · Mixed (describe the boundary).
3. **Affected files** — list every file to create/modify across layers: `src/types/*`, `src/services/*Api.ts` (client mutations), `src/actions/*-actions.ts` (server mutations), `src/lib/store/index.ts` (only if new `createApi`), `src/components/[Feature]/*`, `src/app/[route]/{page,loading,error}.tsx`, co-located `.module.scss`.
4. **Steps** — numbered, in dependency order (types → service/action → RSC → CC → page → loading/error).
5. **Risks / open questions** — client boundary expansion, cache `revalidateTag` targets, auth/token source, heavy bundle (`dynamic()`?), slow fetch (`<Suspense>`?).

## Output Template
```markdown
## Plan: [Feature]
### Rendering Strategy
[choice + one-line why]
### Affected Files
- path — purpose
### Steps
1. …
### Risks / Open Questions
- …
```

## Done When
- [ ] Plan filled in, one rendering decision justified, every file listed, risks named.
- [ ] Stop and wait for approval → then hand off to `/build`.
