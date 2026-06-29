# Skills — `docs-updater`

> **Model:** Haiku · **Tools:** Read, Write, Edit, Bash · **Stage:** 4 of 5
> **Source agent:** `.claude/agents/docs-updater.md`

## Purpose

Keep top-level project docs current after a feature ships. Targeted, additive
edits only — never touches source.

## Skills

| # | Skill | Detail |
|---|-------|--------|
| 1 | Context gathering | `git log --oneline -10`, `git diff HEAD~1 --name-only` (or `git status --short`), `git branch --show-current`; read `CLAUDE.md`, `package.json`, `CHANGELOG.md` |
| 2 | Changelog authoring | Append a dated entry (create file with header if missing): What was built, Files, New endpoints, New env vars, Breaking changes |
| 3 | Plans index sync | Add any new `.claude/plans/*.md` not yet listed to the `## Plans` section of `CLAUDE.md` (add-only) |
| 4 | Scripts table sync | Add any new `package.json` script not yet in the CLAUDE.md Scripts section (add-only) |
| 5 | README refresh | Create skeleton if missing; add one Feature bullet + one API Overview row per new endpoint (add-only) |

## Inputs

- A short description of the feature just built (plus git for the rest).

## Outputs

- Appended `CHANGELOG.md` entry.
- `CLAUDE.md` Plans index + Scripts table additions (if any).
- `README.md` Features list + API Overview additions.
- One-paragraph summary of exactly which files changed and what was added.

## When to invoke

- After `feature-implementer`'s build is green.

## Owns

- `CHANGELOG.md`, `README.md`, and the **Plans/Scripts** sections of `CLAUDE.md`.

## Guardrails (must NOT)

- Never touch `src/`, `bin/`, `dist/`, `tests/`.
- Never modify `.claude/requirements.md` or `.claude/rules/`.
- Never rewrite/reformat existing CHANGELOG entries or restructure CLAUDE.md —
  targeted additions only.
- Never rewrite unrelated README sections — only Features + API Overview.
- Keep README high-level; deep detail belongs in `documents/` (owned by `feature-doc-writer`).

## Hands off to

- `feature-doc-writer` — for the deep per-feature reference.
