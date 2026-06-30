---
description: SDLC Phase 3 — implement a feature end-to-end (page, components, services, actions, forms, metadata, figma)
---

@.cursor/prompts/personas/implementer.md
@.cursor/skills/implementation/SKILL.md

# /build — Implementation

Implement the approved work below. Follow `rules/*.mdc` exactly (they hold the code patterns); this prompt is the procedure. Build one file at a time, no TODOs.

## What to Build
[DESCRIBE THE APPROVED FEATURE / ARTIFACT]

## Implementation Order (full feature)
1. **Types** `src/types/[feature].ts` — `interface`, no `any`, reuse existing (`Ticket`, `TicketStatus`, …).
2. **Data layer** — RTK Query service `src/services/[feature]Api.ts` via `injectEndpoints` on `baseApi` (no new `createApi`, no new reducer) **OR** Server Action `src/actions/[feature]-actions.ts` (`'use server'`, Zod first, return `{success,error?}`, revalidate on success).
3. **Store** `src/lib/store/index.ts` — only if you created a new `createApi`.
4. **Server Component(s)** — `async`, `fetch()` with cache opts, throw to `error.tsx`, pass serializable props.
5. **Client Component(s)** `src/components/[Feature]/` — `'use client'` line 1, named export, kebab-case file, co-located `.module.scss`, MUI inputs via `Controller`, `role="alert"` errors, `disabled={isLoading}`.
6. **Page** `src/app/[route]/page.tsx` — default export, `metadata`, compose RSC/CC, wrap slow RSC in `<Suspense>`.
7. **loading.tsx** (skeleton) + **error.tsx** (`'use client'` with `reset`).

## Modes (build only what's asked)
- **Page** — steps 6–7 (+ component in `src/components/`); choose cache by data type.
- **Server Component** — step 4 + a `*Skeleton` for the Suspense fallback.
- **Client Component** — step 5 (RTK Query hook for data, handle loading + error).
- **API Service** — step 2 (RTK Query); `providesTags`/`invalidatesTags` with `{ type, id }` + `LIST`; export hooks.
- **Server Action** — step 2 (action) + wire in a Client form via `useActionState` + `useFormStatus`.
- **Form** — Client Component: `useForm` + `zodResolver`, `z.infer` for values, `Controller` for MUI, `noValidate`, reset on success; submit via RTK Query mutation **or** Server Action.
- **Metadata** — export `metadata` (static) or `generateMetadata` (dynamic, awaits `params`); title with site suffix, description < 155 chars; `robots:{index:false}` for auth-only pages.
- **Figma → code** — pull design via Figma MCP (`get_design_context`/`get_screenshot`/`get_variable_defs`); map tokens to SCSS abstracts (never hardcode hex/px); RSC unless interactive; `next/image` for images.

## Quality Gates
- [ ] No `any`, no `console.log`, no dead code/unused imports.
- [ ] `'use client'` only where needed and on line 1; props RSC→CC serializable.
- [ ] No `@use 'abstracts'` in `.module.scss` (auto-injected); MUI inputs in `Controller`; error spans `role="alert"`.
- [ ] Page exports `metadata`/`generateMetadata`.
- [ ] `npx tsc --noEmit` and `npm run lint` pass; feature works in `npm run dev`.
