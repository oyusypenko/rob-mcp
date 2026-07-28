import { describe, expect, test } from "bun:test";
import { DexRegistry } from "../../src/adapters/dex-registry";
import type { DexPort } from "../../src/core/ports";

function fakeDex(venue: "univ2" | "univ3", effectivePriceUsd: number): DexPort {
  return {
    venue,
    async quote(input) {
      return [
        {
          chainId: input.chainId,
          venue,
          pool: "0x0000000000000000000000000000000000000001",
          effectivePriceUsd,
          priceImpactBps: 1,
          observedAt: "2026-07-29T00:00:00.000Z",
          quoteToken: "USD",
          oracleSource: "chainlink",
          oracleUpdatedAt: "2026-07-29T00:00:00.000Z",
          oraclePaused: false,
          sequencerOk: true,
        },
      ];
    },
    async liquidity(input) {
      return [
        {
          chainId: input.chainId,
          venue,
          pool: "0x0000000000000000000000000000000000000001",
          tvlToken: 1,
          tvlQuote: 100,
          buyDepthUsd: 1,
          sellDepthUsd: 1,
          spreadBps: 1,
          observedAt: "2026-07-29T00:00:00.000Z",
          quoteToken: "USD",
          oracleSource: "chainlink",
          oracleUpdatedAt: "2026-07-29T00:00:00.000Z",
          oraclePaused: false,
          sequencerOk: true,
        },
      ];
    },
  };
}

describe("DEX registry", () => {
  test("fans out to verified adapters and honors a venue selector", async () => {
    const registry = new DexRegistry([fakeDex("univ2", 101), fakeDex("univ3", 100)]);
    const all = await registry.quote({
      chainId: 1,
      tokenAddress: "0x0000000000000000000000000000000000000010",
      side: "buy",
      amountUsd: 100,
      referencePriceUsd: 100,
      venue: "best",
    });
    expect(all).toHaveLength(2);

    const v2 = await registry.quote({
      chainId: 1,
      tokenAddress: "0x0000000000000000000000000000000000000010",
      side: "buy",
      amountUsd: 100,
      referencePriceUsd: 100,
      venue: "univ2",
    });
    expect(v2.map(({ venue }) => venue)).toEqual(["univ2"]);
  });
});
