# Skill: Performance Optimization

## Purpose
Audit and improve the rendering strategy, bundle size, and Core Web Vitals of Next.js pages and components.

---

## Rendering Strategy Audit

### Step 1 — Classify Each Component

For every component in the diff or feature:

| Has `'use client'`? | Uses hooks/events/browser API? | Correct? |
|---------------------|-------------------------------|----------|
| Yes | Yes | ✅ Correct |
| Yes | No | ❌ Unnecessary — remove `'use client'` |
| No | Yes | ❌ Will crash — add `'use client'` |
| No | No | ✅ Correct RSC |

### Step 2 — Classify Each Data Fetch

| Data changes how often? | Is it user-specific? | Recommended strategy |
|------------------------|---------------------|---------------------|
| Never (config, categories) | No | Static: `cache: 'force-cache'` |
| Hourly / daily | No | ISR: `next: { revalidate: 3600, tags: ['tag'] }` |
| Every few minutes | No | ISR: `next: { revalidate: 60, tags: ['tag'] }` |
| On every request | No | Dynamic: `cache: 'no-store'` |
| On every request | Yes | Dynamic: `cache: 'no-store'` + auth header |
| After user mutation | N/A | `revalidateTag('tag')` in Server Action |

### Step 3 — Waterfall Check

Sequential fetches that can run in parallel:
```typescript
// ❌ Waterfall — commentsRes waits for ticketRes
const ticket = await fetchTicket(id);
const comments = await fetchComments(id);

// ✅ Parallel
const [ticket, comments] = await Promise.all([fetchTicket(id), fetchComments(id)]);
```

### Step 4 — Suspense Opportunity

Identify slow data fetches that block the entire page render:
- Wrap the slow async component in `<Suspense fallback={<Skeleton />}>`
- Add `loading.tsx` for route-level streaming
- The fast content renders immediately; slow content streams in

---

## Bundle Size Audit

### Add Bundle Analyzer

```typescript
// next.config.ts
import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withBundleAnalyzer(nextConfig);
```

```bash
ANALYZE=true npm run build
```

### Red Flags to Look For

| Issue | Fix |
|-------|-----|
| Full library import (`import _ from 'lodash'`) | Use named import: `import debounce from 'lodash/debounce'` |
| Heavy CC loaded on first paint | `dynamic(() => import('./HeavyComponent'))` |
| MUI full import | Already fine — MUI is tree-shaken by default |
| Large icon library | Prefer SVG imports over icon package bundles |

### `dynamic()` Pattern

```typescript
import dynamic from 'next/dynamic';

// Deferred — not in initial bundle
const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), {
  loading: () => <div>Loading editor…</div>,
  ssr: false,  // only if the component crashes during SSR
});
```

Use `dynamic()` for:
- Rich text editors
- Chart/visualization libraries (if used in CC)
- Map embeds
- Modal/drawer content conditionally shown

---

## Images

```typescript
import Image from 'next/image';

// ✅ Correct
<Image
  src="/ticket-icon.png"
  alt="Ticket icon"
  width={40}
  height={40}
  priority  // only for above-the-fold LCP images
/>

// ❌ Never for content images
<img src="/ticket-icon.png" alt="Ticket icon" />
```

Always set explicit `width` and `height` to prevent CLS.

---

## Core Web Vitals Remediation

### LCP (Largest Contentful Paint) > 2.5s
- Add `priority` to the hero image or banner
- Move data fetching to Server Component to eliminate client-side waterfall
- Use ISR or static caching instead of `cache: 'no-store'` where possible

### CLS (Cumulative Layout Shift) > 0.1
- Set explicit `width`/`height` on all `<Image>` components
- Reserve space for async content with fixed-height skeletons
- Avoid injecting content above existing content after load

### INP (Interaction to Next Paint) > 200ms
- Keep Client Component subtrees small — push `'use client'` down the tree
- Avoid synchronous heavy computation in event handlers — defer with `setTimeout` or Web Workers
- Use RTK Query's optimistic updates to give instant feedback before the server responds

---

## Checklist

- [ ] Every `'use client'` justified — component actually uses hooks/events/browser APIs
- [ ] Parallel `Promise.all` for independent server-side fetches
- [ ] Slow async RSC wrapped in `<Suspense>` with skeleton fallback
- [ ] `loading.tsx` added to all routes with slow data
- [ ] `next/image` for all content images with explicit dimensions
- [ ] Heavy CCs deferred with `dynamic()`
- [ ] Bundle per route under 150KB gzipped (check with bundle analyzer)
- [ ] LCP candidate has `priority` attribute
- [ ] Skeleton components have fixed height (prevent CLS)
