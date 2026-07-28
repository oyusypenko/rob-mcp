# rob-mcp — tool contract & pricing

The contract both surfaces implement. `src/tools/definitions.ts` encodes this table; any change
here and there ships in the same commit (spec-authority rule). Prices are OUR product pricing —
deliberately in config, not market metrics (`no-market-metrics` rule). All prices settle in USDC
via x402; networks per `architecture.md`.

## Tools

| Tool                              | Tier / price                   | Input (Zod sketch)                                                           | Output (sketch)                                                                                                            |
| --------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `list_stock_tokens`               | **free**                       | `{ search?: string }`                                                        | `[{ ticker, name, address, feed?, venues[], updatedAt }]`                                                                  |
| `stock_premium`                   | $0.005                         | `{ ticker: string, venue?: "univ3" \| "univ2" \| "best" }`                   | `{ dexPriceUsd, oraclePriceUsd, premiumPct, oracleSource: "chainlink" \| "fallback", oracleUpdatedAt, pool, sequencerOk }` |
| `stock_liquidity`                 | $0.01                          | `{ ticker, depthPct?: 1 \| 2 \| 5 }`                                         | `{ venues: [{ venue, pool, feeTier?, tvlToken, tvlQuote, buyDepthUsd, sellDepthUsd, spreadBps }] }`                        |
| `stock_quote`                     | $0.005                         | `{ ticker, side: "buy" \| "sell", amountUsd }`                               | `{ best: { venue, effectivePriceUsd, priceImpactBps }, all: [...] }`                                                       |
| `whale_activity`                  | $0.01                          | `{ ticker?, minUsd?, sinceHours?, kind?: "transfer" \| "mint" \| "redeem" }` | `{ events: [{ txHash, block, time, token, kind, from, to, amount, amountUsd }], scannedThrough }`                          |
| `trade_prepare` / `trade_execute` | free, **local-only** (Phase F) | order params / prepared order id                                             | policy verdict + prepared order / pass-through result                                                                      |

Semantics:

- **Chain-agnostic (D-8)**: every tool additionally accepts `chain?: number` (an enabled chain
  id), defaulting to the first enabled chain (Robinhood 4663 in v1). `list_stock_tokens` lists
  across all enabled chains unless `chain` narrows it. Every output carries `chainId`.
- `ticker` accepts a registry ticker or a token address; resolution via `src/registry/` within
  the resolved chain.
- Every price-bearing output carries provenance (source, timestamp, pool/feed address, chainId) —
  a number without provenance is a bug.
- Paid-tool inputs are bounded (max `sinceHours`, max `amountUsd`, result caps) — unbounded input
  driving RPC fan-out is a paid-DoS vector (rob-security surface #4).
- `trade_*` tools never appear on hosted surfaces.

## Free tier

`/healthz` and `list_stock_tokens` are never paywalled. Paid routes serve `FREE_CALLS_PER_DAY`
per IP per day (sliding window, before the payment middleware), then return the 402 challenge.

## PRICING map

One map (`src/pricing.ts`) drives the Hono `paymentMiddleware` route table AND the `@x402/mcp`
payment wrappers — a price that differs between surfaces is a bug. Price changes are recorded
decisions (append a `D-N`), since they are what agents and the Bazaar listing see.
