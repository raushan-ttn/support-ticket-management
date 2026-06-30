# Skill: Code Review

## Purpose
Review a diff or set of files for correctness, Next.js convention compliance, security, and performance. Produce actionable findings at specific line numbers with severity levels.

---

## Severity Levels

| Level | Definition | Must fix before merge? |
|-------|-----------|----------------------|
| **Blocker** | Security hole, type safety violation causing runtime crash, broken RSC/CC boundary, missing Server Action validation | Yes |
| **Required** | Convention violation, missing accessibility, architectural layer violation, dead code | Yes |
| **Suggestion** | Readability improvement, minor style preference | No |

---

## Review Checklist

### RSC / Client Component Boundary
- [ ] No `'use client'` on components that have no hooks, events, or browser APIs
- [ ] `'use client'` is on line 1 (before all imports) in every Client Component
- [ ] No MUI interactive components rendered in Server Components without a CC parent
- [ ] No `useRouter`, `usePathname`, `useSearchParams` in Server Components
- [ ] No `window`/`document`/`localStorage` in Server Components or at module level in CCs
- [ ] Props passed from RSC to CC are serializable (no functions, class instances, Promises)

### TypeScript
- [ ] No `any` — `unknown` with type narrowing used instead
- [ ] All props, hook args, and function return values explicitly typed
- [ ] `interface` for object shapes (not `type` aliases for plain objects)
- [ ] Boolean names start with `is`, `has`, `can`, `should`
- [ ] Named exports everywhere; `default` export only for `page.tsx`, `layout.tsx`, `error.tsx`
- [ ] `@/` path alias used — no relative `../../` imports crossing feature boundaries

### Data Fetching
- [ ] Server Components use `fetch()` with explicit cache options — not RTK Query hooks
- [ ] RTK Query hooks only in components with `'use client'`
- [ ] `providesTags` on every `query` endpoint, `invalidatesTags` on every `mutation`
- [ ] No `useEffect` for data fetching — RTK Query subscriptions handle this
- [ ] Parallel fetches use `Promise.all` — no unnecessary waterfalls

### Server Actions
- [ ] `'use server'` at top of the action file
- [ ] Zod schema validates ALL `formData` fields before any API call or mutation
- [ ] Returns `{ success, error? }` — does not throw raw errors
- [ ] `revalidatePath` or `revalidateTag` called after successful mutation
- [ ] No tokens, secrets, or PII in return values

### Route Handlers
- [ ] Auth token extracted from headers and validated on every protected endpoint
- [ ] Request body validated with Zod before processing
- [ ] Correct HTTP status codes in all response branches (201 for create, 204 for delete, etc.)
- [ ] No raw DB errors or stack traces in JSON error responses
- [ ] `NextRequest` / `NextResponse` used throughout

### Forms
- [ ] `noValidate` on every `<form>` / `<Box component="form">`
- [ ] Every MUI input wrapped in `Controller` from react-hook-form
- [ ] Field errors displayed via `helperText` (TextField) or `FormHelperText` (Select)
- [ ] API errors rendered separately from field errors, with `role="alert"`
- [ ] Submit button `disabled={isLoading}` with loading label
- [ ] No `useState` managing form field values

### SCSS Modules
- [ ] NO `@use 'abstracts' as *;` in `.module.scss` files (auto-injected — duplicate breaks build)
- [ ] Module co-located with its component, kebab-case filename
- [ ] Class names are semantic (`wrapper`, `field`, `title`), not visual (`red-text`, `big-margin`)
- [ ] No inline `style={{}}` for component-specific styles

### Security
- [ ] No secrets in `NEXT_PUBLIC_*` environment variables
- [ ] No tokens stored in Redux state or returned from Server Actions
- [ ] No `dangerouslySetInnerHTML` without DOMPurify sanitization
- [ ] All Server Action and Route Handler inputs validated with Zod

### Performance
- [ ] Default to RSC — `'use client'` is justified in every CC
- [ ] Heavy Client Components deferred with `dynamic()`
- [ ] `<Image>` from `next/image` used — no bare `<img>` for content images
- [ ] Slow async Server Components wrapped in `<Suspense>`
- [ ] Every page has `metadata` or `generateMetadata` export

### General
- [ ] No `console.log` in production code paths
- [ ] No dead code or unused imports
- [ ] No new libraries without justification
- [ ] All pages have SEO `metadata` export

---

## Output Format

```
### [File: src/components/TicketsPage/dependencies/CreateTicketForm/index.tsx]

**Blocker** — Line 14: `any` on `formData`. Use `CreateTicketPayload` — type safety hole.

**Required** — Line 67: MUI `Select` not wrapped in `Controller`. Value not tracked by RHF.

**Required** — Line 89: `@use 'abstracts' as *;` in `CreateTicketForm.module.scss`.
This is auto-injected by sassOptions — adding it manually causes a "duplicate @use" parse error.

**Suggestion** — Line 102: Extract `apiError` derivation into a named variable for clarity.
```
