import { describe, expect, test } from "bun:test";
import { UniswapV2Adapter, type UniswapV2Reader } from "../../src/adapters/uniswap-v2";
import { UniswapV3Adapter, type UniswapV3Reader } from "../../src/adapters/uniswap-v3";
import type { DexPoolCatalog } from "../../src/adapters/dex-pools";
import type { OraclePort } from "../../src/core/ports";
import { fixedClock } from "../fakes";

const token = "0x0000000000000000000000000000000000000010";
const quote = "0x0000000000000000000000000000000000000020";
const pool = "0x0000000000000000000000000000000000000030";
const feed = "0x0000000000000000000000000000000000000040";

const oracle: OraclePort = {
  async getPrice(input) {
    return {
      chainId: input.chainId,
      priceUsd: 1,
      oracleSource: "chainlink",
      oracleUpdatedAt: "2026-07-29T00:00:00.000Z",
      oracleAddress: feed,
      oraclePaused: false,
      sequencerOk: true,
    };
  },
};

const v2Pools: DexPoolCatalog = {
  pools: () => [
    {
      venue: "univ2",
      pool,
      tokenDecimals: 18,
      quoteAsset: {
        symbol: "USDG",
        address: quote,
        decimals: 6,
        usdFeed: {
          address: feed,
          decimals: 8,
          heartbeatSeconds: 30,
        },
      },
    },
  ],
};

const v2Reader: UniswapV2Reader = {
  async readPool() {
    return {
      token0: token,
      token1: quote,
      reserve0: 1_000n * 10n ** 18n,
      reserve1: 100_000n * 10n ** 6n,
    };
  },
};

const v3Pools: DexPoolCatalog = {
  pools: () => [
    {
      venue: "univ3",
      pool,
      feeTier: 500,
      tokenDecimals: 18,
      quoteAsset: {
        symbol: "USDG",
        address: quote,
        decimals: 6,
        usdFeed: {
          address: feed,
          decimals: 8,
          heartbeatSeconds: 30,
        },
      },
    },
  ],
};

const v3Reader: UniswapV3Reader = {
  async readPool() {
    return {
      token0: token,
      token1: quote,
      sqrtPriceX96: 2n ** 96n / 100_000n,
      liquidity: 1_000_000n * 10n ** 12n,
    };
  },
  async quoteExactInputSingle(input) {
    // Deterministic fake at 100 USD/token in either direction.
    return input.tokenIn.toLowerCase() === quote.toLowerCase()
      ? (input.amountIn * 10n ** 12n) / 100n
      : (input.amountIn * 100n) / 10n ** 12n;
  },
};

describe("Uniswap adapters", () => {
  test("quotes and measures v2 reserves behind the DEX port", async () => {
    const adapter = new UniswapV2Adapter({
      pools: v2Pools,
      reader: v2Reader,
      oracle,
      spreadClipUsd: 100,
      now: fixedClock("2026-07-29T00:00:00.000Z"),
    });
    const quotes = await adapter.quote({
      chainId: 1,
      tokenAddress: token,
      side: "buy",
      amountUsd: 100,
      referencePriceUsd: 100,
    });
    expect(quotes[0]?.pool).toBe(pool);
    expect(quotes[0]?.effectivePriceUsd).toBeGreaterThan(100);

    const liquidity = await adapter.liquidity({
      chainId: 1,
      tokenAddress: token,
      depthPct: 1,
    });
    expect(liquidity[0]?.tvlQuote).toBeCloseTo(100_000);
    expect(liquidity[0]?.spreadBps).toBeGreaterThan(0);
  });

  test("uses QuoterV2 results and v3 virtual-reserve depth", async () => {
    const adapter = new UniswapV3Adapter({
      pools: v3Pools,
      reader: v3Reader,
      oracle,
      quoterByChain: new Map([[1, "0x0000000000000000000000000000000000000050"]]),
      spreadClipUsd: 100,
      now: fixedClock("2026-07-29T00:00:00.000Z"),
    });
    const quotes = await adapter.quote({
      chainId: 1,
      tokenAddress: token,
      side: "buy",
      amountUsd: 100,
      referencePriceUsd: 100,
    });
    expect(quotes[0]?.effectivePriceUsd).toBeCloseTo(100);

    const liquidity = await adapter.liquidity({
      chainId: 1,
      tokenAddress: token,
      depthPct: 2,
    });
    expect(liquidity[0]?.feeTier).toBe(500);
    expect(liquidity[0]?.buyDepthUsd).toBeGreaterThan(0);
  });

  test("uses registry-provided token decimals across v2 and v3", async () => {
    const eightDecimalV2Pools: DexPoolCatalog = {
      pools: () => [
        {
          venue: "univ2",
          pool,
          tokenDecimals: 8,
          quoteAsset: v2Pools.pools(1, token, "univ2")[0]!.quoteAsset,
        },
      ],
    };
    const eightDecimalV2Reader: UniswapV2Reader = {
      async readPool() {
        return {
          token0: token,
          token1: quote,
          reserve0: 1_000n * 10n ** 8n,
          reserve1: 100_000n * 10n ** 6n,
        };
      },
    };
    const v2 = new UniswapV2Adapter({
      pools: eightDecimalV2Pools,
      reader: eightDecimalV2Reader,
      oracle,
      spreadClipUsd: 100,
      now: fixedClock("2026-07-29T00:00:00.000Z"),
    });
    const v2Liquidity = await v2.liquidity({
      chainId: 1,
      tokenAddress: token,
      depthPct: 1,
    });
    expect(v2Liquidity[0]?.tvlToken).toBeCloseTo(1_000);
    expect(v2Liquidity[0]?.tvlQuote).toBeCloseTo(100_000);

    const observedInputs: bigint[] = [];
    const eightDecimalV3Reader: UniswapV3Reader = {
      async readPool() {
        return {
          token0: token,
          token1: quote,
          sqrtPriceX96: 2n ** 96n,
          liquidity: 1n,
        };
      },
      async quoteExactInputSingle(input) {
        observedInputs.push(input.amountIn);
        return input.tokenIn.toLowerCase() === quote.toLowerCase()
          ? 1n * 10n ** 8n
          : 100n * 10n ** 6n;
      },
    };
    const eightDecimalV3Pools: DexPoolCatalog = {
      pools: () => [
        {
          venue: "univ3",
          pool,
          feeTier: 500,
          tokenDecimals: 8,
          quoteAsset: v3Pools.pools(1, token, "univ3")[0]!.quoteAsset,
        },
      ],
    };
    const v3 = new UniswapV3Adapter({
      pools: eightDecimalV3Pools,
      reader: eightDecimalV3Reader,
      oracle,
      quoterByChain: new Map([[1, "0x0000000000000000000000000000000000000050"]]),
      spreadClipUsd: 100,
      now: fixedClock("2026-07-29T00:00:00.000Z"),
    });
    const [buy] = await v3.quote({
      chainId: 1,
      tokenAddress: token,
      side: "buy",
      amountUsd: 100,
      referencePriceUsd: 100,
    });
    const [sell] = await v3.quote({
      chainId: 1,
      tokenAddress: token,
      side: "sell",
      amountUsd: 100,
      referencePriceUsd: 100,
    });
    expect(observedInputs).toEqual([100n * 10n ** 6n, 1n * 10n ** 8n]);
    expect(buy?.effectivePriceUsd).toBeCloseTo(100);
    expect(sell?.effectivePriceUsd).toBeCloseTo(100);
  });
});
