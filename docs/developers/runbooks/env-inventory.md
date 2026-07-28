# Environment inventory

Canonical env-var inventory, kept in sync with `.env.example` (both directions) — an env addition
lands in `src/config.ts` AND `.env.example` AND this table in the same change.

No private keys exist in this service's environment by design (`no-custody` rule). The one
exception is `SMOKE_TEST_PRIVATE_KEY` — a throwaway Base Sepolia wallet used exclusively by
`scripts/x402-smoke.ts`, never read by `src/`.

Chains are configured per D-8: `ENABLED_CHAINS` + one `RPC_URL_<chainId>` per enabled chain.
Issuer/AP address sets for mint/redeem classification live in the chain registry
(`data/chains.json` issuer profiles), not in env.
Scanner initial chunk, reorg tail, and head-poll interval are also per-chain registry data (D-18),
not global env, because block cadence and reorg policy vary by chain.

| Var                                     | Mode            | Required                | Meaning                                                                               |
| --------------------------------------- | --------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `ENABLED_CHAINS`                        | all             | no (4663)               | comma-separated chain ids; the FIRST is the default chain for tools                   |
| `RPC_URL_<chainId>`                     | all             | yes, per enabled chain  | https/wss RPC (WS enables head-follow); asserted against live `eth_chainId` at boot   |
| `RPC_URL_<chainId>_ARCHIVE`             | serve, scan     | no                      | archive RPC (Dwellir/Alchemy) for whale backfill; falls back to `RPC_URL_<chainId>`   |
| `PORT`                                  | serve           | no (8402)               | HTTP port                                                                             |
| `SQLITE_PATH`                           | serve, scan     | no (./rob.db)           | chain-keyed whale index (`/data/rob.db` on Fly)                                       |
| `CHAINS_PATH`                           | all             | no (./data/chains.json) | chain registry (venues, oracle config, issuer profiles)                               |
| `TOKENS_DIR`                            | all             | no (./data/tokens)      | per-chain token registries: `<TOKENS_DIR>/<chainId>.json`                             |
| `WHALE_MIN_USD`                         | serve, scan     | no (50000)              | whale threshold — config, never hardcoded                                             |
| `MAX_QUOTE_USD`                         | all             | no (100000)             | maximum `stock_quote.amountUsd` accepted by either surface                            |
| `MAX_WHALE_SINCE_HOURS`                 | all             | no (168)                | maximum `whale_activity` lookback (seven days)                                        |
| `MAX_WHALE_RESULTS`                     | all             | no (200)                | maximum events returned by one `whale_activity` call                                  |
| `LIQUIDITY_CLIP_USD`                    | all             | no (10000)              | canonical buy/sell probe used for comparable venue spreads                            |
| `ROBINHOOD_QUOTE_MAX_AGE_SECONDS`       | all             | no (30)                 | fallback freshness bound; distinct from the endpoint's 15-second cache                |
| `FREE_CALLS_PER_DAY`                    | serve           | no (20)                 | free-tier calls per IP before the 402 challenge                                       |
| `FREE_TIER_MAX_IDENTITIES`              | serve           | no (10000)              | max live 24-hour identity buckets; new identities skip free tier when full            |
| `TRUST_PROXY`                           | serve           | no (none)               | `none` or `fly`; Fly mode trusts only a valid `Fly-Client-IP`, never generic XFF      |
| `MAX_REQUEST_BODY_BYTES`                | serve           | no (65536)              | pre-parse hosted POST cap; positive and at most 1048576                               |
| `PAYMENT_REPLAY_MAX_ENTRIES`            | serve           | no (10000)              | max live payment fingerprints; full live cache fails payment closed                   |
| `PAYMENT_REPLAY_TTL_SECONDS`            | serve           | no (86400)              | payment fingerprint retention window (24 hours)                                       |
| `LOG_LEVEL`                             | all             | no (info)               | JSON logger level                                                                     |
| `X402_PAY_TO`                           | serve           | yes (serve)             | receive-only USDC address on Base — the only address the server knows                 |
| `X402_NETWORK`                          | serve           | no (eip155:84532)       | CAIP-2 settlement network (`eip155:8453` = Base mainnet) — independent of data chains |
| `X402_FACILITATOR_URL`                  | serve           | no                      | facilitator override; testnet defaults to `https://x402.org/facilitator` (D-24)       |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | serve (mainnet) | mainnet only            | Coinbase CDP facilitator auth                                                         |
| `SMOKE_TEST_PRIVATE_KEY`                | scripts only    | no                      | throwaway Base Sepolia payer for `/x402-smoke` — never in `src/`                      |
