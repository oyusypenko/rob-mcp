import { describe, expect, test } from "bun:test";
import type { DiscoveredPoolIdentity } from "../src/core/pool-discovery";
import type { ChainConfig } from "../src/registry/chains";
import { discoverVerifiedVenues, type PoolDiscoveryReader } from "../scripts/seed-tokens";

const token = "0x0000000000000000000000000000000000000010";
const quote = "0x0000000000000000000000000000000000000020";
const v2Factory = "0x00000000000000000000000000000000000000a2";
const v3Factory = "0x00000000000000000000000000000000000000a3";
const v2Pool = "0x00000000000000000000000000000000000000b2";
const v3Pool = "0x00000000000000000000000000000000000000b3";
const zero = "0x0000000000000000000000000000000000000000";

const chain = {
  id: 1,
  name: "Test",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  explorer: { name: "Explorer", url: "https://explorer.example" },
  venues: {
    univ2: { factory: v2Factory },
    univ3: {
      factory: v3Factory,
      quoter: "0x0000000000000000000000000000000000000030",
      router: "0x0000000000000000000000000000000000000040",
      feeTiers: [3000, 500],
    },
  },
  quoteAssets: [
    {
      symbol: "USD",
      address: quote,
      decimals: 6,
      usdFeed: {
        address: "0x0000000000000000000000000000000000000050",
        decimals: 8,
        heartbeatSeconds: 60,
      },
    },
  ],
  oracle: {
    kind: "chainlink-aggregator-v3",
    requiresSequencerUptime: false,
    sequencerUptimeFeed: null,
  },
  issuerProfile: {
    id: "test",
    tokenStandard: "erc20",
    multiplier: { kind: "none", feedIncludesMultiplier: true },
    mintRedeem: { zeroAddress: true, participantAddresses: [] },
  },
} satisfies ChainConfig;

class ScriptedPoolReader implements PoolDiscoveryReader {
  constructor(private readonly foreignFactory = false) {}

  async getV2Pair(): Promise<string> {
    return v2Pool;
  }

  async getV3Pool(input: { feeTier: number }): Promise<string> {
    return input.feeTier === 500 ? v3Pool : zero;
  }

  async inspectV2Pool(): Promise<DiscoveredPoolIdentity> {
    return {
      pool: v2Pool,
      bytecode: "0x6000",
      factory: v2Factory,
      token0: token,
      token1: quote,
    };
  }

  async inspectV3Pool(): Promise<DiscoveredPoolIdentity> {
    return {
      pool: v3Pool,
      bytecode: "0x6000",
      factory: this.foreignFactory ? v2Factory : v3Factory,
      token0: token,
      token1: quote,
      feeTier: 500,
    };
  }
}

describe("seed venue discovery", () => {
  test("snapshots only nonzero verified pools in deterministic order", async () => {
    const venues = await discoverVerifiedVenues({
      chain,
      token,
      reader: new ScriptedPoolReader(),
    });
    expect(venues).toEqual([
      { venue: "univ2", pool: v2Pool, quoteToken: quote },
      { venue: "univ3", pool: v3Pool, feeTier: 500, quoteToken: quote },
    ]);
  });

  test("fails closed when a factory-returned pool cannot be verified", async () => {
    await expect(
      discoverVerifiedVenues({
        chain,
        token,
        reader: new ScriptedPoolReader(true),
      }),
    ).rejects.toThrow("different factory");
  });
});
