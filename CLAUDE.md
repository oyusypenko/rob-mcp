# rob-mcp — MCP server + x402-paid API for Robinhood Chain Stock Tokens

Source of truth: `README.md` + the developer docs under `docs/developers/**`. When code and docs
disagree, the docs win; when the docs are silent or self-contradictory, never self-resolve — ask, or
record the decision in `docs/developers/design-decisions.md` (numbered `D-N`, dated, append-only).

This file is the map. Policy lives in **`.claude/rules/`** — all four rules are always on:
`spec-authority` (docs-first + context7), `no-custody`, `no-market-metrics`, `versions-pinned`.
Rule violations are bugs, not style — write-time enforcement is in `.claude/hooks/` (hard-rule grep
on write, secret/destructive-command guard, typecheck on stop). **Never create plans/trackers/
status/progress md files anywhere** — phase state lives in git history and `design-decisions.md`.

## What this is

One core, two surfaces. Pure data services (Stock Token premium vs Chainlink oracle, cross-DEX
liquidity/spreads, whale + mint/redeem flow) behind ports, exposed as:
(a) a **Hono JSON API** paywalled per-call with x402 (USDC on Base) — what x402 Bazaar lists;
(b) an **MCP server** — free local stdio (`bunx rob-mcp`, BYO-RPC) and hosted Streamable HTTP with
x402-paid tools. Plus a **local-only** trading wrapper around the user's own Robinhood Trading MCP.
`src/tools/definitions.ts` is the single source of truth feeding both surfaces; the one `PRICING`
map drives both paywalls. Full design: `docs/developers/architecture.md`; tool contract:
`docs/developers/tools.md`.

## Map

| Path                                                        | What it is                                                                    | Owner agent                               |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| `src/chain/`, `src/registry/`, `src/core/`, `src/adapters/` | viem client (4663), curated token registry, pure math, oracle/DEX/scanner I/O | rob-core                                  |
| `src/tools/`                                                | Tool layer: Zod schemas + handlers — the contract both surfaces consume       | rob-core                                  |
| `src/mcp/`, `src/http/`, `src/pricing.ts`                   | MCP transports (stdio + Streamable HTTP), Hono app, x402 wiring, deploy       | rob-surface                               |
| `src/trading/`                                              | LOCAL-ONLY guarded wrapper over the user's Robinhood Trading MCP              | rob-surface (policy review: rob-security) |
| `src/{cli,index,config,logger,health,deps}.ts`              | Entry points, fail-closed Zod config, JSON logger, health, DI container       | rob-core                                  |
| `scripts/`, `data/tokens.json`                              | validate.sh, registry seed/verify, curated Stock Token registry               | rob-core                                  |
| `docs/developers/`                                          | Design docs + decisions log + runbooks — the authority                        | rob-architect                             |

Cross-cutting: **rob-architect** (docs interpretation, decision arbitration, authoring `.claude/`
assets) and **rob-security** (adversarial review of custody boundaries, trading policy, payment
flow, secrets; it refutes, never fixes).

Architecture discipline (from the keeper/api patterns this repo is modeled on): pure core first with
a fake-backed `bun test` (injected clock, scripted fakes in `test/fakes.ts`), adapters second; all
handlers take `Deps` (DI container in `src/deps.ts`); config fails closed (Zod, `CHAIN_ID` asserted
against live `eth_chainId` at boot).

## Golden commands

- `bun run validate` — local CI mirror + pre-commit hook (format check → hard-rules scan →
  typecheck → tests). One-time setup: `git config core.hooksPath .githooks`.
- `bun test` · `bun run typecheck` · `bun run format`
- `bun run verify-tokens` — on-chain verification of `data/tokens.json` (the `/verify-tokens` skill)
- `bun run dev` (stdio MCP) · `bun run serve` (hosted HTTP) · `bun run scan` (whale backfill)

## Chain & payment facts

- **Robinhood Chain**: chain ID **4663** (testnet 46630), Arbitrum Orbit L2, ETH gas, ~100ms blocks,
  single FCFS sequencer. Explorer: robinhoodchain.blockscout.com.
- **Stock Tokens**: ERC-20 (18 dec) + ERC-8056 extension (`uiMultiplier()`, `balanceOfUI()`);
  mint/burn restricted to KYB'd Authorized Participants — zero-address/issuer transfers classify as
  mint/redeem. No public on-chain registry → curated `data/tokens.json`, verified on-chain.
- **Oracle**: official Chainlink tokenized-equity feeds on 4663 (`AggregatorV3Interface`, 8-dec USD,
  24/5); feed price already includes `uiMultiplier` → directly comparable to DEX price. Always gate
  on staleness + the L2 sequencer-uptime feed.
- **DEX addresses (4663)** — Uniswap v3: Factory `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`,
  QuoterV2 `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7`, SwapRouter02
  `0xcaf681a66d020601342297493863e78c959e5cb2`; Uniswap v2: Factory
  `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f`; WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`.
  Other venues (Arcus/Pleiades/Rialto/Lighter) are UNVERIFIED on-chain — open item O-1 in the
  decisions log; verify on Blockscout before writing an adapter.
- **x402**: CAIP-2 networks — `eip155:8453` (Base mainnet, USDC settlement) / `eip155:84532`
  (Base Sepolia, testnet facilitator `https://facilitator.x402.org`); mainnet uses the Coinbase CDP
  facilitator with `@coinbase/x402` auth. Flow: 402 challenge → client signs EIP-3009
  `transferWithAuthorization` → `X-PAYMENT` retry → facilitator verify/settle.
- **Robinhood Agentic Trading**: official Trading MCP, per-user connector URL, ring-fenced Agentic
  Account. Our wrapper composes the USER's connection, locally, only.

## MCP (`.mcp.json`, committed)

- **context7** — current library docs (the docs-first rule). The MCP SDK and x402 lines move fast;
  re-verify APIs there before every implementation session. Secrets never go in `.mcp.json`.
