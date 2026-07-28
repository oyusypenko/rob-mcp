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

- **D-8 — USER-DIRECTED: The core is chain-agnostic; Robinhood Chain (4663) is the first and
  default chain.** _(2026-07-28; owner rob-core; core/config shape — amends the 4663-specific
  wording of the Phase-A docs.)_ No chain id, venue address, or issuer semantics may be assumed in
  `src/core/` or `src/tools/`: chains are entries in `data/chains.json` (venues, oracle config,
  issuer profile), token registries are per-chain (`data/tokens/<chainId>.json`), issuer
  differences (ERC-8056 `uiMultiplier` vs other tokenized-equity issuers) live in issuer profiles
  (`src/registry/issuer-profiles.ts`), the whale store is chain-keyed, and every tool takes an
  optional `chain` input (default: first enabled chain) with `chainId` in every output's
  provenance. Runtime chains come from `ENABLED_CHAINS` + `RPC_URL_<chainId>`; v1 enables 4663
  only. Scope bound: EVM chains only (the stack is viem) — non-EVM (Solana xStocks) excluded.
  Unchanged: x402 settlement stays on Base regardless of data chains; the trading wrapper stays
  Robinhood-specific and local-only (D-6); pricing (D-7).

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

### Tooling & harness

- **D-9 — USER-DIRECTED: The repo is harness-portable; `.claude/**` is the single source and the
  OpenAI Codex mirror is generated.** _(2026-07-28; owner rob-architect; repo tooling.)_ The repo
  must be usable from Codex CLI as well as Claude Code, with **no duplicated content** (user
  direction). Ruling: `.claude/**` + `.mcp.json` stay the only hand-edited harness files;
  `scripts/sync-codex.ts` projects them onto `AGENTS.md`, `.codex/agents/*.toml`,
  `.codex/hooks.json`, `.codex/config.toml`, and `.agents/skills/*`. Duplication is avoided
  per asset class: skills are **symlinked** (one `SKILL.md` on disk), hook **scripts are shared
  verbatim** (both harnesses feed the same stdin JSON and honour exit 2 as "block"; the scripts now
  accept Claude's `Bash`/`file_path` shape and Codex's argv-array/`apply_patch`-patch-body shape),
  and the only genuine copy is `AGENTS.md` — unavoidable because **Codex supports no `@`-imports**,
  so the four always-on rules must be inlined. That copy is generated, banner-marked, and
  drift-checked: `bun run sync-codex --check` is a `validate.sh` stage, so a stale mirror cannot be
  committed. The generator asserts Codex's 32 KiB `project_doc_max_bytes` budget (currently ~14 KiB)
  because Codex truncates the instruction chain **silently**. Claude's per-agent tool allowlists have
  no Codex equivalent and are restated as prose in `developer_instructions` — a soft guarantee;
  hard enforcement stays in the hooks, which fire in both harnesses. Verified empirically against
  codex-cli 0.144.6 via `codex debug prompt-input`. Rationale: portability is a portfolio and
  contributor concern (D-1), and a second hand-maintained rule set would drift out of sync —
  which for `no-custody` is a safety regression, not an inconvenience. Runbook + portable recipe:
  `docs/developers/runbooks/codex-parity.md`. Unchanged: Claude Code remains the primary harness
  and the richer source; no rule text, agent remit, or skill content was altered by this change.

