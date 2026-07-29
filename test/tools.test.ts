import { describe, expect, test } from "bun:test";
import type { Config } from "../src/config";
import type { DexRegistryPort, OraclePort } from "../src/core/ports";
import type { Deps } from "../src/deps";
import { ChainRegistry, chainRegistryFileSchema } from "../src/registry/chains";
import { TokenRegistry, tokenRegistryFileSchema } from "../src/registry/tokens";
import {
  DataToolError,
  listStockTokensDefinition,
  stockLiquidityDefinition,
  stockPremiumDefinition,
  stockQuoteDefinition,
  toolDefinitionsByName,
  whaleActivityDefinition,
} from "../src/tools/definitions";
import { InMemoryWhaleStore } from "./fakes";

const chains = new ChainRegistry(
  chainRegistryFileSchema.parse({
    version: 1,
    chains: [
      {
        id: 7,
        name: "Seven",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        explorer: { name: "Explorer", url: "https://explorer.example" },
        venues: {},
        oracle: { kind: "chainlink-aggregator-v3", sequencerUptimeFeed: null },
        issuerProfile: {
          id: "issuer",
          tokenStandard: "erc20",
          multiplier: { kind: "none", feedIncludesMultiplier: false },
          mintRedeem: { zeroAddress: true, participantAddresses: [] },
        },
      },
    ],
  }),
);
const tokens = new TokenRegistry(
  chains,
  [
    tokenRegistryFileSchema.parse({
      version: 1,
      chainId: 7,
      updatedAt: "2026-07-29T00:00:00.000Z",
      tokens: [
        {
          ticker: "AAA",
          name: "Alpha",
          address: "0x0000000000000000000000000000000000000007",
          decimals: 18,
          issuerProfile: "issuer",
          venues: [],
        },
      ],
    }),
  ],
  [7],
);

const deps = { chainRegistry: chains, tokenRegistry: tokens } as Deps;

const oracle: OraclePort = {
  async getPrice(input) {
    return {
      chainId: input.chainId,
      priceUsd: 100,
      oracleSource: "chainlink",
      oracleUpdatedAt: "2026-07-29T00:00:00.000Z",
      oracleAddress: "0x0000000000000000000000000000000000000001",
      oraclePaused: false,
      sequencerOk: true,
    };
  },
};

const dex: DexRegistryPort = {
  async quote(input) {
    return [101, 100].map((effectivePriceUsd, index) => ({
      chainId: input.chainId,
      venue: index === 0 ? ("univ2" as const) : ("univ3" as const),
      pool: `0x${(index + 2).toString().padStart(40, "0")}`,
      ...(index === 1 ? { feeTier: 500 } : {}),
      effectivePriceUsd,
      priceImpactBps: Math.abs(effectivePriceUsd - 100) * 100,
      observedAt: "2026-07-29T00:00:00.000Z",
      quoteToken: "0x0000000000000000000000000000000000000004",
      oracleSource: "chainlink" as const,
      oracleUpdatedAt: "2026-07-29T00:00:00.000Z",
      oracleAddress: "0x0000000000000000000000000000000000000005",
      oraclePaused: false as const,
      sequencerOk: true as const,
    }));
  },
  async liquidity(input) {
    return [
      {
        chainId: input.chainId,
        venue: "univ3" as const,
        pool: "0x0000000000000000000000000000000000000003",
        feeTier: 500,
        tvlToken: 10,
        tvlQuote: 1_000,
        buyDepthUsd: 20,
        sellDepthUsd: 20,
        spreadBps: 5,
        observedAt: "2026-07-29T00:00:00.000Z",
        quoteToken: "0x0000000000000000000000000000000000000004",
        oracleSource: "chainlink" as const,
        oracleUpdatedAt: "2026-07-29T00:00:00.000Z",
        oracleAddress: "0x0000000000000000000000000000000000000005",
        oraclePaused: false as const,
        sequencerOk: true as const,
      },
    ];
  },
};

function dataDeps() {
  return {
    ...deps,
    config: {
      defaultChainId: 7,
      maxQuoteUsd: 1_000,
      maxWhaleSinceHours: 168,
      maxWhaleResults: 200,
      liquidityClipUsd: 100,
    } as Config,
    oracle,
    dex,
    now: () => new Date("2026-07-29T00:00:00.000Z"),
  } as Deps;
}

