---
name: verify-tokens
description: >-
  Runbook-skill for verifying the curated per-chain token registries (data/tokens/{chainId}.json)
  against live chain state — first chain: Robinhood (4663). Use when the user says "verify
  tokens", "check the registry", "add a stock token", "the token registry is stale", or after any
  edit under data/. Read-only against the chains; needs only the RPC_URL_{chainId} vars for
  enabled chains. Idempotent — safe to re-run any time.
---

# Verify & maintain the Stock Token registry

Authoritative source order: `docs/developers/architecture.md` (D-11's official-source,
script-seeded, on-chain-verified snapshot design) and `docs/developers/tools.md` (what registry
fields the tools consume). Docs win over this skill; report drift.

Issuer semantics come from the chain's issuer profile (`data/chains.json`). On 4663: Stock Tokens
are ERC-20 (18 decimals) + ERC-8056 (`uiMultiplier()`, `balanceOfUI()`), and the Chainlink
tokenized-equity feeds are 8-decimal USD and already include the `uiMultiplier` — a feed entry
that needs multiplier math is a registry bug, not a tool bug. Other chains/issuers verify against
their own profile's fields. D-21 records
`0xcfAEce2151502dA2a21d47234ae1f08618A60A94` as the verified 4663 ForwarderV4 participant;
zero-address mint/redeem classification takes precedence over participant flow.

## Docs-first rule (mandatory, every run)

Before relying on any flag or ABI shape, consult current docs — context7
(`resolve-library-id` → `query-docs`) for viem (multicall) and Chainlink data feeds; WebFetch
fallbacks: https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood and the
Robinhood Chain Token Contracts, Stock Token APIs, and "Building with Stock Tokens" pages.

## Invariants this skill will not violate

- **Read-only.** No private key, no signing, no state change. The only env vars referenced are
  the `RPC_URL_<chainId>` vars (by name — never read a real `.env`).
- **Nothing enters a token registry unverified.** Every entry in every `data/tokens/<chainId>.json`
  must pass the on-chain check below before commit; a failing entry is removed or fixed, never
  waved through.
- **Quote assets and pools are verified too.** Validate each chain registry quote token/feed, and
  accept pool addresses only when factory discovery plus bytecode/token/fee checks pass (D-19).
  No pool is a valid result; never add a plausible address to avoid an empty venue list.
- **No hardcoded market metrics** — the verify step sanity-checks that a feed ANSWERS, never
  asserts what the price should be.

## Procedure

1. `bun run verify-tokens` (script: `scripts/verify-tokens.ts`). For every registry entry it
   multicalls the token (`symbol`, `decimals`, `uiMultiplier`) and, when a `feed` is present, the
   aggregator (`decimals` == 8, `latestRoundData` fresh + positive answer), and cross-checks
   registry fields. It also verifies chain quote assets/feeds and every discovered pool's factory,
   token ordering, bytecode, and v3 fee. Exit non-zero on any drift, with a per-entry report.
2. **Adding a token**: `bun scripts/seed-tokens.ts --ticker XXX` drafts the entry from the
   official Robinhood on-chain asset registry/`GET /rhj/assets`, enriches it from the official
   Chainlink feed directory and verified venue state, then run step 1; then eyeball the token
   address on robinhoodchain.blockscout.com (holders, first mint from an Authorized Participant).
3. **On drift** (symbol mismatch, dead feed, changed multiplier semantics): fix or drop the entry;
   if the DRIFT reveals a design assumption breaking (e.g. the official registry/API disagree or
   feed semantics change), stop and flag to rob-architect for a `D-N` decision instead of patching
   silently.
4. Re-run step 1 until green; commit the affected `data/tokens/<chainId>.json` snapshot and include
   the report summary in the commit message.

## Definition of done

- [ ] `bun run verify-tokens` exits 0 against the live 4663 RPC.
- [ ] Every entry with a `feed` shows a fresh, positive 8-dec answer.
- [ ] Chain quote assets/feeds and every recorded v2/v3 pool pass their D-19 checks; missing pools
      remain empty rather than guessed.
- [ ] Issuer participant addresses still match verified implementation + transfer-history
      evidence; 4663 includes D-21's ForwarderV4 proxy.
- [ ] New entries eyeballed on Blockscout (real token, real AP mint history).
- [ ] No secret touched; no market number committed anywhere.
