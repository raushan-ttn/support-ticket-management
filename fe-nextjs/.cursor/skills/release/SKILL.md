# Skill: Release

## Purpose
Run a consistent pre-release checklist to ensure the Next.js build is correct, secure, and ready to ship.

---

## Pre-Release Checklist

### 1. Code Quality

```bash
npx tsc --noEmit     # Must pass with zero errors (no type-check npm script — use this directly)
npm run lint         # Must pass with zero errors
npm run format:check # Must pass — all files formatted
```

- [ ] `npx tsc --noEmit` — zero type errors
- [ ] `npm run lint` — zero errors (pre-existing warnings acceptable)
- [ ] `npm run format:check` — no unformatted files

### 2. Build Verification

```bash
npm run build
npm run start
```

- [ ] Build completes without errors or warnings
- [ ] `.next/` directory generated successfully
- [ ] App loads on `http://localhost:3000` (or configured port)
- [ ] No JavaScript console errors in browser after initial load
- [ ] View Source confirms Server-Side pre-rendering: HTML content in `<body>`, not just script tags
- [ ] All routes navigate correctly (spot-check: `/`, `/tickets`, `/tickets/[id]`)

### 3. Auth Flow
- [ ] Bearer token stored as `'token'` in localStorage after successful login
- [ ] Authenticated API requests include `Authorization: Bearer <token>` header (Network tab)
- [ ] 401 responses handled gracefully — no unhandled crashes
- [ ] After logout, `'token'` cleared from localStorage
- [ ] Protected routes inaccessible without token (if auth guards implemented)

### 4. Feature Smoke Tests
For every changed route, run through:
- [ ] Happy path end-to-end
- [ ] Loading state displays (skeleton or spinner)
- [ ] Error state displays when API is blocked
- [ ] Form validation errors appear correctly
- [ ] Mutations update the UI without requiring page reload

### 5. Environment Variables
- [ ] `NEXT_PUBLIC_API_BASE_URL` resolves correctly for the target environment
- [ ] No secrets in any `NEXT_PUBLIC_*` variable
- [ ] `.env.local` is in `.gitignore` and not staged
- [ ] Production environment has all required variables set

### 6. Security
- [ ] No `console.log` with sensitive data in the production bundle
- [ ] No tokens in Redux state or Server Action return values
- [ ] All Server Actions validate with Zod
- [ ] No `dangerouslySetInnerHTML` without sanitization

### 7. Bundle Audit (when dependencies change significantly)

Add `@next/bundle-analyzer` to `next.config.ts` temporarily:
```bash
ANALYZE=true npm run build
```

- [ ] First-load JS per route under 150KB gzipped
- [ ] No unexpected large chunks (check for full library imports)
- [ ] Heavy Client Components use `dynamic()` for deferred loading

### 8. Core Web Vitals Spot Check
Open the deployed app in Chrome → DevTools → Lighthouse:
- [ ] LCP (Largest Contentful Paint) < 2.5s
- [ ] CLS (Cumulative Layout Shift) < 0.1
- [ ] INP (Interaction to Next Paint) < 200ms

---

## Release Commit Standard
- No WIP, debug, or `console.log` commits in history
- Commit messages describe the change, not the process
- PR description filled out: What / Why / How / Testing

---

## Environment Variables Reference

| Variable | Required | Where Used |
|----------|----------|-----------|
| `NEXT_PUBLIC_API_BASE_URL` | Yes | `src/services/baseApi.ts` — external backend base URL |

---

## Build Output Reference

| Command | What it produces |
|---------|-----------------|
| `npm run build` | Optimized Next.js build in `.next/` |
| `npm run start` | Serves the production build on port 3000 |
| `npm run dev` | Development server with Fast Refresh |