describe("tool definitions", () => {
  test("keeps list_stock_tokens schema, handler, and tier together", async () => {
    expect(toolDefinitionsByName.get("list_stock_tokens")).toBe(listStockTokensDefinition);
    expect(listStockTokensDefinition.tier).toBe("free");

    const output = await listStockTokensDefinition.handler({ chain: 7 }, deps);
    expect(listStockTokensDefinition.outputSchema.parse(output).tokens[0]?.chainId).toBe(7);
  });

  test("rejects an unbounded search input at the tool boundary", () => {
    expect(() =>
      listStockTokensDefinition.inputSchema.parse({ search: "x".repeat(121) }),
    ).toThrow();
  });

  test("exposes every phase C-D tool from the canonical map", () => {
    expect([...toolDefinitionsByName.keys()]).toEqual([
      "list_stock_tokens",
      "stock_premium",
      "stock_liquidity",
      "stock_quote",
      "whale_activity",
    ]);
  });

  test("computes premium and ranks executable quotes with provenance", async () => {
    const runtime = dataDeps();
    const premium = await stockPremiumDefinition.handler({ ticker: "AAA" }, runtime);
    expect(premium.premiumPct).toBe(0);
    expect(premium.pool).toBe("0x0000000000000000000000000000000000000003");
    expect(stockPremiumDefinition.outputSchema.parse(premium)).toEqual(premium);

    const quote = await stockQuoteDefinition.handler(
      { ticker: "AAA", side: "buy", amountUsd: 100 },
      runtime,
    );
    expect(quote.best.effectivePriceUsd).toBe(100);
    expect(quote.all.map(({ effectivePriceUsd }) => effectivePriceUsd)).toEqual([100, 101]);
    expect(stockQuoteDefinition.outputSchema.parse(quote)).toEqual(quote);
  });

  test("enforces operator quote bounds and preserves empty liquidity", async () => {
    const runtime = dataDeps();
    await expect(
      stockQuoteDefinition.handler({ ticker: "AAA", side: "buy", amountUsd: 1_001 }, runtime),
    ).rejects.toMatchObject({
      code: "CONFIGURED_LIMIT_EXCEEDED",
      message: expect.stringContaining("configured maximum"),
    });

    const emptyDex: DexRegistryPort = {
      ...dex,
      async liquidity() {
        return [];
      },
    };
    const liquidity = await stockLiquidityDefinition.handler(
      { ticker: "AAA", depthPct: 5 },
      { ...runtime, dex: emptyDex },
    );
    expect(liquidity.venues).toEqual([]);
  });

  test("returns a typed error when quote and premium have no verified pool", async () => {
    const emptyDex: DexRegistryPort = {
      ...dex,
      async quote() {
        return [];
      },
    };
    await expect(
      stockPremiumDefinition.handler({ ticker: "AAA" }, { ...dataDeps(), dex: emptyDex }),
    ).rejects.toBeInstanceOf(DataToolError);
  });

  test("bounds whale queries and serializes bigint cursors", async () => {
    const store = new InMemoryWhaleStore();
    store.events.push({
      chainId: 7,
      txHash: "0x01",
      block: 123n,
      logIndex: 0,
      time: "2026-07-28T23:00:00.000Z",
      token: "0x0000000000000000000000000000000000000007",
      kind: "whale",
      from: "0x0000000000000000000000000000000000000008",
      to: "0x0000000000000000000000000000000000000009",
      amount: "1",
      amountUsd: 100,
      oracleSource: "chainlink",
      oracleUpdatedAt: "2026-07-28T23:00:00.000Z",
      oracleAddress: "0x0000000000000000000000000000000000000001",
    });
    store.cursors.set("7:0x0000000000000000000000000000000000000007", 456n);
    const runtime = { ...dataDeps(), whaleStore: store };
    const result = await whaleActivityDefinition.handler(
      { ticker: "AAA", sinceHours: 2, kind: "whale" },
      runtime,
    );
    expect(result.events[0]?.block).toBe("123");
    expect(result.scannedThrough).toBe("456");
    expect(whaleActivityDefinition.outputSchema.parse(result)).toEqual(result);

    await expect(
      whaleActivityDefinition.handler({ sinceHours: 169 }, runtime),
    ).rejects.toMatchObject({
      code: "CONFIGURED_LIMIT_EXCEEDED",
      message: expect.stringContaining("configured maximum"),
    });
  });
});
