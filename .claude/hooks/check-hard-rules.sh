#!/usr/bin/env bash
# rob-mcp hard-rule enforcement (CLAUDE.md / .claude/rules/**).
# PostToolUse hook for Write|Edit|MultiEdit: greps the just-written file for
# rule violations. Exit 2 blocks the result and feeds the message back to the
# agent; exit 0 passes. High-precision rules only — anything fuzzy belongs in
# review (rob-security), not here.

set -u
input=$(cat)

if command -v jq >/dev/null 2>&1; then
  file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
else
  file=$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)
fi
[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

# Docs and .claude assets discuss the rules — never enforce on them.
case "$file" in
  *.md|*/docs/*|*/.claude/*|*README*|*.lock) exit 0 ;;
esac

fail=0
err() { echo "RULE VIOLATION: $1" >&2; fail=1; }

case "$file" in
  *.ts)
    # versions-pinned rule: only the scoped @x402/* line — unscoped legacy packages are banned.
    if grep -qE '(from|import|require\()\s*["'"'"']x402-(hono|fetch|express|next|axios)' "$file"; then
      err "unscoped x402 package import in $file — only the scoped @x402/* line is allowed (.claude/rules/versions-pinned.md)"
    fi
    # no-custody rule: the server signs nothing. Signing/key primitives are banned in src/;
    # scripts/ is the one tolerated home (throwaway smoke-test wallet only).
    case "$file" in
      */src/*)
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
      */src/http/*|*/src/mcp/*)
        if grep -qE 'from\s+["'"'"'][^"'"'"']*trading/' "$file"; then
          err "hosted surface imports from src/trading/ in $file — the trading wrapper is local-only, never hosted (.claude/rules/no-custody.md)"
        fi
        ;;
    esac
    ;;
esac

[ "$fail" -ne 0 ] && exit 2
exit 0
