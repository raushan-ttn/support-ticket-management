# Agent Skills Index

Per-agent skill references for the Support Ticket Management backend sub-agents.
Each file documents one agent's purpose, discrete skills, inputs/outputs,
ownership, guardrails, and pipeline wiring. Source definitions live in
`.claude/agents/*.md`.

## Agents

| Stage | Agent | Model | Role | Skills file |
|:-----:|-------|-------|------|-------------|
| 1 | `requirement-fetcher` | Haiku | Extract relevant spec from `requirements.md` + `task.md` (with done/pending status) | [requirement-fetcher-skills.md](./requirement-fetcher-skills.md) |
| 2 | `feature-planner` | Sonnet | File-level plan → `.claude/plans/{slug}.md` (planning only) | [feature-planner-skills.md](./feature-planner-skills.md) |
| 3 | `feature-implementer` | Sonnet | Implement from plan; run tsc/lint/test; check off `task.md` | [feature-implementer-skills.md](./feature-implementer-skills.md) |
| — | `code-reviewer` | Opus | Review single-file diff against conventions (hook-driven) | [code-reviewer-skills.md](./code-reviewer-skills.md) |
| 4 | `docs-updater` | Haiku | Update `CHANGELOG.md`, `README.md`, CLAUDE.md Plans/Scripts | [docs-updater-skills.md](./docs-updater-skills.md) |
| 5 | `feature-doc-writer` | Sonnet | Write `documents/{slug}.md` feature reference | [feature-doc-writer-skills.md](./feature-doc-writer-skills.md) |

## Pipeline

```
requirement-fetcher → feature-planner → feature-implementer → docs-updater → feature-doc-writer
   (extract IDs)        (plan file)       (code + tests)        (README/      (documents/{slug}.md)
                                                ↓                CHANGELOG)
                                          code-reviewer
                                       (hook on every .ts/.js
                                          Edit/Write)
```

- **`/build-feature <name>`** (`.claude/commands/build-feature.md`) runs the full
  chain with checkpoints after plan and after implementation.
- `code-reviewer` is **not** a linear stage — it auto-fires via
  `settings.json` `PostToolUse` → `.claude/hooks/file-review.sh` on every `.ts`/`.js`
  Edit/Write. All other agents are invoked on demand via the Agent tool.
- Agents cannot call each other; the main session orchestrates the hand-offs.

## Conventions referenced by these agents

| Topic | File |
|-------|------|
| Non-Negotiables, architecture, env vars | `CLAUDE.md` |
| Security, Auth, RBAC, File Uploads | `.claude/rules/security.md` |
| API Design, TypeScript, Code Structure, Testing | `.claude/rules/api-conventions.md` |
| PostgreSQL, Redis, BullMQ | `.claude/rules/db-conventions.md` |
| Canonical spec / live progress | `.claude/requirements.md` · `.claude/task.md` |
