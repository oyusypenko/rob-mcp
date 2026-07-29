# rob-mcp

**Verified tokenized-stock data for agents, exposed through MCP and an x402-paid JSON API.**

## What the app does

rob-mcp is a read-only market-data server for AI agents and applications working with tokenized
stocks. It turns verified EVM chain data into typed tools that can:

- discover supported stock tokens and their contract addresses;
- compare a token’s DEX price with its reference oracle;
- inspect verified-pool liquidity, depth, and spread;
- rank executable buy or sell quotes across supported venues;
- track large transfers, mint/redeem activity, and issuer-participant flows.

Every market-derived result carries chain, source, time, oracle, and pool provenance where
applicable. Unsafe, stale, incomplete, or liveness-unverified data fails with a typed error instead
of returning a plausible-looking number. rob-mcp does not provide investment advice and the hosted
service never receives user private keys, Robinhood credentials, connector URLs, or user funds.

## How users can use it

| Use path                   | Best for                                     | How it works                                                                   |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| Local MCP                  | Claude, Codex, IDEs, and desktop MCP clients | Run free stdio MCP from a source checkout and provide your own EVM RPC.        |
| Hosted Streamable HTTP MCP | Remote MCP-capable agents                    | Connect to `/mcp`; paid tools share the same x402 per-call prices as the API.  |
| JSON API                   | Scripts, backends, and non-MCP agents        | `POST` JSON to `/api/v1/tools/<tool-name>`; no account or API key is needed.   |
| Local trading composition  | Guarded use of a user’s Robinhood MCP        | Local-only and currently disabled until the O-9 upstream contract is verified. |

The fastest currently supported path is local MCP:

```bash
git clone https://github.com/oyusypenko/rob-mcp.git
cd rob-mcp
bun install --frozen-lockfile
export RPC_URL_4663="https://your-robinhood-chain-rpc.example"
bun run dev
```

