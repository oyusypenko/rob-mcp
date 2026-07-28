#!/usr/bin/env bash
# rob-mcp local CI mirror — also the pre-commit hook (.githooks/pre-commit).
# Stages: format check → hard-rules scan → typecheck → tests.
# Every stage skips gracefully but LOUDLY when its tool or inputs are missing;
# CI runs the same script and enforces everything.

set -u
cd "$(dirname "$0")/.." || exit 1

fail=0
stage() { printf '\n== %s ==\n' "$1"; }
skip() { printf 'SKIP: %s\n' "$1"; }

stage "prettier (format:check)"
if command -v bun >/dev/null 2>&1; then
  bun run --silent format:check || fail=1
else
  skip "bun not installed"
fi

stage "hard rules (grep over tracked files)"
# Mirror of .claude/hooks/check-hard-rules.sh, repo-wide. High-precision only.
files=$(git ls-files '*.ts' 2>/dev/null | grep -vE '^docs/|^\.claude/' || true)
if [ -n "$files" ]; then
  if printf '%s\n' "$files" | xargs grep -lE '(from|import|require\()\s*["'"'"']x402-(hono|fetch|express|next|axios)' 2>/dev/null; then
    echo "RULE VIOLATION: unscoped x402 package import (versions-pinned rule)"; fail=1
  fi
  src_files=$(printf '%s\n' "$files" | grep '^src/' || true)
  if [ -n "$src_files" ]; then
    if printf '%s\n' "$src_files" | xargs grep -lE '\b(privateKeyToAccount|mnemonicToAccount|createWalletClient|hdKeyToAccount)\b' 2>/dev/null; then
      echo "RULE VIOLATION: signing/key primitive in src/ (no-custody rule)"; fail=1
    fi
  fi
  hosted=$(printf '%s\n' "$files" | grep -E '^src/(http|mcp)/' || true)
  if [ -n "$hosted" ]; then
    if printf '%s\n' "$hosted" | xargs grep -lE 'from\s+["'"'"'][^"'"'"']*trading/' 2>/dev/null; then
      echo "RULE VIOLATION: hosted surface imports src/trading/ (no-custody rule)"; fail=1
    fi
  fi
else
  skip "no tracked TypeScript yet"
fi

stage "typecheck (tsc --noEmit)"
if ! command -v bun >/dev/null 2>&1; then
  skip "bun not installed"
elif ! ls src/*.ts src/**/*.ts scripts/*.ts test/*.ts >/dev/null 2>&1; then
  skip "no TypeScript source yet (pre-Phase-B scaffold)"
else
  bun run --silent typecheck || fail=1
fi

stage "tests (bun test)"
if ! command -v bun >/dev/null 2>&1; then
  skip "bun not installed"
elif ! ls test/*.test.ts src/**/*.test.ts >/dev/null 2>&1; then
  skip "no tests yet (pre-Phase-B scaffold)"
else
  bun test || fail=1
fi

printf '\n'
if [ "$fail" -ne 0 ]; then
  echo "validate: FAIL"
  exit 1
fi
echo "validate: OK"
