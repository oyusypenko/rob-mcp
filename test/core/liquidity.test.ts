import { describe, expect, test } from "bun:test";
import {
  calculateV2PoolMetrics,
  calculateV3PoolMetrics,
  rankQuotes,
} from "../../src/core/liquidity";

describe("liquidity core", () => {
  test("derives v2 TVL, depth, and spot price from injected reserves", () => {
    const metrics = calculateV2PoolMetrics({
      reserveToken: 1_000n * 10n ** 18n,
      reserveQuote: 100_000n * 10n ** 6n,
      tokenDecimals: 18,
      quoteDecimals: 6,
      depthPct: 1,
    });

    expect(metrics.spotPriceUsd).toBeCloseTo(100);
    expect(metrics.tvlToken).toBeCloseTo(1_000);
    expect(metrics.tvlQuote).toBeCloseTo(100_000);
    expect(metrics.buyDepthUsd).toBeGreaterThan(0);
    expect(metrics.sellDepthUsd).toBeGreaterThan(0);
  });

  test("approximates v3 in-range virtual reserves from sqrtPriceX96 and liquidity", () => {
    const metrics = calculateV3PoolMetrics({
      sqrtPriceX96: 2n ** 96n / 100_000n,
      liquidity: 1_000_000n * 10n ** 12n,
      tokenIsToken0: true,
      tokenDecimals: 18,
      quoteDecimals: 6,
      depthPct: 2,
    });
    expect(metrics.spotPriceUsd).toBeCloseTo(100);
    expect(metrics.buyDepthUsd).toBeGreaterThan(0);
    expect(metrics.sellDepthUsd).toBeGreaterThan(0);
  });

  test("ranks buy quotes low-to-high and sell quotes high-to-low", () => {
    const candidates = [
      { venue: "univ2" as const, effectivePriceUsd: 101 },
      { venue: "univ3" as const, effectivePriceUsd: 100 },
    ];
    expect(rankQuotes("buy", candidates)[0]?.venue).toBe("univ3");
    expect(rankQuotes("sell", candidates)[0]?.venue).toBe("univ2");
  });
});
