#!/usr/bin/env bash
# PreToolUse guard for shell tools: blocks reads of secret material and destructive
# commands that the permission globs can't see inside a shell string. Exit 2
# blocks the call and feeds the message back to the agent; exit 0 passes.
# High-precision rules only — the committed .env.example stays fully accessible.
#
# Harness-agnostic (D-9): shared VERBATIM by Claude Code (.claude/settings.json) and Codex
# (.codex/hooks.json). Claude's Bash tool passes tool_input.command as a STRING; Codex's shell
# tools pass an argv ARRAY (e.g. ["bash","-lc","cat .env"]) — both are flattened to one line here.

set -u
input=$(cat)

if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '
    [ .tool_input.command?, .tool_input.cmd?, .tool_input.script? ]
    | map(select(. != null))
    | map(if type == "array" then join(" ") else tostring end)
    | join(" ")' 2>/dev/null)
else
  cmd=$(printf '%s' "$input" | python3 -c '
import json, sys
try:
    ti = json.load(sys.stdin).get("tool_input", {}) or {}
except Exception:
    sys.exit(0)
parts = []
for k in ("command", "cmd", "script"):
    v = ti.get(k)
    if isinstance(v, list):
        parts.append(" ".join(str(x) for x in v))
    elif v:
        parts.append(str(v))
print(" ".join(parts))
' 2>/dev/null)
fi
[ -z "$cmd" ] && exit 0

deny() { echo "BLOCKED by protect-secrets hook: $1" >&2; exit 2; }

# 1. Secret material — raw .env / .env.local (CDP keys, smoke-test wallet key live there).
#    Only block when a read-capable command appears; writing/copying INTO .env
#    (cp .env.example .env) stays allowed.
secret_re='(^|[ /"'"'"'=])\.env(\.local)?($|[ "'"'"';)])|keystore/|[^ "'"'"']*\.pem\b|(^|[ /])id_(rsa|ed25519)\b'
reader_re='\b(cat|less|more|head|tail|bat|strings|base64|xxd|od|grep|rg|awk|sed|cut|sort|source|scp|curl|python3?|node|bun)\b'
if printf '%s' "$cmd" | grep -qE "$secret_re" && printf '%s' "$cmd" | grep -qE "$reader_re"; then
  deny "reading secret material (.env/.env.local, keystore/, key files). Use .env.example for shape — never read or print real env files."
fi

# 2. Recursive force-delete aimed at root/home/repo-wide targets. Scoped
#    cleanups (rm -rf node_modules, rm -rf dist) stay allowed.
if printf '%s' "$cmd" | grep -qE '\brm\s+(-[a-zA-Z]+\s+)*-[a-zA-Z]*([rR][a-zA-Z]*f|f[a-zA-Z]*[rR])'; then
  if printf '%s' "$cmd" | grep -qE '\brm\s[^|;&]*( /($|[ "'"'"'])|~/?($|[ "'"'"'])|\$HOME|\.\.(/|$| )|(^|\s)\*($|\s)|\.git($|[ "'"'"']))'; then
    deny "recursive force-delete aimed at a root/home/parent/repo-wide path."
  fi
fi

# 3. The whale index is rebuildable but slow — no ad-hoc deletion of the SQLite
#    file; use the scanner's own reset path.
if printf '%s' "$cmd" | grep -qE '\brm\s[^|;&]*\.(db|sqlite3?)\b'; then
  deny "deleting a SQLite database file — use the scanner's reset path so the cursor stays consistent."
fi

exit 0
