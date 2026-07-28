---
name: x402-smoke
description: >-
  Runbook-skill for the end-to-end x402 payment smoke test on Base Sepolia (eip155:84532): boots
  the server in serve mode against the testnet facilitator, exercises a paid route with
  @x402/fetch (402 challenge → EIP-3009 signature → X-PAYMENT retry → verified response) and a
  paid MCP tool via the paid-MCP client. Use when the user says "x402 smoke", "test payments",
  "does the paywall work", before any deploy, and after ANY change to src/http/x402.ts,
  src/pricing.ts, src/mcp/http.ts, or an @x402/* version bump. Testnet-only; uses a throwaway
  funded test wallet — never a real key.
---

# x402 end-to-end smoke test (Base Sepolia)

Authoritative sources: `docs/developers/architecture.md` (x402 flow) and `docs/developers/tools.md`
(PRICING — the prices this test must observe on the wire). Docs win; report drift.

## Docs-first rule (mandatory, every run)

The `@x402/*` line moves fast. Before running, re-verify via context7
(`resolve-library-id` → `query-docs`) — `@x402/fetch` (client wrapper API), `@x402/hono`
(middleware/challenge shape), `@x402/mcp` (paid-tool client) — and WebFetch the x402 quickstart at
docs.cdp.coinbase.com as fallback. If the observed wire shape differs from the docs'd assumption,
that IS the finding — flag before "fixing" the test.

## Invariants this skill will not violate

- **Testnet only.** `X402_NETWORK=eip155:84532`, facilitator `https://facilitator.x402.org`.
  Never point this at `eip155:8453` mainnet or CDP credentials.
- **Throwaway wallet only.** The paying key is a dedicated Base Sepolia test wallet (testnet USDC
  from the Circle faucet), stored in the local untracked `.env` as `SMOKE_TEST_PRIVATE_KEY`.
  It never holds mainnet funds, is referenced by NAME only, and lives exclusively in
  `scripts/x402-smoke.ts` — `src/` must stay signing-free (no-custody rule; hook-enforced).
- **Read-only against the product** — the smoke test buys data, changes nothing.

## Procedure

1. Env: serve-mode `.env` with `X402_NETWORK=eip155:84532`, `X402_PAY_TO=<test receive addr>`,
   `RPC_URL_4663` set; smoke wallet funded with Base Sepolia ETH-gasless USDC (EIP-3009 needs no
   gas from the payer; facilitator settles).
2. Boot: `bun run serve` (or against a deployed URL). `curl /healthz` → 200 with facilitator
   reachable.
3. Challenge shape: `curl -i` a paid route → **402** with an `accepts` body matching PRICING
   (scheme `exact`, network `eip155:84532`, correct price + `payTo`). Free tier: first
   `FREE_CALLS_PER_DAY` calls from a fresh IP return 200 WITHOUT payment; the 402 appears after.
4. Paid HTTP round-trip: `bun scripts/x402-smoke.ts http` — wraps fetch with the x402 client,
   asserts: 402 → auto-payment → 200 + payment-response header, and the JSON payload validates
   against the tool's output schema.
5. Paid MCP round-trip: `bun scripts/x402-smoke.ts mcp` — connects the paid-MCP client to `/mcp`,
   calls one paid tool end-to-end, asserts a paid result (not a 402-in-result).
6. Verify settlement: the USDC transfer to `X402_PAY_TO` visible on Base Sepolia (sepolia.basescan
   .org) — amount equals the PRICING entry.

## Failure triage

402 loop → challenge/client version mismatch (re-check @x402 pins); verify-fails → facilitator URL
or network mismatch; 200-without-payment on a paid route beyond the free tier → **paywall hole,
stop and flag rob-security**; settlement missing but 200 returned → facilitator settle path broken,
treat as FAIL.

## Definition of done

- [ ] 402 challenge matches PRICING on the wire (price, network, payTo).
- [ ] Free tier boundary observed exactly at `FREE_CALLS_PER_DAY`.
- [ ] HTTP and MCP paid round-trips both green; payloads schema-valid.
- [ ] Settlement visible on Base Sepolia for the exact price.
- [ ] No mainnet network/credential touched; test key never left `scripts/`.
