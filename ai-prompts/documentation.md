# AI Prompts — Documentation

> Same caveat as `planning.md` — no verbatim transcript exists. Unlike the other six phases,
> `tool-workflow.md` doesn't document a standalone "documentation" prompting section — in this
> project, documentation updates were driven structurally by two dedicated agents rather than
> ad hoc prompts, so there is no separate template to transcribe here.

## How documentation actually got updated

- **`docs-updater`** (`.claude/agents/docs-updater.md`, Haiku) — invoked after a feature is
  completed. Appends a dated entry to `CHANGELOG.md`, refreshes `README.md`'s feature list and
  endpoint overview, and updates `CLAUDE.md`'s Plans index / Scripts table if new plans or npm
  scripts were introduced. Explicitly never touches `.claude/requirements.md` or `.claude/rules/`.
- **`feature-doc-writer`** (`.claude/agents/feature-doc-writer.md`, Sonnet) — invoked once a
  feature is complete, writes a `documents/{slug}.md` reference covering the feature's endpoints,
  data model changes, RBAC rules, caching behavior, and how to test it (see `documents/` in this
  repo: `auth-validation-upload.md`, `tickets-module.md`, `comments-module.md`,
  `attachments-module.md`, `notifications-email.md`, `phase-0-gaps.md`, `phase-1-schema-alignment.md`,
  `phase-9-tests.md`).

Both are stages in `/build-feature`'s pipeline (`requirement-fetcher → feature-planner →
feature-implementer → code-reviewer → docs-updater`), run automatically after implementation
rather than prompted individually per doc update.

## Related Files
- `.claude/agents/docs-updater.md` / `.claude/agents/feature-doc-writer.md` — the agent definitions
- `documents/*.md` — actual generated feature docs
- `CHANGELOG.md` / `README.md` — actual files `docs-updater` maintains
