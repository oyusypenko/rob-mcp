# Never hardcode market metrics (always loaded)

- Never hardcode prices, premiums, TVL, volumes, ETH/USD, or any threshold derived from them — in
  code, copy, or docs. Market numbers come from live reads (Chainlink feeds, DEX state) or from
  config/env (`WHALE_MIN_USD`, `FREE_CALLS_PER_DAY`); numbers quoted in docs cite source +
  timestamp.
- Contract addresses, chain IDs, feed decimals, and OUR OWN x402 tool prices (the `PRICING` map)
  are not market metrics — they are protocol facts and product pricing, and live in code/config
  deliberately.
- Every tool output that carries a price carries its provenance (`oracleSource`, `oracleUpdatedAt`,
  pool address) — a number without provenance is a bug.