- **D-10 — USER-DIRECTED: Codex parity is compiled, enforced, and continuously verified.**
  _(2026-07-28; owner rob-architect; repo tooling — supersedes D-9's operational claims where
  Codex 0.144.6 documentation now provides stronger controls.)_ “Parity” means equivalent behavior
  for every harness asset this repo actually declares; it does not claim that Codex implements
  every Claude Code product feature. `.claude/**` + `.mcp.json` remain the only hand-edited harness
  sources. `scripts/sync-codex.ts` additionally translates `.claude/settings.json` into a Codex
  permission profile (workspace writes with the same secret-path deny rules) and
  `.codex/rules/rob-mcp.rules` (Claude `Bash(...)` allow/ask entries become Codex exec-policy
  prefixes). A Claude agent without write tools gets `default_permissions = ":read-only"` in its
  generated Codex agent file, so `rob-security` is sandbox-enforced rather than prose-only; the
  prose remains defense in depth because a parent session's explicit live permission override can
  take precedence. The generator continues to inline always-on rules because Codex has no
  instruction-assembly equivalent to Claude's `@` imports, though ordinary file references remain
  valid routing guidance. Context7 authentication is optional and secret-free in git: Codex reads
  `CONTEXT7_API_KEY` through `env_http_headers` when present; anonymous use remains possible but
  may hit the provider quota. `scripts/verify-codex-parity.ts` proves generated content, strict
  config parsing, prompt injection, exec-policy decisions, hook behavior, read-only agent config,
  and MCP header mapping; `scripts/setup-codex.ts` performs the one-time per-clone bootstrap.
  Pre-commit regenerates then rejects unstaged mirror changes, CI runs drift + parity checks, and a
  pinned supported Codex CLI version prevents an unreviewed upstream release from silently
  changing semantics. Upstream-only gaps (general per-agent tool allowlists, native `@` includes,
  non-command hook handlers, and named-agent selection on every Codex surface) are documented
  limitations with local shims where this repo needs them, not falsely reported as native parity.
  Unchanged: Claude remains the hand-edited source; generated files are committed and reviewed;
  hook trust and project trust remain explicit user actions; no secret is committed.

- **D-11 — ARCHITECT-DESIGNED: Robinhood's official asset sources seed a verified local
  snapshot.** _(2026-07-29; owner rob-core; token discovery + registry lifecycle.)_ Robinhood now
  publishes a live on-chain asset registry, exposes its contents on the Token Contracts page, and
  serves deployment metadata from `GET https://api.robinhood.com/rhj/assets`. For chain 4663,
  `scripts/seed-tokens.ts` consumes those official sources, enriches the draft with Chainlink feed
  and verified venue metadata, and materializes `data/tokens/4663.json`; every entry still passes
  `scripts/verify-tokens.ts` against live contracts before commit. The checked-in per-chain file is
  the deterministic runtime contract, not a live dependency on Robinhood's REST service. Rationale:
  official discovery eliminates hand-maintained address drift while a verified snapshot preserves
  reproducibility and the heterogeneous per-chain source model required by D-8. Unchanged:
  per-chain registries, issuer profiles, chain-agnostic core boundaries, feed/pool verification,
  and the rule that no unverified entry enters a registry.

- **D-12 — ARCHITECT-DESIGNED: Robinhood's read-only price API is the feedless fallback.**
  _(2026-07-29; owner rob-core; fallback oracle port + compliance gate.)_ D-3 remains
  Chainlink-first. When a registered Robinhood asset has no Chainlink
  `primaryTokenizedPrice` feed, the fallback port reads
  `GET https://api.robinhood.com/rhj/prices/{symbol}`, computes the midpoint of the returned raw
  underlying bid/ask using decimal arithmetic, and multiplies it by `currentMultiplier` from
  `/rhj/assets` to obtain the token-equivalent USD reference. It fails closed on a missing side,
  invalid multiplier, stale/missing `generatedAt`, or unavailable endpoint, and returns provider,
  source timestamp, and multiplier provenance. This replaces the speculative
  Finnhub/Twelve Data/Alpaca shortlist in O-6. Paid mainnet redistribution remains blocked by O-5
  until the user confirms terms for both Chainlink values and Robinhood REST values. Rationale:
  the issuer's documented endpoint has the exact multiplier semantics the fallback needs and avoids
  an unrelated third-party mapping. Unchanged: Chainlink is primary, D-13's L2-liveness gate also
  applies to fallback comparisons, no market value is hardcoded, and x402 pricing is unchanged.

- **D-13 — ARCHITECT-DESIGNED: Robinhood live pricing fails closed without an official sequencer
  uptime feed.** _(2026-07-29; owner rob-core; oracle safety + Phase-C availability.)_ As of
  2026-07-29, Chainlink publishes Robinhood price feeds but lists no sequencer-uptime feed for
  chain 4663 at `https://docs.chain.link/data-feeds/l2-sequencer-feeds`. The chain registry
  therefore represents the uptime-feed address as absent rather than inventing one. Registry
  discovery and `list_stock_tokens` may still operate, and the pricing code may be implemented and
  fake-tested, but every operation that combines live Robinhood L2 state with price data fails
  closed with a typed `SEQUENCER_STATUS_UNAVAILABLE` error until an official feed is published and
  verified. An alternative liveness mechanism requires an explicit user-directed amendment to
  D-3; an RPC responding is not evidence that its sequencer is healthy.
  Rationale: preserving the user-directed safety gate is more important than returning a plausible
  paid signal during an unverifiable outage. Unchanged: feed staleness checks, fallback selection,
  the chain-agnostic nullable L2-feed field, and all non-price registry reads.

