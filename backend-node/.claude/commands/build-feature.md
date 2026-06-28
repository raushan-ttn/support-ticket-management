---
description: Run the full feature pipeline (requirements → plan → code → docs) for a backend feature
argument-hint: <feature name or description>
---

You are orchestrating the end-to-end feature pipeline for the Support Ticket Management backend. The feature to build is:

**$ARGUMENTS**

Subagents cannot call each other — you (the main session) drive every step. Run the stages in order, passing each stage's output into the next. Do not skip a stage. Pause for the user only at the explicit checkpoints below.

## Stage 1 — Fetch requirements
Call the `requirement-fetcher` agent with the feature above. It returns the relevant requirement IDs, RBAC/validation/cache rules, test IDs, and the matching `task.md` phase with done/pending status.

- If it reports the feature is already fully done in `task.md` (all items `[x]`), stop and tell the user — do not rebuild finished work.
- If it finds no matching requirements, stop and ask the user to clarify the feature.

## Stage 2 — Plan
Call the `feature-planner` agent. Pass it the feature name **and the exact requirement IDs from Stage 1** so it does not re-derive them. It saves a plan to `.claude/plans/{feature-slug}.md`.

**CHECKPOINT:** Show the user the saved plan path and a short summary. Ask whether to proceed to implementation, or revise the plan first. Wait for confirmation before Stage 3.

## Stage 3 — Implement
Call the `feature-implementer` agent. Pass it the plan slug from Stage 2. It writes schema/schemas/service/controller/routes, mounts the router, adds tests, runs `tsc`/`lint`/`test`, and checks off completed `task.md` items.

- As it writes `.ts` files, the `code-reviewer` hook (`file-review.sh`) fires automatically on each change. Collect those review findings.
- If the implementer finishes on a red build (tsc/lint/test failing) for a non-environmental reason, fix it (or re-invoke the implementer) before continuing.

## Stage 4 — Address review findings
Review the `code-reviewer` output gathered during Stage 3. Triage every `[HIGH]` and `[MED]` finding: fix it in the working tree, or explicitly justify leaving it. Re-run `npx tsc --noEmit` and `npm test` after any fix.

**CHECKPOINT:** Summarize what was built, the build status, and how each review finding was resolved. Ask the user to confirm before updating docs.

## Stage 5 — Update docs
Call the `docs-updater` agent with a short description of what was built. It appends to `CHANGELOG.md`, updates `README.md` (features + endpoint overview), and updates the Plans/Scripts sections in `CLAUDE.md` if needed.

## Stage 6 — Feature document
Call the `feature-doc-writer` agent with the feature name and description. It writes `documents/{feature-slug}.md`.

## Finish
Print a final report:
- Files created/modified
- New endpoints
- `tsc` / `lint` / `test` status
- `task.md` items checked off
- Docs updated (`CHANGELOG.md`, `README.md`, `documents/{slug}.md`)
- Anything deferred, and why

Do **not** commit or push unless the user explicitly asks. If on the `master` branch, remind the user to switch to a feature branch first.
