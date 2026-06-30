---
description: SDLC Phase 5 — pre-release checklist; verify build, auth, env, security, bundle, a11y
---

@.cursor/skills/release/SKILL.md

# /release — Release & Deployment

Run every check and report status per item. Block release on any failure (report exact output).

## 1. Code Quality
`npx tsc --noEmit` (zero errors) · `npm run lint` (zero errors) · `npm run format:check` (all formatted).

## 2. Build
`npm run build` (no errors) · `npm run start` — app loads on :3000, no console errors, View Source shows pre-rendered SSR HTML.

## 3. Auth Flow
- [ ] Token saved to `localStorage` as `'token'` after login; cleared on logout.
- [ ] Authed requests send `Authorization: Bearer <token>`; unauthed get 401.

## 4. Feature Smoke Tests (per changed route)
- [ ] Happy path end-to-end; loading + error states render (kill API to confirm); forms show success/error feedback.

## 5. Environment
- [ ] `NEXT_PUBLIC_API_BASE_URL` correct for target; no secrets in `NEXT_PUBLIC_*`; `.env.local` gitignored and unstaged.

## 6. Security
- [ ] No sensitive `console.log`; no tokens in Redux/Server Action returns; all Server Actions Zod-validated; no unsanitized `dangerouslySetInnerHTML`.

## 7. Bundle (when deps change)
`ANALYZE=true npm run build` — [ ] first-load JS < 150KB gz/route; no unexpected large chunks; heavy components via `dynamic()`.

## 8. Accessibility (new UI)
- [ ] Keyboard-reachable; errors `role="alert"`; images have `alt`; inputs labeled; visible focus indicators.

## Done When
All items pass.
