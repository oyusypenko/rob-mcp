# Design decisions log

Append-only ADR log (robbed-repo house style). Each entry: `- **D-N — MARKER: title.**
*(date; owner; scope)* ruling, rationale, explicit "unchanged" list.` Markers: `USER-DIRECTED`
(the user decided), `USER-RATIFIED` (proposed, user approved), `ARCHITECT-DESIGNED` (rob-architect
within delegated authority). Superseded entries are annotated in place, never deleted. Open items
are `O-N` with owners.

### Repo & scope

- **D-1 — USER-DIRECTED: Standalone public repo `rob-mcp`, single package, all four v1 tool
  groups.** _(2026-07-28; owner rob-architect; repo-shape + scope.)_ Built outside the robbed
  monorepo as its own repo/folder (portfolio piece for grants/hackathons/Upwork per the research
  memo in the robbed repo, `docs/developers/ai-research.md`); patterns are copied from robbed
  (keeper service structure, api middleware), never imported. Single package with internal
  layering (`core`/`adapters`/`tools`/`mcp`/`http`), one `bin`. Name changed from the working name
  `hood-mcp` to `rob-mcp` by user direction. Scope: premium/discount, DEX liquidity/spreads,
  whale/mint-redeem, trading wrapper (Phase F, gated). Unchanged: the robbed launchpad repo.

- **D-2 — ARCHITECT-DESIGNED: MCP SDK pinned to v1.30.x; x402 on the scoped `@x402/*` 2.20.x
  line.** _(2026-07-28; owner rob-surface; dependency policy.)_ `@x402/mcp@2.20.0` hard-depends on
  `@modelcontextprotocol/sdk@^1.12.1`; SDK v2 shipped 2026-07-27 and is too fresh to bet the
  paywall on. Unscoped legacy `x402-*` packages banned (hook-enforced). Codified in
  `.claude/rules/versions-pinned.md`. Migration tracked as O-3.

### Data & oracle

- **D-3 — USER-DIRECTED: Chainlink-first oracle; off-chain quote API only as fallback.**
  _(2026-07-28; owner rob-core; premium-signal source.)_ The official Chainlink tokenized-equity
  feeds on 4663 are the primary real-quote leg (free, keyless, the chain's own oracle; feed value
  already includes `uiMultiplier`). Tickers without a feed use an off-chain quote port
  (provider open: O-6). Every read gates on staleness + the sequencer-uptime feed; outputs carry
  provenance.

- **D-4 — ARCHITECT-DESIGNED: SQLite (`bun:sqlite`) behind a `WhaleStore` port.** _(2026-07-28;
  owner rob-core; storage.)_ One-file DB on a Fly volume fits a solo-run service; the port keeps
  Postgres a swap, not a rewrite. WAL mode, scanner is the single writer. `bun:sqlite` import
  guarded so stdio mode runs on plain Node.

### Surfaces & money

- **D-5 — ARCHITECT-DESIGNED: Deploy target Fly.io.** _(2026-07-28; owner rob-surface; ops.)_
  Shared-cpu machine + 1GB volume; cheap, volume-backed SQLite, trivial Bun image. Revisit only if
  volume or egress economics change.

- **D-6 — USER-RATIFIED: Trading wrapper is local-only, forever.** _(2026-07-28; owner
  rob-surface, sign-off rob-security; custody boundary.)_ The wrapper composes the USER's own
  Robinhood Trading MCP connection as a local stdio process; it is never hosted, never proxied
  through the paid server, and hosted code may not import `src/trading/` (hook-enforced). Codified
  in `.claude/rules/no-custody.md`. Rationale: custody/credential handling is the regulatory and
  security death line for a solo dev.

- **D-7 — ARCHITECT-DESIGNED: Free tier = `/healthz` + `list_stock_tokens` +
  `FREE_CALLS_PER_DAY`/IP on paid routes; one PRICING map for both surfaces.** _(2026-07-28; owner
  rob-surface; monetization shape.)_ Rate limiter runs before payment middleware; per-tool prices
  live in `src/pricing.ts` and `docs/developers/tools.md` only. Price changes append a `D-N`.

## Open items

- **O-1** _(rob-core)_ — Verify DEX venues beyond Uniswap on-chain: Robinhood docs name
  Uniswap/Lighter/Rialto; the research memo named Arcus/Pleiades. Check factories/routers on
  robinhoodchain.blockscout.com before writing any adapter. Until then: Uniswap v2/v3 only.
- **O-2** _(rob-core)_ — Hunt for an on-chain Stock Token issuer registry/factory (ERC-8056 may
  imply one). Until found, the curated `data/tokens.json` + verify script is canonical.
- **O-3** _(rob-surface)_ — MCP SDK v2 migration (`@modelcontextprotocol/server` + Hono adapter)
  once `@x402/mcp` supports it. Blocked by upstream.
- **O-4** _(rob-surface)_ — Verify the Streamable-HTTP-into-Hono bridge (`fetch-to-node`) under
  Bun at the START of Phase E; fallback (sibling Node-http listener) is pre-approved by D-5's
  owner if it fails. `fetch-to-node` is deliberately NOT in package.json until this check.
- **O-5** _(rob-architect → user decision)_ — Chainlink tokenized-equity feed terms of service:
  confirm redistribution of feed values in a paid API is permitted BEFORE mainnet pricing goes
  live. Compliance-blocking for Phase E mainnet.
- **O-6** _(rob-core)_ — Choose the fallback equity-quote provider (Finnhub vs Twelve Data vs
  Alpaca) by free-tier limits during Phase C. Behind a port either way.
- **O-7** _(rob-core)_ — Zod is pinned at 4.4.3; verify MCP SDK 1.30's `registerTool` accepts
  zod-v4 schemas at the start of Phase B (SDK v1 historically assumed zod v3). If not: pin zod 3.x
  and record the amendment here.
