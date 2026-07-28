#!/usr/bin/env bash
# PreToolUse guard: generated Codex harness files are never hand-edited.
# Edit CLAUDE.md, .claude/**, or .mcp.json, then regenerate with `bun run sync-codex`.
#
# Harness-agnostic (D-10): Claude write tools expose file_path/path/changes; Codex apply_patch
# embeds targets in the patch body. Shell execution is intentionally not matched, so the generator
# can write the mirror through Bun.

set -u
input=$(cat)

extract_files() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r '
      [ .tool_input.file_path?, .tool_input.path?, .tool_input.filePath?,
        (.tool_input.changes? // {} | keys[]?) ]
      | .[] | select(. != null and . != "")' 2>/dev/null
  else
    printf '%s' "$input" | python3 -c '
import json, sys
try:
    ti = json.load(sys.stdin).get("tool_input", {}) or {}
except Exception:
    sys.exit(0)
for key in ("file_path", "path", "filePath"):
    if ti.get(key):
        print(ti[key])
if isinstance(ti.get("changes"), dict):
    for key in ti["changes"]:
        print(key)
' 2>/dev/null
  fi

  printf '%s' "$input" |
    grep -oE '\*\*\* (Add|Update|Delete) File: [^"\\]+' |
    sed 's/^\*\*\* [A-Za-z]* File: //'
  printf '%s' "$input" |
    grep -oE '\*\*\* Move to: [^"\\]+' |
    sed 's/^\*\*\* Move to: //'
}

files=$(extract_files | sed 's#^\./##' | sed 's/[[:space:]]*$//' | sort -u)
[ -z "$files" ] && exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

while IFS= read -r file; do
  case "$file" in
    "$root"/*) file=${file#"$root"/} ;;
  esac
  case "$file" in
    AGENTS.md|.codex/*|.agents/*)
      printf '%s\n' \
        "BLOCKED by protect-generated hook: $file is generated." \
        "Edit CLAUDE.md, .claude/**, or .mcp.json, then run \`bun run sync-codex\`." >&2
      exit 2
      ;;
  esac
done <<EOF
$files
EOF

exit 0
