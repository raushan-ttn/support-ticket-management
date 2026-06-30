---
description: SDLC Phase 2 — design & architecture; rendering-strategy analysis and documentation/ADRs
---

@.cursor/prompts/personas/architect.md
@.cursor/skills/performance/SKILL.md
@.cursor/skills/documentation/SKILL.md

# /design — Design & Architecture

Pick the mode that fits the task.

## Mode A — Rendering / Architecture Analysis
Analyse the @mentioned component/page and recommend the optimal strategy.

1. **Classify the data** — shared vs user-specific, change frequency, post-load interactivity.
2. **Apply the decision tree**:
   - No data (pure UI) → Static RSC (default)
   - Shared, rarely changes → `cache: 'force-cache'` or ISR `revalidate: 3600`
   - Shared, scheduled change → ISR `revalidate: 60` + tags, `revalidateTag` on mutation
   - Shared, frequent → Dynamic `no-store` / `export const dynamic = 'force-dynamic'`
   - User-specific → Dynamic with auth header
   - Interactivity (form/real-time/optimistic) → Client Component + RTK Query (keep as a leaf)
3. **Streaming** — wrap slow fetches in `<Suspense>`; add `loading.tsx`.
4. **Bundle** — heavy client lib → `dynamic()`; extract any server-renderable part to an RSC.

**Output:** Current State (rendering/data/issues) → Recommendation (target/cache config/Suspense/bundle) → minimal Diff → Expected Impact (LCP/bundle/TTI).

## Mode B — Documentation & ADR
Document a decision or convention in the right place:

| Type | Location |
|------|----------|
| Project-wide conventions | `CLAUDE.md` |
| AI coding rules | `.cursor/rules/*.mdc` |
| Architecture decisions | `.cursor/plans/[feature].md` or `docs/adr/` |
| Component/hook API | Inline — one short line only when non-obvious |
| New env var / npm script | `CLAUDE.md` (+ `.env.example` for env) |

- **Inline comments:** default none; add only when the WHY is non-obvious (hidden constraint, workaround, invariant); one line; never reference task/ticket.
- **ADR template:** `Title · Date · Status · Context · Decision · Consequences`.

## Done When
- [ ] One concrete approach recommended (not a menu) with rendering layer identified and risks flagged.
- [ ] Any significant trade-off captured as an ADR; new env vars documented.
