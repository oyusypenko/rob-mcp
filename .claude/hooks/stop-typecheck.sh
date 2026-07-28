#!/usr/bin/env bash
# Stop hook: typecheck before the agent finishes its turn when any TypeScript
# changed — the cheap layer only (tsc --noEmit); tests stay in validate.sh + CI.
# Exit 2 feeds failures back so type errors get fixed before stopping;
# stop_hook_active guards against loops. Skips silently when tools are missing
# or no source exists yet — CI still enforces everything.

set -u
input=$(cat)

if command -v jq >/dev/null 2>&1; then
  active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false')
else
  active=$(printf '%s' "$input" | python3 -c 'import json,sys; print(str(json.load(sys.stdin).get("stop_hook_active", False)).lower())' 2>/dev/null)
fi
[ "$active" = "true" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" 2>/dev/null || exit 0
command -v bun >/dev/null 2>&1 || exit 0

changed=$( { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } | sort -u )
printf '%s\n' "$changed" | grep -qE '^(src|scripts|test)/.*\.ts$|^tsconfig\.json$' || exit 0

# Nothing to typecheck until source exists (Phase A ships governance only).
ls src/*.ts src/**/*.ts scripts/*.ts test/*.ts >/dev/null 2>&1 || exit 0

if ! out=$(bun run typecheck 2>&1); then
  printf '%s\n' "[rob-mcp] typecheck failed:" "$out" >&2
  exit 2
fi
exit 0
