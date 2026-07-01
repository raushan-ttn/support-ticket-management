---
description: Run the code-reviewer agent on changed files. Pass a file path to review one file, or leave blank to review all modified .ts/.js files vs HEAD.
argument-hint: [file path] (optional — omit to review all changed files)
---

You are running a manual code review using the project's `code-reviewer` agent.

Target: **$ARGUMENTS**

## Steps

### 1 — Collect files to review

If `$ARGUMENTS` is a non-empty file path, use only that file.

If `$ARGUMENTS` is empty, run:
```
git diff HEAD --name-only
```
and filter the output to `.ts` and `.js` files, excluding:
- `*.test.ts` / `*.spec.ts` / `*.test.js` / `*.spec.js`
- `src/db/*`

If no files match, report "Nothing to review — no changed source files." and stop.

### 2 — Build a diff per file

For each file, get its diff:
```
git diff HEAD -- <file>
```
If the diff is empty (file is untracked), fall back to:
```
git diff --no-index /dev/null <file>
```
Skip any file whose diff has fewer than 3 changed lines.

### 3 — Review each file

For each file with a meaningful diff, call the `code-reviewer` agent (defined in `.claude/agents/code-reviewer.md`). Pass:
- The unified diff
- The file path

Collect all findings.

### 4 — Report

Print a consolidated report grouped by file:

```
── code-reviewer ────────────────────────────────────────────────────────

src/modules/tickets/ticket.service.ts
  [HIGH] ...
  [MED]  ...

src/modules/tickets/ticket.controller.ts
  ✓ No issues found.

─────────────────────────────────────────────────────────────────────────
Summary: N file(s) reviewed · X HIGH · Y MED · Z LOW
```

If all files are clean, print only the summary line with zeroes.
Do NOT fix anything — report findings only. The user decides what to act on.
