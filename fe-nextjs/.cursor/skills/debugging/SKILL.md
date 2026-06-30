# Skill: Debugging

## Purpose
Systematically locate, understand, and fix bugs without guessing or making unrelated changes.

---

## Workflow

### 1. Reproduce First
- Confirm the exact steps to trigger the bug
- Note: browser, route, auth state (token in localStorage?), whether error is in server terminal or browser console
- RSC errors appear in the **server terminal**, not the browser console — check both

### 2. Classify the Bug

| Symptom | Likely Layer | First Place to Look |
|---------|-------------|---------------------|
| "Hydration failed" in browser | RSC/CC | Browser API without guard; `Math.random()` or timestamp in RSC body |
| "Event handlers cannot be passed to Client Component props" | Props | Function prop passed from RSC to CC — receiver must be CC |
| Hook error ("Rules of Hooks" / "only for Client Components") | Missing directive | Add `'use client'` to the component |
| Blank page, RSC throws | Server render | **Server terminal** — RSC errors don't appear in browser console |
| 401 on every API request | Auth token | `localStorage.getItem('token')` is null; check DevTools → Application |
| RTK Query returns stale data after mutation | Cache | `invalidatesTags` missing or wrong tag format; check Redux DevTools |
| Server Action returns unexpected error | Server Action | Zod schema mismatch; `formData.get()` key typo; check action return value |
| Route Handler 4xx | Route Handler | Zod shape mismatch; wrong content-type; auth header missing |
| `window is not defined` | Server render | Browser API in RSC or at CC module level without guard |
| SCSS class not applied | SCSS module | Class name typo in `.module.scss`; wrong import path; duplicate `@use 'abstracts'` breaking parse |
| MUI component crashes in RSC | CC boundary | MUI requires client context; add `'use client'` |
| `useRouter` / `usePathname` crashes in RSC | Hook in RSC | Use `redirect()` server-side or move hook to a CC |
| Redirect loop | Routing | Both source and destination route trigger the redirect condition |

### 3. Trace the Data Flow

**Server path** (RSC, Server Actions, Route Handlers):
```
Browser request
  → Next.js router
  → page.tsx (RSC, async)
  → fetch(BASE_URL + '/endpoint', cacheOptions)
  → external API response
  → serializable props passed to CC children
```
Check: Server terminal output, `.next/server/` build artifacts.

**Client path** (Client Components + RTK Query):
```
CC renders → useGetXxxQuery / useXxxMutation
  → baseApi.prepareHeaders (reads localStorage.getItem('token'))
  → fetch to external API
  → RTK Query cache update → component re-renders
```
Check: Browser DevTools → Network tab (confirm Authorization header) → Redux DevTools (confirm cache update).

**Auth path**:
```
Login form → RTK Query loginMutation
  → POST /auth/login → { token, user }
  → localStorage.setItem('token', response.token)
  → subsequent requests pick up token via baseApi.prepareHeaders
```
If 401: check DevTools → Application → Local Storage → `token` key exists and has a value.

### 4. Read Before Touching
Read the actual file at the actual line before changing anything.
Do not assume what the code says — open the file.

### 5. Fix — Minimal
Change only what causes the bug.
Do NOT refactor, rename, or improve nearby code as part of this fix.
If the fix requires touching more than 3 unrelated files, the root cause is deeper — re-classify.

### 6. Verify
- [ ] Original reproduction steps no longer trigger the bug
- [ ] No new browser console or server terminal errors
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes
- [ ] Smoke-test the surrounding feature for regressions

---

## Known Gotchas in This Codebase

**RSC / Client boundary:**
- `window`, `document`, `localStorage` at module level in a CC crash during SSR — guard: `typeof window !== 'undefined'`
- MUI components require `'use client'` — importing them in an RSC causes a build error
- `AppRouterCacheProvider` in `src/app/layout.tsx` must remain there — removing it breaks MUI SSR styles

**RTK Query:**
- Token read from `localStorage.getItem('token')` in `src/services/baseApi.ts` — null → all requests unauthenticated
- `injectEndpoints` shares `baseApi`'s reducer key — no separate reducer to register
- Cache tags must use `as const`: `{ type: 'Ticket' as const, id }` — plain string `'Ticket'` does not match per-item tags

**SCSS:**
- `sassOptions.additionalData` in `next.config.ts` auto-injects `@use 'abstracts' as *;` — adding it manually causes "duplicate @use" parse error
- Variable names: `$color-gray-900`, `$space-4`, `$font-size-sm` — check `src/styles/abstracts/_variables.scss`
- Mixins: `@include respond-to(md)`, `@include flex-center` — check `src/styles/abstracts/_mixins.scss`

**Next.js routing:**
- `params` and `searchParams` in page.tsx are `Promise<...>` in Next.js 16 — must `await` them
- `error.tsx` MUST be a `'use client'` component — it will fail silently if not
