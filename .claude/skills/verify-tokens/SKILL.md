---
name: verify-tokens
description: >-
  Runbook-skill for verifying the curated Stock Token registry (data/tokens.json) against live
  Robinhood Chain (4663) state. Use when the user says "verify tokens", "check the registry",
  "add a stock token", "tokens.json is stale", or after any edit to data/tokens.json. Read-only
  against the chain; needs only RPC_URL_4663. Idempotent — safe to re-run any time.
---

# Verify & maintain the Stock Token registry

Authoritative source order: `docs/developers/architecture.md` (registry design — curated, script-
seeded, on-chain-verified; there is no public on-chain registry contract, open item O-2) and
`docs/developers/tools.md` (what registry fields the tools consume). Docs win over this skill;
report drift.

Stock Tokens are ERC-20 (18 decimals) + ERC-8056 (`uiMultiplier()`, `balanceOfUI()`). Chainlink
tokenized-equity feeds on 4663 are 8-decimal USD and already include the `uiMultiplier` — a feed
entry that needs multiplier math is a registry bug, not a tool bug.

## Docs-first rule (mandatory, every run)

Before relying on any flag or ABI shape, consult current docs — context7
(`resolve-library-id` → `query-docs`) for viem (multicall) and Chainlink data feeds; WebFetch
fallbacks: https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood and the
Robinhood Chain "Building with Stock Tokens" page (token contract listing).

## Invariants this skill will not violate

- **Read-only.** No private key, no signing, no state change. The only env var referenced is
  `RPC_URL_4663` (by name — never read a real `.env`).
- **Nothing enters `data/tokens.json` unverified.** Every entry must pass the on-chain check below
  before commit; a failing entry is removed or fixed, never waved through.
- **No hardcoded market metrics** — the verify step sanity-checks that a feed ANSWERS, never
  asserts what the price should be.

## Procedure

1. `bun run verify-tokens` (script: `scripts/verify-tokens.ts`). For every registry entry it
   multicalls the token (`symbol`, `decimals`, `uiMultiplier`) and, when a `feed` is present, the
   aggregator (`decimals` == 8, `latestRoundData` fresh + positive answer), and cross-checks
   registry fields. Exit non-zero on any drift, with a per-entry report.
2. **Adding a token**: `bun scripts/seed-tokens.ts --ticker XXX` drafts the entry from the
   Robinhood docs token page + the Chainlink address page; then run step 1; then eyeball the token
   address on robinhoodchain.blockscout.com (holders, first mint from an Authorized Participant).
3. **On drift** (symbol mismatch, dead feed, changed multiplier semantics): fix or drop the entry;
   if the DRIFT reveals a design assumption breaking (e.g. a registry contract appears, feed
   semantics change), stop and flag to rob-architect for a `D-N` decision instead of patching
   silently.
4. Re-run step 1 until green; commit `data/tokens.json` and the report summary in the message.

## Definition of done

- [ ] `bun run verify-tokens` exits 0 against the live 4663 RPC.
- [ ] Every entry with a `feed` shows a fresh, positive 8-dec answer.
- [ ] New entries eyeballed on Blockscout (real token, real AP mint history).
- [ ] No secret touched; no market number committed anywhere.
