# No custody, ever (always loaded)

The hosted service NEVER holds, receives, or transmits:

- user private keys, mnemonics, or keystores — the server signs nothing; there is no wallet client
  in `src/` (enforced by `check-hard-rules.sh`; `scripts/` may use a throwaway test wallet for the
  x402 smoke test only);
- Robinhood credentials or personal Trading-MCP connector URLs — the trading wrapper
  (`src/trading/`) is a LOCAL stdio process on the user's machine, composes the user's own Robinhood
  MCP connection from local config, and is never deployed, hosted, or proxied through the paid
  server. No `src/http/` or `src/mcp/http` code may import from `src/trading/`;
- user funds — the only address the server knows is `X402_PAY_TO`, a receive-only USDC address on
  Base. x402 settlement is facilitator-mediated; we never touch the payer's wallet.

**Why:** custody converts a data tool into a regulated financial service and a theft target; the
research memo (robbed repo `docs/developers/ai-research.md`) and the SEC's tokenized-securities
posture make this the death line for a solo dev.

**How to apply:** any feature that would require a server-side key, credential pass-through, or
hosted trading is rejected at design time — record the refusal in the decisions log if it keeps
coming up. rob-security reviews every diff that touches `src/trading/`, `src/http/x402.ts`, or
config handling.
