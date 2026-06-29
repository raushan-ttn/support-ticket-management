#!/usr/bin/env bash
# PostToolUse hook — spawns the code-reviewer sub-agent defined in .claude/agents/code-reviewer.md
# whenever a .ts or .js source file is edited or written.
#
# Invoked by Claude Code after every Edit/Write tool call.
# Exits 0 always — never blocks the main session.

set -uo pipefail

# ── 1. Parse the hook payload ───────────────────────────────────────────────
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# ── 2. Guard: only TS/JS source files ───────────────────────────────────────
[[ -z "$FILE_PATH" ]] && exit 0

case "$FILE_PATH" in
  *.ts|*.js) ;;
  *) exit 0 ;;
esac

# Skip test files and auto-generated DB DDL — too noisy / not meaningful to review
case "$FILE_PATH" in
  *.test.ts|*.spec.ts|*.test.js|*.spec.js) exit 0 ;;
  */src/db/*) exit 0 ;;
esac

# ── 3. Build the diff ────────────────────────────────────────────────────────
# Try HEAD diff first; fall back to staged diff; then fall back to a full-file
# diff for brand-new untracked files that have never been committed.
DIFF=$(git diff HEAD -- "$FILE_PATH" 2>/dev/null)
[[ -z "$DIFF" ]] && DIFF=$(git diff --cached -- "$FILE_PATH" 2>/dev/null)
# git diff --no-index exits 1 when differences exist (always true for a new file)
[[ -z "$DIFF" ]] && DIFF=$(git diff --no-index /dev/null "$FILE_PATH" 2>/dev/null || true)

[[ -z "$DIFF" ]] && exit 0

# Guard: skip trivially small diffs (< 3 changed lines) — not worth reviewing
CHANGED_LINES=$(echo "$DIFF" | grep -c '^[+-]' 2>/dev/null || echo 0)
[[ "$CHANGED_LINES" -lt 3 ]] && exit 0

# ── 4. Load agent definition from .claude/agents/code-reviewer.md ────────────
AGENT_FILE=".claude/agents/code-reviewer.md"

if [[ ! -f "$AGENT_FILE" ]]; then
  echo "[file-review hook] Agent file not found: $AGENT_FILE — skipping review." >&2
  exit 0
fi

# Extract: model from frontmatter, system prompt from body (after second ---)
MODEL=$(awk '/^model:/{print $2; exit}' "$AGENT_FILE")
SYSTEM_PROMPT=$(awk 'BEGIN{c=0} /^---$/{c++; if(c==2){found=1; next}} found{print}' "$AGENT_FILE")
[[ -z "$MODEL" ]] && MODEL="claude-haiku-4-5-20251001"

# ── 5. Build the user-facing prompt with the diff ───────────────────────────
PROMPT="Review the following diff. File: ${FILE_PATH}

\`\`\`diff
${DIFF}
\`\`\`"

# ── 6. Invoke sub-agent ──────────────────────────────────────────────────────
# --print           : non-interactive, output to stdout
# --model           : read from agent frontmatter
# --allowedTools    : restrict to Read only — sub-agent cannot Edit/Write,
#                     so this hook can never fire recursively
# Input via stdin so the diff never appears as a shell argument
REVIEW=$(echo "$PROMPT" \
  | claude \
      --print \
      --model "$MODEL" \
      --system-prompt "$SYSTEM_PROMPT" \
      --allowedTools "Read" \
  2>/dev/null) || true

# ── 7. Print — only if there is actual output ────────────────────────────────
if [[ -n "$REVIEW" ]]; then
  BASENAME=$(basename "$FILE_PATH")
  echo ""
  echo "┌── code-reviewer: ${BASENAME} $(printf '─%.0s' {1..50} | head -c $((55 - ${#BASENAME})))"
  echo "$REVIEW" | sed 's/^/│ /'
  echo "└$(printf '─%.0s' {1..60})"
fi

exit 0
