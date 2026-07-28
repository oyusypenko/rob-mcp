# Authority chain & docs-first (always loaded)

- Source of truth: `README.md` + the developer docs under `docs/developers/**`. When code and docs
  disagree, the docs win. When the docs are silent or self-contradictory, never self-resolve: ask,
  or record the decision (numbered `D-N`, dated, with an owner for anything left open) in
  `docs/developers/design-decisions.md`.
- Docs precede code: every change traces to a design section under `docs/developers/**`. New
  behavior → update the design doc first (same commit is fine; the doc diff must stand on its own).
- Docs-first for libraries: consult current official docs via the context7 MCP
  (`resolve-library-id` → `query-docs`) before touching any library/tool — never code from memory.
  This matters doubly here: `@modelcontextprotocol/sdk` and the `@x402/*` line both ship breaking
  releases fast (both released majors/minors the day before this repo was scaffolded). WebFetch of
  canonical docs is the fallback. External docs beat assumptions; this repo's design docs beat
  external library docs (flag the conflict).
- Never create plans/trackers/status/progress md files anywhere. Phase state lives in git history
  and the decisions log; docs are design + runbooks only.
- Harness changes are source-first: when creating or editing an agent, skill, rule, hook, MCP
  config, or other harness-related Markdown/config asset, edit only `CLAUDE.md`, `.claude/**`, or
  `.mcp.json`, then run `bun run sync-codex`. Never directly create or edit generated `AGENTS.md`,
  `.codex/**`, or `.agents/**`; `bun run validate` must prove the regenerated mirror is current.
