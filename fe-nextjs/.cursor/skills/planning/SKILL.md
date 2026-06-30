# Skill: Feature Planning

## Purpose
Produce a concrete, reviewable implementation plan before writing any code. Planning prevents incorrect rendering strategy choices, missed cache invalidation, and architectural layer violations.

## When to Use
- Adding a new page or route
- Adding a new data-fetching flow
- Integrating a new mutation (RTK Query or Server Action)
- Any change touching more than 3 files

---

## Workflow

### 1. Understand the Requirement
- What does the feature do and who uses it?
- Is authentication required?
- What are the acceptance criteria and edge cases?

### 2. Choose the Rendering Strategy First

This is the most impactful decision — get it right before writing any files.

| Scenario | Strategy |
|----------|----------|
| Public data, rarely changes | Static RSC + `cache: 'force-cache'` |
| Data changes on a schedule | ISR + `next: { revalidate: N, tags: ['tag'] }` |
| User-specific or sensitive data | Dynamic RSC + `cache: 'no-store'` |
| Needs real-time interaction | Client Component + RTK Query |
| Form with server-side validation | Server Action + `useActionState` |
| Form with optimistic update | Client Component + RTK Query mutation |
| Shared interactive state | Redux slice (UI-only state) |

### 3. Map the Impact Area

| Layer | File(s) |
|-------|---------|
| Types | `src/types/[feature].ts` |
| RTK Query (client mutations) | `src/services/[feature]Api.ts` |
| Server Action (server mutations) | `src/actions/[feature]-actions.ts` |
| Route Handler (API proxy) | `src/app/api/[resource]/route.ts` |
| Server Components | `src/components/[Feature]/Server*.tsx` |
| Client Components | `src/components/[Feature]/index.tsx` |
| Page | `src/app/[route]/page.tsx` |
| Loading UI | `src/app/[route]/loading.tsx` |
| Error UI | `src/app/[route]/error.tsx` |
| Store | `src/lib/store/index.ts` (only if new `createApi`) |
| SCSS module | Co-located `.module.scss` |

### 4. Draft a Numbered Task List (in dependency order)

```
1. Define types in `src/types/[feature].ts`
2. Create RTK Query service OR Server Action (whichever is needed)
3. Wire store (only if new createApi — not needed for injectEndpoints)
4. Build Server Component(s) — async fetch, no hooks
5. Build Client Component(s) — 'use client', RTK Query, MUI
6. Create page `src/app/[route]/page.tsx` with metadata export
7. Add loading.tsx and error.tsx
```

### 5. Call Out Risks

- **Client boundary expansion**: Will adding `'use client'` to this component unnecessarily enlarge the client bundle?
- **Cache invalidation**: Which `revalidateTag(...)` calls are needed after mutations?
- **Streaming**: Is there a slow data fetch that blocks the page? Add `<Suspense>`.
- **Auth**: Does the data require the Bearer token? How is it passed? (Server: request header; Client: `localStorage` → `baseApi`)
- **Bundle size**: Does this pull in a large library? Consider `dynamic()`.

### 6. Wait for Approval
Do not write any implementation code until the plan is confirmed.

---

## Output Template

```markdown
## Plan: [Feature Name]

### Rendering Strategy
[Static RSC | ISR | Dynamic RSC | Client CC + RTK Query | Mixed — describe boundary]

### Affected Files
- `src/types/[feature].ts` — new interfaces
- `src/services/[feature]Api.ts` — RTK Query endpoints (client)
- OR `src/actions/[feature]-actions.ts` — Server Actions
- `src/components/[Feature]/` — components
- `src/app/[route]/page.tsx` — page + metadata
- `src/app/[route]/loading.tsx` — skeleton
- `src/app/[route]/error.tsx` — error boundary

### Steps
1. ...
2. ...

### Risks / Open Questions
- Cache: after mutation, revalidate with `revalidateTag('[tag]')`?
- Client boundary: is 'use client' on [X] justified?
- Auth: token needed on server or client?
- Streaming: wrap [Y] in <Suspense>?
```

---

## Constraints
- Follow existing patterns — `CreateTicketForm` and `ticketApi.ts` are the templates
- No new libraries without justification
- RSC by default — justify every `'use client'`
- `injectEndpoints` on `baseApi` always — never a new `createApi()`
