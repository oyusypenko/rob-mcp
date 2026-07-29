import { describe, expect, test } from "bun:test";
import { ChainlinkOracleAdapter, type ChainlinkReader } from "../../src/adapters/chainlink";
import { RobinhoodFallbackOracleAdapter } from "../../src/adapters/robinhood-fallback";
import { OracleSafetyError } from "../../src/core/oracle";
import { ChainRegistry, chainRegistryFileSchema } from "../../src/registry/chains";
import { fixedClock } from "../fakes";

const feed = "0x0000000000000000000000000000000000000010";
const sequencer = "0x0000000000000000000000000000000000000020";
const token = "0x0000000000000000000000000000000000000030";
const now = fixedClock("2026-07-29T12:00:00.000Z");

function chains(sequencerUptimeFeed: string | null): ChainRegistry {
  return new ChainRegistry(
    chainRegistryFileSchema.parse({
      version: 1,
      chains: [
        {
          id: 1,
          name: "L2",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          explorer: { name: "Explorer", url: "https://explorer.example" },
          venues: {},
          oracle: {
            kind: "chainlink-aggregator-v3",
            requiresSequencerUptime: true,
            sequencerUptimeFeed,
          },
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
}

const reader: ChainlinkReader = {
  async readRound() {
    return {
      decimals: 8,
      answer: 12_345_000_000n,
      updatedAt: 1_785_326_390n,
    };
  },
  async readSequencerRound() {
    return { answer: 0n, startedAt: 1_785_326_000n };
  },
};

describe("oracle adapters", () => {
  test("returns a typed fail-closed error before pricing when L2 status is unavailable", async () => {
    const adapter = new ChainlinkOracleAdapter({
      chains: chains(null),
      reader,
      now,
    });
    try {
      await adapter.getPrice({
        chainId: 1,
        ticker: "TEST",
        tokenAddress: token,
        feed,
        feedHeartbeatSeconds: 30,
      });
      throw new Error("expected adapter to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(OracleSafetyError);
      expect((error as OracleSafetyError).code).toBe("SEQUENCER_STATUS_UNAVAILABLE");
    }
  });

  test("gates on sequencer state and validates Chainlink freshness", async () => {
    const adapter = new ChainlinkOracleAdapter({
      chains: chains(sequencer),
      reader,
      sequencerGracePeriodSeconds: 60,
      now,
    });
    const price = await adapter.getPrice({
      chainId: 1,
      ticker: "TEST",
      tokenAddress: token,
      feed,
      feedHeartbeatSeconds: 30,
    });
    expect(price).toMatchObject({
      chainId: 1,
      priceUsd: 123.45,
      oracleSource: "chainlink",
      oracleAddress: feed,
      sequencerOk: true,
    });
  });

  test("maps Chainlink provider failures to a typed source-unavailable error", async () => {
    const failingReader: ChainlinkReader = {
      ...reader,
      async readRound() {
        throw new Error("provider connection reset");
      },
    };
    const adapter = new ChainlinkOracleAdapter({
      chains: chains(sequencer),
      reader: failingReader,
      sequencerGracePeriodSeconds: 60,
      now,
    });

    await expect(
      adapter.getPrice({
        chainId: 1,
        ticker: "TEST",
        tokenAddress: token,
        feed,
        feedHeartbeatSeconds: 30,
      }),
    ).rejects.toMatchObject({
      code: "ORACLE_SOURCE_UNAVAILABLE",
      message: "Chainlink reference source is unavailable for TEST",
    });
  });

  test("fallback uses exact midpoint and issuer multiplier provenance", async () => {
    const responses = new Map<string, unknown>([
      [
        "https://api.robinhood.com/rhj/prices/TEST",
        {
          quotes: [
            {
              tokenSymbol: "TEST",
              deployments: [{ contractAddress: token, chainId: 1 }],
              bid: "213.45",
              ask: "213.47",
              currency: "USD",
              generatedAt: "2026-07-29T11:59:50.000Z",
              isTradingHalt: false,
            },
          ],
        },
      ],
      [
        "https://api.robinhood.com/rhj/assets",
        {
          assets: [
            {
              tokenSymbol: "TEST",
              currentMultiplier: "0.250000000000000000",
              deployments: [{ contractAddress: token, chainId: 1 }],
            },
          ],
        },
      ],
    ]);
    const adapter = new RobinhoodFallbackOracleAdapter({
      assertSequencerUsable: async () => true,
      maxAgeSeconds: 30,
      now,
      fetch: async (url) =>
        new Response(JSON.stringify(responses.get(String(url))), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    expect(
      await adapter.getPrice({
        chainId: 1,
        ticker: "TEST",
        tokenAddress: token,
      }),
    ).toMatchObject({
      priceUsd: 53.365,
      oracleSource: "fallback",
      provider: "robinhood-rhj",
      multiplier: "0.250000000000000000",
      oracleUpdatedAt: "2026-07-29T11:59:50.000Z",
      sequencerOk: true,
    });
  });

  test("maps Robinhood transport failures to a typed source-unavailable error", async () => {
    const adapter = new RobinhoodFallbackOracleAdapter({
      assertSequencerUsable: async () => true,
      maxAgeSeconds: 30,
      now,
      fetch: async () => new Response("unavailable", { status: 503 }),
    });

    await expect(
      adapter.getPrice({
        chainId: 1,
        ticker: "TEST",
        tokenAddress: token,
      }),
    ).rejects.toMatchObject({
      code: "ORACLE_SOURCE_UNAVAILABLE",
      message: "Robinhood reference source is unavailable for TEST",
    });
  });
});
