#!/bin/bash
input=$(cat)

# Extract fields
DATE=$(date "+%a %b %d")
MODEL=$(echo "$input" | jq -r '.model.display_name')
CTX_SIZE=$(echo "$input" | jq -r '.context_window.context_window_size // 200000')
USED_PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
INPUT_TOK=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
OUTPUT_TOK=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')
TOTAL_TOK=$((INPUT_TOK + OUTPUT_TOK))

# Convert context size to readable (e.g. 1000000 -> 1M)
CTX_LABEL=$(( CTX_SIZE / 1000000 ))M

# Build a 20-char progress bar
BAR_WIDTH=20
FILLED=$(( USED_PCT * BAR_WIDTH / 100 ))
EMPTY=$(( BAR_WIDTH - FILLED ))
BAR=$(printf '█%.0s' $(seq 1 $FILLED))$(printf '░%.0s' $(seq 1 $EMPTY))

echo "${DATE} | ${MODEL} (${CTX_LABEL} context) | Context: [${BAR}] ${USED_PCT}% | Tokens: ${TOTAL_TOK}"
