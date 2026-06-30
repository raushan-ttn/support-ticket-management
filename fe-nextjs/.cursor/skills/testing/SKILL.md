# Skill: Testing

## Purpose
Define what to test, how to verify features, and the testing strategy. No automated test runner is currently configured — this skill covers manual verification and the future testing roadmap.

---

## Current State
> No automated test runner is configured in this project.
> Until one is added, verification is via type-checking, linting, and structured manual testing.

---

## Automated Checks (Always Run Before PR)

```bash
npx tsc --noEmit     # TypeScript — catches type mismatches and missing types
npm run lint         # ESLint — catches code quality issues
npm run format:check # Prettier — ensures consistent formatting
```

All three must pass cleanly.

---

## Manual Verification Protocol

### For Every Feature Change, Cover:

#### 1. Server Component Data Fetching
- Confirm the page loads with pre-rendered HTML (View Source → data visible in `<body>`)
- Confirm the correct cache strategy: kill the API → static pages still load; dynamic pages show error UI
- Confirm `loading.tsx` skeleton displays during navigation

#### 2. Client Component Interactivity
- Walk through the feature end-to-end as an authenticated user
- Confirm RTK Query hooks fetch data on mount
- Confirm mutations update the UI without a page reload

#### 3. Form Validation
- Submit with empty required fields → inline errors appear on each field
- Submit with invalid formats → correct Zod error messages shown
- Submit button disabled while loading; label reflects loading state
- Successful submit → form resets, success feedback visible

#### 4. API Error States
- Block the external API (DevTools → Network → Block request URL)
- Server Component: confirm `error.tsx` error boundary triggers
- Client Component: confirm RTK Query error state renders with `role="alert"`
- Server Action: confirm `{ success: false, error: '...' }` renders in the form

#### 5. Auth Flow
- With valid token in localStorage: API requests include `Authorization: Bearer <token>` header
- With no token: requests go unauthenticated (check Network tab for missing Authorization header)
- 401 response: confirm the UI handles it gracefully (not a blank crash)

#### 6. RSC/CC Boundary
- Open React DevTools → confirm components labelled correctly (Server vs Client)
- No hydration mismatch warnings in browser console
- No "window is not defined" in server terminal

#### 7. Responsive Layout
- Check at 375px (mobile), 768px (tablet), 1280px (desktop)
- SCSS `respond-to()` breakpoints applied correctly

---

## When a Test Runner Is Added

Recommended stack: **Vitest** + **React Testing Library** + **MSW** (API mocking).

### What to Unit Test
- Zod schemas: valid and invalid input shapes
- RTK Query slice reducers: `providesTags` / `invalidatesTags` behaviour
- Redux slices: `setAuth`, `clearAuth` reducers (when auth slice is added)
- Utility functions in `src/lib/`

### What to Integration Test
- Client Component forms: render → fill → submit → assert mutation called with correct payload
- RTK Query hooks: render CC, MSW intercepts fetch → assert loading / success / error states

### What NOT to Mock
- Never mock the Redux store — use a real `makeStore()` instance
- Never mock RTK Query hooks — let MSW intercept at the network level
- Never mock `fetch()` directly — use MSW's request handlers

### File Placement
```
src/
  components/TicketsPage/__tests__/TicketsPage.test.tsx
  services/__tests__/ticketApi.test.ts
  lib/store/slices/__tests__/auth-slice.test.ts
```

### Test Naming
- `it('renders ticket list when data loads')` — behaviour, not implementation
- `it('shows error message when API returns 422')` — user-visible outcome
- No test names that mirror the component's internals
