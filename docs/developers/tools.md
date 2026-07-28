# rob-mcp — tool contract & pricing

The contract both surfaces implement. `src/tools/definitions.ts` encodes this table; any change
here and there ships in the same commit (spec-authority rule). Prices are OUR product pricing —
deliberately in config, not market metrics (`no-market-metrics` rule). All prices settle in USDC
via x402; networks per `architecture.md`.

## Tools

| Tool                              | Tier / price                   | Input (Zod sketch)                                                                                           | Output (sketch)                                                                                                                                                            |
| --------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_stock_tokens`               | **free**                       | `{ search?: string }`                                                                                        | `{ tokens: [{ ticker, name, address, feed?, venues[], updatedAt, chainId }] }`                                                                                             |
| `stock_premium`                   | $0.005                         | `{ ticker: string, venue?: "univ3" \| "univ2" \| "best" }`                                                   | `{ dexPriceUsd, oraclePriceUsd, premiumPct, oracleSource, oracleUpdatedAt, pool, oraclePaused: false, sequencerOk: true }`                                                 |
| `stock_liquidity`                 | $0.01                          | `{ ticker, depthPct?: 1 \| 2 \| 5 }`                                                                         | `{ venues: [{ venue, pool, feeTier?, tvlToken, tvlQuote, buyDepthUsd, sellDepthUsd, spreadBps }] }`                                                                        |
| `stock_quote`                     | $0.005                         | `{ ticker, side: "buy" \| "sell", amountUsd }`                                                               | `{ best: { venue, effectivePriceUsd, priceImpactBps }, all: [...] }`                                                                                                       |
| `whale_activity`                  | $0.01                          | `{ ticker?, minUsd?, sinceHours?, limit?, kind?: "transfer" \| "mint" \| "redeem" \| "ap-flow" \| "whale" }` | `{ events: [{ chainId, txHash, block, time, token, kind, from, to, amount, amountUsd, oracleSource, oracleUpdatedAt, oracleAddress?, oracleProvider? }], scannedThrough }` |
| `position_check`                  | free, **local-only** (Phase F) | position/ticker query                                                                                        | read-through position result                                                                                                                                               |
| `trade_prepare` / `trade_execute` | free, **local-only** (Phase F) | order params / prepared order id                                                                             | policy verdict + prepared order / pass-through result                                                                                                                      |

Semantics:

- **Chain-agnostic (D-8)**: every tool additionally accepts `chain?: number` (an enabled chain
  id), defaulting to the first enabled chain (Robinhood 4663 in v1). `list_stock_tokens` lists
  across all enabled chains unless `chain` narrows it. Every output carries `chainId`.
- `ticker` accepts a registry ticker or a token address; resolution via `src/registry/` within
  the resolved chain.
- `list_stock_tokens` uses an object envelope (D-17) so the same output schema is valid MCP
  structured content and HTTP JSON.
- Every price-bearing output carries provenance (source, timestamp, pool/feed address, chainId) —
  a number without provenance is a bug.
- `stock_premium` uses Chainlink first. Feedless Robinhood assets fall back to the official
  `/rhj/prices/{symbol}` midpoint adjusted by `/rhj/assets.currentMultiplier` (D-12), with both
  source time and multiplier provenance. On chain 4663, live price-bearing operations currently
  fail closed with `SEQUENCER_STATUS_UNAVAILABLE` until O-8 resolves (D-13).
- Successful live price outputs include `oraclePaused: false` and `sequencerOk: true` (D-20).
  Either unsafe gate returns a typed error; callers cannot set these internal booleans.
- `stock_quote.amountUsd <= MAX_QUOTE_USD`; `stock_liquidity` uses the configured
  `LIQUIDITY_CLIP_USD` probe. A token with no verified pool returns `{ venues: [] }` from
  `stock_liquidity`; quote/premium return `NO_VERIFIED_POOL` (D-19).
- `whale_activity.sinceHours <= MAX_WHALE_SINCE_HOURS`; `limit` is optional and capped by
  `MAX_WHALE_RESULTS` (omitted means the configured maximum). Its input/output kind enum is exactly
  `transfer | mint | redeem | ap-flow | whale`. Each event's persisted `time` avoids per-result
  RPC calls, and each `amountUsd` carries event-level oracle provenance (D-18).
- Paid-tool inputs are bounded — unbounded input driving RPC fan-out is a paid-DoS vector
  (rob-security surface #4).
- `position_check`, `trade_prepare`, and `trade_execute` never appear on hosted surfaces; their
  upstream connector mapping remains gated on O-9.

## HTTP routes

The Hono surface derives exactly one route per hosted tool from the canonical definition:
`POST /api/v1/tools/<tool-name>` with a JSON request body (D-15). There are no GET or unversioned
tool aliases. `GET /healthz` is the health endpoint and `POST /mcp` is the hosted MCP endpoint.
Every hosted POST body is capped by `MAX_REQUEST_BODY_BYTES` before parsing or payment work
(D-22).

## Free tier

`/healthz` and `list_stock_tokens` are never paywalled. Paid routes serve `FREE_CALLS_PER_DAY`
per IP per day (sliding window, before the payment middleware), then return the 402 challenge.
Identity/proxy trust and the bounded free-tier/replay stores follow D-22; capacity never grants an
extra free call or forgets live replay evidence.

## PRICING map

One map (`src/pricing.ts`) drives the Hono `paymentMiddleware` route table AND the `@x402/mcp`
payment wrappers — a price that differs between surfaces is a bug. Price changes are recorded
decisions (append a `D-N`), since they are what agents and the Bazaar listing see.
The derived `/pricing/` site page also consumes this map and must verify the exact values in this
table during `site:check`; site content cannot define or override a price (D-23).