- **D-14 — ARCHITECT-DESIGNED: The local trading surface has three canonical tools.**
  _(2026-07-29; owner rob-surface, sign-off rob-security; Phase-F tool contract.)_ The external
  local-only names are `position_check` (read-through), `trade_prepare` (all policy checks and a
  mandatory dry run), and `trade_execute` (previously prepared ids only). This resolves the stale
  `order_prepare` spelling in `architecture.md` and the omission of `position_check` from
  `tools.md`. The adapter may not ship until O-9 verifies the official Robinhood Trading MCP's
  upstream names, schemas, connector configuration, and prepared-order mapping against a funded
  Agentic Account. Rationale: one stable wrapper vocabulary keeps policy semantics independent of
  upstream naming while retaining an explicit integration gate. Unchanged: D-6's local-only
  custody boundary, no hosted imports, caps/allowlist/market-hours/premium guards, local audit
  logging, and mandatory rob-security review.

- **D-15 — ARCHITECT-DESIGNED: JSON tool routes use one versioned POST convention.**
  _(2026-07-29; owner rob-surface; Hono HTTP contract.)_ Every tool in
  `src/tools/definitions.ts` is exposed as `POST /api/v1/tools/<tool-name>` with a JSON body
  validated by that tool's canonical Zod input schema; no GET or unversioned aliases are generated.
  `GET /healthz` remains the non-tool health endpoint, and `POST /mcp` remains the hosted
  Streamable HTTP MCP endpoint. The free route is therefore
  `POST /api/v1/tools/list_stock_tokens`; paid routes at the same prefix use the one `PRICING` map
  and the free-tier middleware before x402. Rationale: a uniform JSON body preserves bounded typed
  inputs and an unambiguous payment-retry target across both surfaces. Unchanged: tool names,
  schemas, handlers, tiers, pricing, `/mcp`, and `/healthz`.

- **D-16 — ARCHITECT-DESIGNED: Hosted MCP uses the SDK's Web-Standard transport directly.**
  _(2026-07-29; owner rob-surface; MCP/Hono/Bun bridge — API evidence as of 2026-07-29.)_ Pinned
  `@modelcontextprotocol/sdk@1.30.0` exports
  `WebStandardStreamableHTTPServerTransport` from
  `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js`; its official package
  documentation explicitly supports Bun and shows Hono passing `c.req.raw` to `handleRequest`.
  Hosted `/mcp` creates a fresh stateless transport per request
  (`sessionIdGenerator: undefined`) and returns its Web `Response` directly. No `fetch-to-node`
  dependency or sibling Node listener is needed. Context7 was quota-blocked during verification,
  so the installed pinned package's exported declarations and implementation were used as the
  canonical-doc fallback required by `spec-authority`. Rationale: using the SDK's native
  Fetch-compatible transport removes the bridge risk O-4 tracked. Unchanged: MCP SDK v1.30.x pin,
  stateless hosted semantics, Hono as the hosted app, and the x402 wrapper requirement.

- **D-17 — ARCHITECT-DESIGNED: `list_stock_tokens` returns an object envelope.**
  _(2026-07-29; owner rob-core; shared tool output contract.)_ The canonical output is
  `{ tokens: TokenSummary[] }`, not a top-level array. MCP structured content/output schemas require
  an object, so both MCP and HTTP use the same object schema rather than giving this one tool a
  JSON-text-only exception. Rationale: the project is pre-alpha and preserving the single
  cross-surface contract is cheaper and safer than shipping an inconsistency. Unchanged: token
  fields, search/chain semantics, free tier, and `chainId` provenance.

