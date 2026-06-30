# Cursor AI Configuration — support-ticket-management (Next.js)

This directory configures how Cursor AI behaves in the `fe-nextjs` project.
Three building blocks work together:

```
.cursor/
  rules/       ← Consolidated coding conventions (3 auto-applied .mdc rules)
  prompts/     ← Task-specific prompts (invoke with / in Cursor chat)
    personas/  ← AI behaviour modes (loaded automatically by prompts)
  skills/      ← Reference checklists (loaded by prompts or @mentioned manually)
```

---

## How it wires together

```
Prompt (you invoke via /)
  └─ @includes Persona  →  sets AI mindset and approach
  └─ @includes Skill    →  injects the relevant checklist
       ↑
Rules auto-attach: core-architecture always; the other two by file glob (no action needed)
```

When you type `/build` in Cursor chat, it:
1. Loads the **Implementer** persona (RSC-first, types-first, convention-over-invention)
2. Loads the **Implementation** skill checklist (types → service → server component → client component → page)
3. Runs your specific feature request in that context

---

## Project Philosophy

This project is a **Next.js 16 App Router** application with React 19.
The rendering model is the most important architectural concept to understand:

- **Default to Server Components.** No `'use client'` unless you need hooks, event handlers, or browser APIs.
- **Push the client boundary down.** A page can be a Server Component that renders a Client Component leaf — not the other way around.
- **RTK Query is client-side only.** Use `fetch()` in Server Components for server-side data loading.
- **Server Actions** replace POST API calls for mutations in forms when no external client is needed.

---

## Rules (3 consolidated `.mdc` rules — auto-applied)

The original 13 per-topic rule files were consolidated into 3 token-optimized `.mdc`
rules (rule statements only, no code samples).

| File | Apply | Covers | Topics |
|------|-------|--------|--------|
| `rules/core-architecture.mdc` | `alwaysApply: true` | App architecture & rendering model | Stack, core principles, TypeScript, Server Components, Client Components, App Router routing, data-fetching strategy, RTK Query & Redux store |
| `rules/code-plan.mdc` | glob: `src/actions/**`, `src/app/api/**`, `*Form*.tsx`, `*.module.scss` | Build-time conventions | Server Actions, Route Handlers, forms (react-hook-form + Zod + MUI), SCSS Modules |
| `rules/performance-security.mdc` | glob: `src/app/**`, `src/components/**`, `src/services/**`, `next.config.ts` | Performance & security | Rendering strategy, images, fonts, bundle, Core Web Vitals, token storage, env vars, input validation, XSS, CSP, logging |

> `core-architecture` is always in context; the other two auto-attach when matching
> files are in scope — no action needed.

---

## SDLC Workflow — Prompts by Phase (invoke with `/` in Cursor chat)

**One prompt per SDLC phase.** Each prompt auto-loads its persona (mindset) + skill(s)
(checklist) and uses **modes** to cover its sub-tasks. Pick the prompt for the phase you're in.

```
1 Plan ─► 2 Design ─► 3 Build ─► 4 Review/Test ─► 5 Release ─► 6 Maintain
 /plan     /design    /build      /review        /release     /maintain
 planner   architect  implementer reviewer        —           debugger
```

| Phase | Prompt | Persona | Skill(s) | Covers (modes) |
|-------|--------|---------|----------|----------------|
| 1 Plan | `/plan` | Planner | planning | Rendering strategy, affected files, risks — approval gate |
| 2 Design | `/design` | Architect | performance, documentation | A: rendering/architecture analysis · B: docs & ADRs |
| 3 Build | `/build` | Implementer | implementation | Feature, page, RSC, CC, route handler, server action, API service, form, metadata, figma→code |
| 4 Review | `/review` | Reviewer | code-review, testing | Convention/security/a11y review + manual verification |
| 5 Release | `/release` | — | release | Build, auth, env, security, bundle, a11y checklist |
| 6 Maintain | `/maintain` | Debugger | debugging, performance | A: root-cause debug · B: performance tuning |

**Exit criteria per phase:**
1. **Plan** — approved plan: rendering decision, affected files, ordered steps, flagged risks (cache, client boundary, auth, bundle, streaming).
2. **Design** — chosen rendering/caching strategy per component; ADR written for any decision with notable trade-offs.
3. **Build** — code complete, `npx tsc --noEmit` and `npm run lint` pass, no `console.log`/dead code, conventions honored.
4. **Review** — no Blocker/Required findings open; manual verification passed (no test runner yet — see `skills/testing/SKILL.md`).
5. **Release** — every release-checklist item passes; failures reported with exact output and block the release.
6. **Maintain** — root cause fixed with the smallest change; reproduction no longer triggers; no regressions; type-check and lint pass.

> **Documentation** isn't a separate phase/prompt — it's folded into `/design` **Mode B** (docs & ADRs)
> and applied throughout: ADRs in Design, inline WHY-comments during Build, env/script docs at Release.

---

## Personas (`.cursor/prompts/personas/`)

Personas set the AI's mindset and response style. Loaded automatically by prompts.
You can also `@`-mention them manually to switch mode mid-conversation.

| Persona | Mindset |
|---------|---------|
| `architect.md` | RSC-first, understand rendering model, reject complexity |
| `planner.md` | Map impact across layers, flag rendering/caching risks, wait for approval |
| `implementer.md` | Convention-first, types-first, one file at a time, no TODOs |
| `debugger.md` | Reproduce → classify → trace → minimal fix → verify |
| `reviewer.md` | Specific findings, cite lines, severity-classified, RSC/CC boundary focus |

---

## Skills (`.cursor/skills/`)

| Skill | Content |
|-------|---------|
| `planning/SKILL.md` | Next.js layer map, rendering strategy decision, risk checklist |
| `implementation/SKILL.md` | Step-by-step: types → service → RSC → CC → page → layout |
| `code-review/SKILL.md` | Next.js review checklist with severity levels |
| `debugging/SKILL.md` | Bug classification table, server/client data flow trace |
| `documentation/SKILL.md` | What to document, where it lives, inline comment rules, ADR template |
| `testing/SKILL.md` | Manual verification protocol for Next.js (no test runner yet) |
| `release/SKILL.md` | Build, type-check, lint, env, security, bundle checklist |
| `performance/SKILL.md` | Rendering audit, Core Web Vitals, image/font, Suspense/streaming |

---

## Stack Reference

| Concern | Tool | Notes |
|---------|------|-------|
| Framework | Next.js 16 App Router | RSC by default |
| Language | TypeScript strict | `@/*` → `./src/*` |
| UI components | MUI v9 + `@mui/material-nextjs` | `AppRouterCacheProvider` in layout |
| Data fetching (server) | `fetch()` in RSC | With cache options |
| Data fetching (client) | RTK Query | Client components only |
| App state | Redux Toolkit | `StoreProvider` in layout |
| Forms | react-hook-form + Zod + `Controller` | MUI inputs via Controller |
| Styles | SCSS Modules + Tailwind v4 | Abstracts auto-injected |
| Auth | Bearer token in `localStorage` | XSS risk — plan migration |

---

## Typical Workflows

Follow the SDLC phases above — one prompt each.

### Ship a feature (full path)
```
/plan      →  describe feature  →  get plan  →  approve
/design    →  (optional) confirm rendering strategy / write an ADR
/build     →  implement the approved plan
/review    →  @mention the diff
/release   →  run checklist before shipping
```

### Fix a bug or tune performance
```
/maintain  →  Mode A: describe symptom + repro steps   (debug)
/maintain  →  Mode B: @mention the slow page/component (optimize)
```