Then call the always-free `list_stock_tokens` tool, for example with
`{"search":"AAPL","chain":4663}`. See [Run local MCP](#run-local-mcp) for client configuration, or
[Run the hosted test surface](#run-the-hosted-test-surface) to exercise the HTTP/MCP server on Base
Sepolia. A public production endpoint is not advertised until the deployment and compliance gates
in [Status](#status) are resolved.

## How it works

rob-mcp has one canonical tool contract and a layered data flow:

1. Chain, issuer, token, quote-asset, oracle, and venue registries define verified protocol facts.
2. Read-only adapters query EVM RPCs, Chainlink, verified Uniswap pools, and the official fallback
   source where the architecture permits it.
3. A pure core computes premium, liquidity, quotes, and transfer classifications without network
   or transport assumptions.
4. `src/tools/definitions.ts` binds strict inputs, outputs, availability errors, and handlers once.
5. The same definitions power local MCP, hosted MCP, and versioned JSON routes. One `PRICING` map
   powers both hosted paywalls.

## EVM chain-agnostic architecture

rob-mcp is chain-agnostic across EVM networks. Core logic does not hardcode Robinhood Chain or any
other chain: enabled chains are data in `data/chains.json`, with issuer profiles and per-chain token
registries under `data/tokens/`. Every data tool accepts an optional `chain` ID and every result
identifies its `chainId`.

Adding another EVM chain means supplying and verifying its registry data, RPC, issuer semantics,
oracle safety configuration, quote assets, and venue contracts—not forking the core calculations.
The scope is intentionally EVM-only and uses viem clients per enabled chain.

Robinhood Chain (4663) is the first and default enabled chain. Its checked-in registry currently
contains 96 tokens and 32 verified Chainlink tokenized-equity feeds.

## Status

The core, adapters, MCP/HTTP surfaces, scanner, security boundaries, derived documentation site,
and testnet payment challenge are implemented and validated in CI.

Production availability remains intentionally gated:

- live price-bearing reads and priced whale indexing fail closed until Robinhood Chain has an
  official Chainlink sequencer-uptime feed (O-8);
- Base mainnet payments fail closed until paid data redistribution is approved (O-5);
- the local Robinhood Trading MCP adapter remains disabled until its funded upstream contract is
  verified (O-9);
- GitHub Pages waits for the canonical hostname choice (O-10);
- funded HTTP/MCP settlement smoke tests require a throwaway Base Sepolia USDC wallet (O-11).

## Tools

| Tool                | Purpose                                              | Runtime tier |
| ------------------- | ---------------------------------------------------- | ------------ |
| `list_stock_tokens` | Search the verified token registry                   | always free  |
| `stock_premium`     | DEX price versus a provenance-bearing oracle         | x402 paid    |
| `stock_liquidity`   | Verified venue depth and spread                      | x402 paid    |
| `stock_quote`       | Ranked executable quotes across verified venues      | x402 paid    |
| `whale_activity`    | Large transfers plus mint/redeem flow                | x402 paid    |
| trading tools       | Guarded local composition with Robinhood Trading MCP | O-9 gated    |

Exact per-call prices come from `src/pricing.ts` and are checked against
[`docs/developers/tools.md`](docs/developers/tools.md). There is no subscription, rob-mcp account,
or API key.

## Run local MCP

The npm package is not published yet, so use a source checkout:

```bash
git clone https://github.com/oyusypenko/rob-mcp.git
cd rob-mcp
bun install --frozen-lockfile

export RPC_URL_4663="https://your-robinhood-chain-rpc.example"
bun run dev
```

MCP client configuration:

```json
{
  "mcpServers": {
    "rob-mcp": {
      "command": "bun",
      "args": ["/absolute/path/to/rob-mcp/src/cli.ts"],
      "env": {
        "RPC_URL_4663": "https://your-robinhood-chain-rpc.example"
      }
    }
  }
}
```

Start with `list_stock_tokens`, for example `{"search":"AAPL","chain":4663}`. Boot verifies the
RPC's live chain ID and fails closed on a mismatch.

## Run the hosted test surface

Use a receive-only Base Sepolia address; rob-mcp never receives a payer key:

```bash
export RPC_URL_4663="https://your-robinhood-chain-rpc.example"
export X402_NETWORK="eip155:84532"
export X402_PAY_TO="<YOUR_RECEIVE_ONLY_BASE_SEPOLIA_ADDRESS>"
export FREE_CALLS_PER_DAY="2"

bun run serve
```

In another shell:

```bash
curl --fail-with-body \
  -X POST "http://127.0.0.1:8402/api/v1/tools/list_stock_tokens" \
  -H "Content-Type: application/json" \
  --data '{"search":"AAPL","chain":4663}'

X402_NETWORK="eip155:84532" \
X402_PAY_TO="<YOUR_RECEIVE_ONLY_BASE_SEPOLIA_ADDRESS>" \
SMOKE_TEST_BASE_URL="http://127.0.0.1:8402" \
FREE_CALLS_PER_DAY="2" \
  bun scripts/x402-smoke.ts challenge
```

The `challenge` smoke spends nothing. Funded `http` and `mcp` modes are Base Sepolia-only and read
`SMOKE_TEST_PRIVATE_KEY` solely from the test script environment.

## Marketing and documentation site

```bash
bun run site:dev
bun run site:check
```

The static Astro site generates tool pages, schemas, examples, pricing, config, chain support, and
availability gates from canonical repository sources. It includes sitemap, robots, structured
data, accessibility/link checks, and performance budgets. Production Pages deployment stays
disabled until `SITE_CANONICAL_URL` resolves O-10.

## Development

```bash
bun run codex:setup
bun run validate
bun run verify-tokens
```

`bun run validate` checks formatting, hard rules, Codex/Claude mirror parity, types, tests, and the
derived site. Architecture and contribution rules are in
[`docs/developers/architecture.md`](docs/developers/architecture.md), `CLAUDE.md`, and `AGENTS.md`.

The hosted service never stores private keys, Robinhood credentials, connector URLs, or user
funds. See [`docs/developers/architecture.md`](docs/developers/architecture.md) for the no-custody
boundary.

## License

MIT