- **D-18 — ARCHITECT-DESIGNED: Paid fan-out, scanner work, and whale responses are explicitly
  bounded.** _(2026-07-29; owner rob-core; Phase-C/D config + persistence contract.)_ Zod-parsed
  config adds five positive limits: `MAX_QUOTE_USD=100000` caps `stock_quote.amountUsd`;
  `MAX_WHALE_SINCE_HOURS=168` caps each query at the milestone's seven-day sanity window;
  `MAX_WHALE_RESULTS=200` caps returned events; `LIQUIDITY_CLIP_USD=10000` defines the fixed
  buy/sell probe used to compare venue spreads; and `ROBINHOOD_QUOTE_MAX_AGE_SECONDS=30` allows at
  most two documented 15-second REST cache windows before the D-12 fallback fails stale. These are
  operator policy/safety controls, not claims about live market liquidity. Scanner tuning is
  chain data, not global env: each `data/chains.json` entry carries
  `scanner.initialChunkBlocks=5000`, `scanner.reorgTailBlocks=200`, and
  `scanner.headPollIntervalMs=1000` for 4663; adaptive splitting may reduce a chunk but never skip
  a range. The 5,000-block first attempt bounds provider work, the 200-block tail deliberately
  replays recent history before upsert, and a one-second poll coalesces Robinhood's fast blocks
  instead of polling at block cadence. The SQLite event row persists `blockTimestamp` at ingestion
  so time-window queries do not make one RPC call per result. Stored and exposed `kind` is exactly
  `transfer | mint | redeem | ap-flow | whale`, and the input filter accepts all five. Every event
  with `amountUsd` also persists and exposes `chainId`, `oracleSource`, `oracleUpdatedAt`,
  `oracleAddress` when on-chain, and `oracleProvider` when off-chain. Rationale: bounded work and
  self-contained provenance are security/correctness properties for a paid API; the selected
  defaults keep one request finite while remaining operator-adjustable. Unchanged:
  `WHALE_MIN_USD`, adaptive provider-limit handling, reorg-tail replacement semantics, pricing,
  and D-13's fail-closed liveness gate.

