import { describe, expect, test } from "bun:test";
import { ChainRegistry, chainRegistryFileSchema } from "../src/registry/chains";
import { TokenRegistry, tokenRegistryFileSchema } from "../src/registry/tokens";

const chainFile = chainRegistryFileSchema.parse({
  version: 1,
  chains: [
    {
      id: 4663,
      name: "Test Chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      explorer: { name: "Explorer", url: "https://explorer.example" },
      venues: {
        univ2: {
          factory: "0x0000000000000000000000000000000000000001",
        },
        univ3: {
          factory: "0x0000000000000000000000000000000000000002",
          quoter: "0x0000000000000000000000000000000000000003",
          router: "0x0000000000000000000000000000000000000004",
        },
      },
      oracle: {
        kind: "chainlink-aggregator-v3",
        sequencerUptimeFeed: null,
      },
      issuerProfile: {
        id: "test-issuer",
        tokenStandard: "erc20",
        multiplier: { kind: "none", feedIncludesMultiplier: false },
        mintRedeem: {
          zeroAddress: true,
          participantAddresses: [],
        },
      },
    },
  ],
});

const tokenFile = tokenRegistryFileSchema.parse({
  version: 1,
  chainId: 4663,
  updatedAt: "2026-07-29T00:00:00.000Z",
  tokens: [
    {
      ticker: "TEST",
      name: "Test Token",
      address: "0x0000000000000000000000000000000000000010",
      decimals: 18,
      issuerProfile: "test-issuer",
      venues: [
        {
          venue: "univ3",
          pool: "0x0000000000000000000000000000000000000020",
          feeTier: 500,
        },
      ],
    },
  ],
});

describe("registries", () => {
  test("resolves chains and tokens without a chain-specific core assumption", () => {
    const chains = new ChainRegistry(chainFile);
    const tokens = new TokenRegistry(chains, [tokenFile], [4663]);

    expect(chains.get(4663).issuerProfile.id).toBe("test-issuer");
    expect(tokens.resolve(4663, "test").ticker).toBe("TEST");
    expect(tokens.resolve(4663, "0x0000000000000000000000000000000000000010").ticker).toBe("TEST");
  });

  test("lists deterministic, chain-keyed public token metadata", () => {
    const chains = new ChainRegistry(chainFile);
    const tokens = new TokenRegistry(chains, [tokenFile], [4663]);

    expect(tokens.list({ search: "token" })).toEqual([
      {
        chainId: 4663,
        ticker: "TEST",
        name: "Test Token",
        address: "0x0000000000000000000000000000000000000010",
        feed: undefined,
        venues: ["univ3"],
        updatedAt: "2026-07-29T00:00:00.000Z",
      },
    ]);
  });

  test("rejects token files whose issuer profile does not match the chain", () => {
    const chains = new ChainRegistry(chainFile);
    const invalid = {
      ...tokenFile,
      tokens: [{ ...tokenFile.tokens[0]!, issuerProfile: "other" }],
    };

    expect(() => new TokenRegistry(chains, [invalid], [4663])).toThrow("issuer profile");
  });
});
