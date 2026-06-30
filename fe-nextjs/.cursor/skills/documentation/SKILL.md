# Skill: Documentation

## Purpose
Produce documentation that is accurate, durable, and actionable — not verbose. Document the *why* and *how*, not the *what* (the code already shows that).

---

## What to Document

### Document
- Non-obvious architectural decisions (why RSC by default, why `localStorage` token, why `injectEndpoints` not `createApi`)
- Cross-cutting invariants (`AppRouterCacheProvider` must stay in root layout; `@use 'abstracts'` must NOT be in module files)
- Public-facing API contracts (Route Handler request/response shapes)
- Onboarding steps that cannot be inferred from the code

### Do NOT Document
- What a function does if its name + types already say it
- Step-by-step walkthroughs of obvious code
- Anything that will rot as the code evolves (inline summaries of the current diff)
- Task context, ticket numbers, or current PR references

---

## Where Documentation Lives

| Type | Location |
|------|----------|
| Project-wide conventions | `CLAUDE.md` (project root) |
| AI coding rules | `.cursor/rules/{core-architecture,code-plan,performance-security}.mdc` |
| Architecture decisions | `.cursor/plans/[feature].md` or `docs/adr/` |
| Component/hook API | Inline — one short line only when non-obvious |
| PR context | PR description (not code comments) |
| Env vars and scripts | `CLAUDE.md` + `.env.example` |

---

## Inline Comment Rules

**Default: no comments.** The code and its identifiers already document the WHAT.

Add a comment only when the WHY is non-obvious:
- A hidden constraint the code can't express
- A workaround for a specific external bug
- A subtle invariant that a future reader would likely violate

```typescript
// ✅ Non-obvious constraint — why this order matters
// AppRouterCacheProvider must wrap StoreProvider — Emotion SSR extracts styles before Redux renders

// ✅ Known limitation with a plan
// Token read from localStorage — XSS-vulnerable; migration to httpOnly cookie is planned

// ✅ Non-obvious Sass behaviour
// additionalData in next.config.ts already injects @use 'abstracts' — do not add it again

// ❌ Narrates what the code shows
// Creates a comment using the RTK Query mutation
const [createComment] = useCreateCommentMutation();

// ❌ References the current task
// Fixed in PR #456 — the Select now uses Controller
```

---

## Architecture Decision Record (ADR)

Use for decisions with significant trade-offs. Place in `.cursor/plans/` or `docs/adr/`.

```markdown
# ADR: [Short Title]

**Date:** YYYY-MM-DD
**Status:** Accepted | Superseded by [ADR name]

## Context
What problem are we solving and what constraints exist?

## Decision
What we chose and the key reason.

## Consequences
What becomes easier. What becomes harder or limited.
```

**Example ADRs for this project:**
- "RTK Query is client-side only — Server Components use fetch()"
- "localStorage token — current XSS trade-off and migration plan"
- "SCSS abstracts injected globally via sassOptions.additionalData"

---

## Environment Variable Documentation

When adding a new environment variable:
1. Add to `CLAUDE.md` → Environment Variables section
2. Add to `.env.example` with a placeholder value:
   ```
   NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api
   ```
3. If it's secret: use a non-`NEXT_PUBLIC_` name — `NEXT_PUBLIC_*` is bundled into client JS

---

## PR Description Template

```markdown
## What
One sentence — the user-facing change.

## Why
The motivation (bug report, requirement, tech debt).

## How
Key implementation decisions worth explaining (not a code walkthrough).
E.g.: "Used Server Action instead of RTK Query because the mutation doesn't need cache invalidation."

## Testing
Steps taken to verify the change works.
```
