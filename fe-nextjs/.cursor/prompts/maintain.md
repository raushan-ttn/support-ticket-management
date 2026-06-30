---
description: SDLC Phase 6 — maintenance; root-cause debugging and post-release performance tuning
---

@.cursor/prompts/personas/debugger.md
@.cursor/skills/debugging/SKILL.md
@.cursor/skills/performance/SKILL.md

# /maintain — Maintenance & Operations

Pick the mode that fits.

## Mode A — Debug
Find the root cause; fix with the smallest possible change. Do not refactor nearby code.

**Describe:** reproduce steps · expected vs actual · where the error shows (browser console / server terminal / network / build).

1. **Classify** (symptom → first place to look):
   - "Hydration failed" → browser API / `Math.random()`/`Date.now()` in RSC
   - "Event handlers cannot be passed…" → function prop RSC→CC; make receiver a CC
   - "useXxx is only for Client Components" → add `'use client'`
   - blank page / silent crash → RSC threw — **check server terminal first**
   - 401 every request → `localStorage` token null / not saved after login
   - RTK stale after mutation → missing/wrong `invalidatesTags` (need `{ type, id }`)
   - Server Action error → Zod mismatch / `formData.get()` key typo
   - Route Handler 4xx → Zod shape / wrong content-type
   - `window is not defined` → browser API in RSC or CC module scope
   - SCSS class missing → typo / wrong import / duplicate `@use 'abstracts'`
   - MUI/`useRouter` crash in RSC → add `'use client'` or use `redirect()`
2. **Trace** — server path (terminal first) vs client path (Network → Redux → React DevTools) vs auth path (`localStorage` token → `prepareHeaders`).
3. **Isolate** — read the full error and the actual file/line before changing anything; reproduce minimally.
4. **Fix** — change only the root cause; if it touches >3 unrelated files, re-diagnose.
5. **Verify** — repro gone; no new console/terminal errors; `tsc --noEmit` + lint pass; smoke-test surroundings.

## Mode B — Optimize (performance)
Tune a slow/heavy page post-release:
- Reclassify rendering (prefer RSC; push CC to leaves); switch cache mode to fit the data.
- Stream slow fetches with `<Suspense>` + `loading.tsx`.
- Defer heavy client libs with `dynamic()`; check first-load JS (`ANALYZE=true npm run build`).
- Target Core Web Vitals: LCP < 2.5s, INP < 200ms, CLS < 0.1.
- **Output:** Current State → Recommendation → minimal Diff → Expected Impact.

## Done When
- [ ] (Debug) root cause fixed minimally, repro no longer triggers, no regressions.
- [ ] (Optimize) measurable improvement with the smallest change.
