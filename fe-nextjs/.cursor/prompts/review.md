---
description: SDLC Phase 4 — review the diff against project conventions and manually verify behavior
---

@.cursor/prompts/personas/reviewer.md
@.cursor/skills/code-review/SKILL.md
@.cursor/skills/testing/SKILL.md

# /review — Review & Testing (QA)

Review the diff / @mentioned files. Be specific: cite file + line + severity, explain why.

## Severity
| Level | Meaning | Block merge? |
|-------|---------|--------------|
| **Blocker** | Security hole, type-safety crash, broken RSC/CC boundary, missing Server Action validation | Yes |
| **Required** | Convention violation, missing a11y, wrong layer, dead code | Yes |
| **Suggestion** | Style/readability | No |

**Output:** group by file; per finding `**Severity** — Line N: issue. Why.`

## Checklist
- **RSC/CC boundary** — `'use client'` only when needed + on line 1; no MUI/`useRouter`/`window` in RSC; serializable props RSC→CC.
- **TypeScript** — no `any`; everything typed; `interface` for objects; boolean `is/has/can/should`; named exports (default only `page`/`layout`/`error`); `@/` alias.
- **Data** — RSC uses `fetch()` + cache opts (not RTK Query); RTK hooks only in CC; `providesTags`/`invalidatesTags` present; no `useEffect` fetching.
- **Server Actions** — `'use server'`; Zod before any call; returns `{success,error?}` (no raw throw); revalidate on success; no secrets in return.
- **Route Handlers** — auth checked; body Zod-validated; correct status codes; no stack traces; `NextRequest`/`NextResponse`.
- **Forms** — `noValidate`; MUI via `Controller`; field errors via `helperText`/`FormHelperText`; API errors `role="alert"`; submit `disabled={isLoading}`; no `useState` for values.
- **SCSS** — no `@use 'abstracts'`; co-located kebab-case; semantic class names; no inline `style={{}}` for component styles.
- **Security** — no secrets in `NEXT_PUBLIC_*`; no tokens/PII returned; no `dangerouslySetInnerHTML` without DOMPurify.
- **Performance** — RSC default; heavy CC via `dynamic()`; `next/image`; slow RSC in `<Suspense>`.
- **General** — no `console.log`/dead code/unjustified libs; pages export `metadata`.

## Manual Verification (no test runner yet — see `testing/SKILL.md`)
- [ ] Happy path end-to-end; loading + error states; forms show success/error feedback; no console/terminal errors; no regressions nearby.

## Done When
- [ ] No open Blocker/Required findings; manual verification passed.
