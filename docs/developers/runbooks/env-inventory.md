# Environment inventory

Canonical env-var inventory, kept in sync with `.env.example` (both directions) — an env addition
lands in `src/config.ts` AND `.env.example` AND this table in the same change.

No private keys exist in this service's environment by design (`no-custody` rule). The one
exception is `SMOKE_TEST_PRIVATE_KEY` — a throwaway Base Sepolia wallet used exclusively by
`scripts/x402-smoke.ts`, never read by `src/`.

| Var                                                 | Mode            | Required                | Meaning                                                                        |
| --------------------------------------------------- | --------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `RPC_URL_4663`                                      | all             | yes                     | https/wss RPC for Robinhood Chain mainnet (WS enables head-follow)             |
| `RPC_URL_4663_ARCHIVE`                              | serve, scan     | no                      | archive RPC (Dwellir/Alchemy) for whale backfill; falls back to `RPC_URL_4663` |
| `CHAIN_ID`                                          | all             | yes                     | fail-closed identity gate; must equal live `eth_chainId` at boot               |
| `PORT`                                              | serve           | no (8402)               | HTTP port                                                                      |
| `SQLITE_PATH`                                       | serve, scan     | no (./rob.db)           | whale index location (`/data/rob.db` on Fly)                                   |
| `TOKENS_PATH`                                       | all             | no (./data/tokens.json) | curated Stock Token registry                                                   |
| `ISSUER_ADDRESSES`                                  | serve, scan     | no                      | comma-separated issuer/AP addresses for mint/redeem classification             |
| `WHALE_MIN_USD`                                     | serve, scan     | no (50000)              | whale threshold — config, never hardcoded                                      |
| `FREE_CALLS_PER_DAY`                                | serve           | no (20)                 | free-tier calls per IP before the 402 challenge                                |
| `LOG_LEVEL`                                         | all             | no (info)               | JSON logger level                                                              |
| `X402_PAY_TO`                                       | serve           | yes (serve)             | receive-only USDC address on Base — the only address the server knows          |
| `X402_NETWORK`                                      | serve           | no (eip155:84532)       | CAIP-2 settlement network (`eip155:8453` = Base mainnet)                       |
| `X402_FACILITATOR_URL`                              | serve           | no                      | facilitator override; defaults per network                                     |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`             | serve (mainnet) | mainnet only            | Coinbase CDP facilitator auth                                                  |
| `FALLBACK_QUOTE_API_URL` / `FALLBACK_QUOTE_API_KEY` | serve           | no                      | off-chain equity quotes for feedless tickers (O-6)                             |
| `SMOKE_TEST_PRIVATE_KEY`                            | scripts only    | no                      | throwaway Base Sepolia payer for `/x402-smoke` — never in `src/`               |
