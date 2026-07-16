# Final AI Usage Summary

A rollup of AI's measurable contribution to this repo. Where `reflection.md` is qualitative (what worked, what didn't), this is the quantitative complement — pulled from `git log`, not estimated.

**As of:** 2026-07-09 (through Phase 10).

## Tool

**Claude Code**, via the agent pipeline in `.claude/agents/` (`requirement-fetcher → feature-planner → feature-implementer → code-reviewer → docs-updater`), not ad hoc chat prompting. Full process in `tool-workflow.md`.

## Scale (from `git log --all`)

| Metric | Value |
|---|---|
| Commit range | 2026-06-24 → 2026-07-09 (~2 weeks) |
| Non-merge commits | 29 |
| Commits with a `Co-Authored-By: Claude` trailer | 20 |
| Total insertions / deletions | ~42,800 / ~14,900 |
| Models used (by commit trailer) | Sonnet 4.6 (15), Sonnet 5 (4), Opus 4.8 (1) |

The model mix shifts from Sonnet 4.6 (Phases 0–8, most of the module scaffolding) to Sonnet 5 (Swagger integration onward) — reflects tool availability over the build window, not a deliberate model-selection strategy per phase.

No commit-level time tracking was kept, so this is a structural summary, not a time-split estimate — a fabricated percentage breakdown wouldn't be more informative than the commit/line counts above.

## Where AI added the most value

- **Repetitive, convention-bound scaffolding** — ten phases of `routes → controller → service → schemas` layering stayed structurally consistent because `CLAUDE.md` + `.claude/rules/` gave every session the same constraints, not because each session was reviewed line-by-line against the last.
- **Test suite breadth** — Phase 9 added 187 passing tests across 13 suites, including edge cases (production stack masking, MulterError code mapping) that are easy to skip under time pressure but cheap for AI to generate once the pattern is established.
- **Plan-first surfacing scope questions early** — writing `notifications-email.md` before implementing surfaced the BullMQ/auto-close scope question as a planning-time decision, not a mid-implementation detour.

Full detail: `reflection.md` "What worked well".

## Where AI got it wrong, and where a human overrode it

Concrete, dated entries in `debugging-notes.md` (4) and `code-review-notes.md` (4) — role-casting safety, a `storage_key` leak, a copy-paste path divergence, a multer-chaining bug, and a stale-ENUM-value gap. Two scope decisions were human overrides of an AI-proposed design: dropping BullMQ entirely rather than leaving it half-wired, and retiring the `screenshot` columns once `attachments` made them redundant. See `reflection.md` for the full write-up of each.

## Net assessment

AI materially accelerated the mechanical majority of the build — layered scaffolding, test generation, Swagger annotation — while the genuine judgment calls (what's in scope, what's a real security gap vs. a style nit, when a "working" endpoint is quietly wrong) still required a human pass per phase. The project's own tooling — Non-Negotiables, plan-first workflow, hook-driven review — exists specifically to narrow that gap, and the low defect count in `code-review-notes.md` relative to ~42k lines changed suggests it's doing that job.
