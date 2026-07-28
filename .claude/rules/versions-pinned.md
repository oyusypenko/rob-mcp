# Pinned protocol-SDK versions (always loaded)

- `@modelcontextprotocol/sdk` stays on the **v1.30.x** line and the x402 packages stay on the
  scoped **`@x402/*` 2.20.x** line (`@coinbase/x402` 2.1.x) until `@x402/mcp` declares support for
  MCP SDK v2. Rationale: `@x402/mcp@2.20.0` hard-depends on SDK v1 (`^1.12.1`); SDK v2
  (`@modelcontextprotocol/server`) shipped 2026-07-27 and is too fresh to bet the paywall on.
  Migration is tracked as an open item in `docs/developers/design-decisions.md`.
- The legacy unscoped x402 packages (`x402-hono`, `x402-fetch`, `x402-express`, `x402-next`) are
  BANNED — imports are blocked by `check-hard-rules.sh`. Only `@x402/*` scoped packages.
- Dependency versions in `package.json` are exact (bunfig `exact = true`). Upgrading any pinned
  protocol SDK is a recorded decision (`D-N` in the decisions log with the compat evidence), never a
  drive-by bump. Routine dev-dependency bumps don't need a decision entry.
- Before implementing against either SDK, re-verify current API shapes via context7 — both lines
  ship breaking changes fast, and the design docs record API assumptions with their as-of date.
