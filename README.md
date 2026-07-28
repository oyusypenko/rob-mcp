# rob-mcp

**MCP server + x402-paid API for tokenized stocks on EVM chains — starting with Robinhood Chain.**

AI agents (Claude, ChatGPT, trading bots) call paid tools for the data that matters on tokenized
equities: premium/discount vs the Chainlink equity oracle, cross-DEX liquidity and spreads, whale
transfers and mint/redeem flow — plus a local safety wrapper around Robinhood's official Trading
MCP. The core is chain-agnostic; Robinhood Chain (chain ID 4663) is the first supported chain,
with other tokenized-equity venues (Backed xStocks, Dinari dShares chains) addable as data +
adapters.

> **Status: pre-alpha.** Repo scaffold + project governance are in place; product code lands
> per the phase plan in `docs/developers/architecture.md`.

## What it will do

| Tool                              | What it answers                                               | Tier             |
| --------------------------------- | ------------------------------------------------------------- | ---------------- |
| `list_stock_tokens`               | Which Stock Tokens exist, where they trade                    | free             |
| `stock_premium`                   | On-chain DEX price vs Chainlink oracle — the arbitrage signal | paid (x402)      |
| `stock_liquidity`                 | Depth + spread per venue                                      | paid (x402)      |
| `stock_quote`                     | Best execution across venues for a size                       | paid (x402)      |
| `whale_activity`                  | Large transfers, mints, redeems on Stock Token contracts      | paid (x402)      |
| `position_check`                  | Read a position via YOUR Robinhood Trading MCP                | free, local-only |
| `trade_prepare` / `trade_execute` | Guarded orders via YOUR Robinhood Trading MCP                 | free, local-only |

Payments: [x402](https://x402.org) — USDC per call on Base, no accounts, no API keys.
One free tier for discovery; per-tool pricing in `docs/developers/tools.md`.

Phase G adds a public, SEO-oriented marketing and documentation site with generated tool
references, copy-paste MCP/API examples, troubleshooting, safety guidance, and a dedicated pricing
page. It is derived from the repository's canonical tool/pricing/design sources rather than
maintaining a second contract; see `docs/developers/site.md`. The production hostname remains open
as O-10.

## Quickstart (target UX — not live yet)

```bash
# local, free, bring your own RPC
bunx rob-mcp            # stdio MCP for Claude Desktop / Claude Code

# hosted, paid
#   POST https://<host>/mcp        (Streamable HTTP MCP, x402-paid tools)
#   POST https://<host>/api/v1/tools/<tool-name>  (JSON API, x402 paywall)
#   GET  https://<host>/healthz
```

## Development

- Runtime: [Bun](https://bun.com). `bun install`, then `bun run validate` (format check →
  hard-rules scan → typecheck → tests).
- Project instructions for AI-assisted development: `CLAUDE.md` (authority chain: the docs in
  `docs/developers/**` win over code). One-time setup: `git config core.hooksPath .githooks`.
- No custody, ever: this server never holds user private keys or Robinhood credentials
  (`.claude/rules/no-custody.md`).

## License

MIT