- **D-19 — ARCHITECT-DESIGNED: Quote assets and discovered pools are verified chain data.**
  _(2026-07-29; owner rob-core; chain registry + venue discovery.)_ The chain registry has a
  `quoteAssets` list. For 4663 the first canonical quote is USDG at
  `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals, with the official USDG/USD Chainlink
  proxy `0x61B7e5650328764B076A108EFF5fa7282a1B9aD2` (8 decimals) and official
  `heartbeatSeconds: 86400`; token/feed decimals were verified by live `eth_call`, and the
  heartbeat by Robinhood's official RDD feed metadata, on 2026-07-29. USD conversion reads the
  feed, gates its timestamp against that registry heartbeat, and never assumes a stablecoin equals
  one dollar. The adapter neither hardcodes nor skips quote-feed staleness.
  `scripts/seed-tokens.ts` may discover pools only by calling each configured v2 factory for
  token/quote pairs and each configured v3 factory for the registry's allowed fee tiers, then
  verifying nonzero pool bytecode, factory, token ordering, and fee before snapshotting the
  address. A token with no verified pool keeps `venues: []`; `stock_liquidity` returns
  `{ venues: [] }`, while quote/premium requests that require a pool fail with typed
  `NO_VERIFIED_POOL`. Rationale: quote identity, freshness, and venue discovery vary by chain and
  belong in validated data, while empty truth is safer than invented liquidity. Unchanged:
  Uniswap v2/v3 are the only adapters until O-1 resolves, per-chain token snapshots remain
  deterministic, and no market price/pool metric is hardcoded.

- **D-20 — ARCHITECT-DESIGNED: Successful price provenance exposes both safety gates.**
  _(2026-07-29; owner rob-core; oracle output contract.)_ `oraclePaused` is an internal
  fail-closed adapter/core gate, never user input and never a switch that can bypass validation. An
  explicit upstream halt/pause (including Robinhood fallback `isTradingHalt`), invalid/stale price,
  or unavailable required source produces a typed error and no price-bearing result. A successful
  price-bearing output includes `oraclePaused: false` and `sequencerOk: true` alongside the
  existing source/timestamp/address/pool/chain provenance. Rationale: the booleans make the two
  independent health checks explicit to agents without implying that an unsafe price was returned.
  Unchanged: errors remain fail-closed, D-13 blocks 4663 while sequencer status is unavailable,
  and provenance never replaces validation.

- **D-21 — ARCHITECT-DESIGNED: The verified Robinhood mint forwarder is an issuer participant.**
  _(2026-07-29; owner rob-core; 4663 issuer-profile classification data.)_ Add
  `0xcfAEce2151502dA2a21d47234ae1f08618A60A94` to the Robinhood issuer profile's
  `mintRedeem.participantAddresses`. A 2026-07-29 live provenance audit found zero-address
  `Transfer` mints on all 96 official registry token contracts and found every first mint sent to
  this same address; Blockscout verifies it as an EIP-1167 proxy to ForwarderV4. Classification
  precedence remains zero-address first, so `0x0 → forwarder` is `mint`; subsequent nonzero
  transfers to or from the forwarder are `ap-flow`. Rationale: the repeated on-chain role plus
  verified implementation is stronger evidence than an undocumented label and makes the
  profile-driven classifier reflect observed issuance flow. Unchanged: other addresses require
  independent verification, zero-address mint/redeem semantics, `WHALE_MIN_USD`, and no-custody.

- **D-22 — ARCHITECT-DESIGNED: Proxy trust and hosted request size fail closed.**
  _(2026-07-29; owner rob-surface, review rob-security; HTTP abuse boundary.)_ Add
  `TRUST_PROXY=none|fly` with default `none`. `none` ignores all client-supplied forwarding
  headers and uses the runtime's direct peer address; if the runtime cannot expose one, requests
  share a conservative anonymous rate-limit bucket rather than receiving unlimited free calls.
  `fly` is enabled only on the Fly deployment and accepts a syntactically valid
  `Fly-Client-IP`; generic `X-Forwarded-For`, `X-Real-IP`, and arbitrary proxy headers are never
  trusted. Add `MAX_REQUEST_BODY_BYTES=65536`, parsed as a positive integer and configuration-capped
  at 1,048,576 bytes. All hosted POST endpoints reject a declared or streamed body beyond the
  configured limit with HTTP 413 before JSON parsing, tool dispatch, or x402 verification. The
  free-tier store is bounded by `FREE_TIER_MAX_IDENTITIES=10000`: expired 24-hour buckets are
  purged first, and at capacity a new identity receives no free call rather than evicting an active
  bucket. Payment replay defense is bounded by `PAYMENT_REPLAY_MAX_ENTRIES=10000` and
  `PAYMENT_REPLAY_TTL_SECONDS=86400`; expired fingerprints are purged first, a live duplicate is
  rejected, and a full live cache fails payment processing closed before the paid handler rather
  than forgetting replay evidence. Rationale: spoofable IP identity defeats D-7's free-tier
  boundary, while body/store caps bound unauthenticated memory/CPU work without turning eviction
  into a free-tier or payment-replay bypass. Unchanged: `FREE_CALLS_PER_DAY`, route paths, tool
  input schemas, x402 prices/networks, and local stdio behavior.

- **D-23 — USER-DIRECTED: The public marketing/docs site is a derived static presentation
  layer.** _(2026-07-29; owner rob-surface, content stewardship rob-architect; Phase G site.)_
  Add a proper SEO-oriented public site that explains rob-mcp and documents every implemented
  capability with copy-paste local MCP, hosted MCP, and JSON API examples. The site uses statically
  generated Astro under `site/`, deploys through GitHub Pages, and derives tool pages, schemas,
  tiers, exact prices, config facts, verified chain facts, and availability gates from their
  canonical repository sources as specified in `site.md`. A dedicated `/pricing/` page derives
  its per-tool amounts from `src/pricing.ts`, verifies them against `tools.md`, explains the free
  allowance and x402/Base flow, and makes clear that there is no rob-mcp subscription, account, or
  API key. Validation fails on pricing/tool/source drift. Rationale: discoverability and usable
  documentation are product requirements, but a second hand-maintained contract would undermine
  the one-core/two-surfaces architecture. Unchanged: D-1's single root package and lockfile,
  `src/tools/definitions.ts` and `src/pricing.ts` remain runtime authorities, `tools.md` remains
  the documented contract, the site is not a runtime/API surface, Fly.io remains the API host,
  no-custody/no-market-metrics rules, all current tool prices, and O-5/O-8/O-9 gates.

- **D-24 — ARCHITECT-DESIGNED: x402 v2 uses the current x402.org testnet facilitator and
  `PAYMENT-*` headers.** _(2026-07-29; owner rob-surface, docs stewardship rob-architect; x402
  integration contract — official API evidence as of 2026-07-29.)_ For unauthenticated Base
  Sepolia testing, the canonical facilitator base URL is `https://x402.org/facilitator`, as listed
  by Coinbase's official [x402 quickstart](https://docs.cdp.coinbase.com/x402/quickstart-for-buyers)
  and [FAQ](https://docs.cdp.coinbase.com/x402/support/faq);
  `https://facilitator.x402.org` is retired from this design and did not resolve in a 2026-07-29
  DNS check. The v2 HTTP flow is
  `PAYMENT-REQUIRED` (resource server → client challenge), `PAYMENT-SIGNATURE` (client → resource
  server retry), and `PAYMENT-RESPONSE` (resource server → client settlement result), per the
  official [v1 → v2 migration guide](https://docs.cdp.coinbase.com/x402/migration-guide). Context7
  was attempted first but quota-blocked, so the canonical Coinbase documentation was used as the
  spec-authority fallback. Rationale: the
  scoped `@x402/*` 2.20.x line implements v2, and retaining a retired endpoint or v1 header names
  in the design/runbook would make the required Base Sepolia smoke test fail or validate the wrong
  wire contract. Runtime verification remains open under O-11 because this arbitration is
  docs/harness-only. Unchanged: Base Sepolia remains `eip155:84532`; Base mainnet remains
  `eip155:8453` through the authenticated CDP facilitator; package pins, EIP-3009 settlement,
  `X402_PAY_TO`, PRICING, the testnet-only throwaway-wallet boundary, and no-custody are unchanged.

## Open items

- **O-1** _(rob-core)_ — Verify DEX venues beyond Uniswap on-chain: Robinhood docs name
  Uniswap/Lighter/Rialto; the research memo named Arcus/Pleiades. Check factories/routers on
  robinhoodchain.blockscout.com before writing any adapter. Until then: Uniswap v2/v3 only.
- **O-2 — RESOLVED by D-11 (2026-07-29).** _(rob-core)_ — Robinhood now publishes a live on-chain
  asset registry and `GET /rhj/assets`; these seed the verified `data/tokens/4663.json` snapshot.
- **O-3** _(rob-surface)_ — MCP SDK v2 migration (`@modelcontextprotocol/server` + Hono adapter)
  once `@x402/mcp` supports it. Blocked by upstream.
- **O-4 — RESOLVED by D-16 (2026-07-29).** _(rob-surface)_ — SDK 1.30's Web-Standard transport
  supports Bun/Hono directly; no `fetch-to-node` bridge is required.
- **O-5** _(rob-architect → user decision)_ — Confirm that paid API redistribution is permitted
  for both Chainlink tokenized-equity feed values and Robinhood `/rhj/prices`/`/rhj/assets` values
  BEFORE mainnet pricing goes live. Compliance-blocking for Phase E mainnet; D-12 does not imply
  permission.
- **O-6 — RESOLVED by D-12 (2026-07-29).** _(rob-core)_ — The official Robinhood
  `/rhj/prices/{symbol}` endpoint is the feedless fallback, with `/rhj/assets.currentMultiplier`
  conversion.
- **O-7 — RESOLVED (2026-07-29).** _(rob-core)_ — The pinned SDK 1.30 package declares Zod v4
  support, and `test/surfaces.test.ts` proves `registerTool` with the canonical Zod 4.4.3 input and
  object output schemas plus structured content.
- **O-8** _(rob-core; escalation owner rob-architect → user)_ — Monitor Chainlink's official L2
  sequencer-feed directory for Robinhood Chain 4663. Until an address is published and on-chain
  verified, live price-bearing operations fail closed per D-13. Any substitute liveness mechanism
  requires a user-directed amendment to D-3.
- **O-9** _(rob-surface; sign-off rob-security)_ — With a funded Robinhood Agentic Account,
  verify the official Trading MCP connector configuration, upstream tool names/input-output
  schemas, dry-run behavior, and mapping to `position_check`/`trade_prepare`/`trade_execute`.
  Phase F's adapter and execution path remain gated until this evidence exists.
- **O-10** _(user decision; implementation owner rob-surface)_ — Choose the canonical public
  hostname (repository GitHub Pages URL or a custom domain). It must be set as Astro's canonical
  `site`/`base` configuration before production SEO deployment; local site implementation and CI
  validation may proceed meanwhile.
- **O-11** _(rob-surface; sign-off rob-security)_ — D-24's facilitator default and regression test
  have landed separately in `src/http/x402.ts` and `test/http/x402.test.ts`; close this item after
  rob-security signs off and `/x402-smoke` completes against `https://x402.org/facilitator`.
