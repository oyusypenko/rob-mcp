#!/usr/bin/env bash
# rob-mcp hard-rule enforcement (CLAUDE.md / .claude/rules/**).
# PostToolUse hook for file writes: greps the just-written file(s) for rule violations. Exit 2
# blocks the result and feeds the message back to the agent; exit 0 passes. High-precision rules
# only — anything fuzzy belongs in review (rob-security), not here.
#
# Harness-agnostic (D-9): shared VERBATIM by Claude Code (.claude/settings.json) and Codex
# (.codex/hooks.json) — same stdin JSON contract, same exit-2-blocks semantics. The harnesses
# differ only in tool shape: Claude's Write|Edit|MultiEdit carry tool_input.file_path, while
# Codex's apply_patch carries a patch blob whose "*** Add/Update File:" lines name the targets.

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
for k in ("file_path", "path", "filePath"):
    if ti.get(k):
        print(ti[k])
if isinstance(ti.get("changes"), dict):
    for k in ti["changes"]:
        print(k)
' 2>/dev/null
  fi
  # Codex apply_patch: targets live inside the patch body (JSON-escaped — stop at the backslash).
  printf '%s' "$input" | grep -oE '\*\*\* (Add|Update) File: [^"\\]+' | sed 's/^\*\*\* [A-Za-z]* File: //'
}

files=$(extract_files | sed 's/[[:space:]]*$//' | sort -u)
[ -z "$files" ] && exit 0

fail=0
err() { echo "RULE VIOLATION: $1" >&2; fail=1; }

while IFS= read -r file; do
[ -z "$file" ] && continue
[ -f "$file" ] || continue

# Docs and harness assets discuss the rules — never enforce on them.
case "$file" in
  *.md|*/docs/*|docs/*|*/.claude/*|.claude/*|*/.codex/*|.codex/*|*/.agents/*|.agents/*|*README*|*.lock) continue ;;
esac

case "$file" in
  *.ts)
    # versions-pinned rule: only the scoped @x402/* line — unscoped legacy packages are banned.
    if grep -qE '(from|import|require\()\s*["'"'"']x402-(hono|fetch|express|next|axios)' "$file"; then
      err "unscoped x402 package import in $file — only the scoped @x402/* line is allowed (.claude/rules/versions-pinned.md)"
    fi
    # no-custody rule: the server signs nothing. Signing/key primitives are banned in src/;
    # scripts/ is the one tolerated home (throwaway smoke-test wallet only).
    case "$file" in
      */src/*|src/*)
        if grep -qE '\b(privateKeyToAccount|mnemonicToAccount|createWalletClient|hdKeyToAccount)\b' "$file"; then
          err "signing/key primitive in $file — src/ never signs; smoke-test wallets live in scripts/ only (.claude/rules/no-custody.md)"
        fi
        if grep -qiE '(PRIVATE_KEY|MNEMONIC|SEED_PHRASE)' "$file"; then
          err "key-material env reference in $file — no key handling in src/ (.claude/rules/no-custody.md)"
        fi
        ;;
    esac
    # no-custody rule: the hosted surfaces must not reach the local-only trading wrapper.
    case "$file" in
      */src/http/*|*/src/mcp/*|src/http/*|src/mcp/*)
        if grep -qE 'from\s+["'"'"'][^"'"'"']*trading/' "$file"; then
          err "hosted surface imports from src/trading/ in $file — the trading wrapper is local-only, never hosted (.claude/rules/no-custody.md)"
        fi
        ;;
    esac
    ;;
esac
done <<EOF
$files
EOF

[ "$fail" -ne 0 ] && exit 2
exit 0
