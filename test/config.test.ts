import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

const baseEnv = {
  ENABLED_CHAINS: "4663",
  RPC_URL_4663: "https://rpc.example.test",
};

describe("loadConfig", () => {
  test("parses enabled chains in configured order and derives per-chain RPC config", () => {
    const config = loadConfig(
      {
        ...baseEnv,
        ENABLED_CHAINS: "42161,4663",
        RPC_URL_42161: "wss://arbitrum.example.test",
        RPC_URL_42161_ARCHIVE: "https://archive.example.test",
      },
      "stdio",
    );

    expect(config.enabledChains).toEqual([42161, 4663]);
    expect(config.defaultChainId).toBe(42161);
    expect(config.rpcByChain.get(42161)).toEqual({
      url: "wss://arbitrum.example.test",
      archiveUrl: "https://archive.example.test",
    });
  });

  test("fails closed when an enabled chain has no RPC URL", () => {
    expect(() =>
      loadConfig(
        {
          ENABLED_CHAINS: "4663,42161",
          RPC_URL_4663: "https://rpc.example.test",
        },
        "stdio",
      ),
    ).toThrow("RPC_URL_42161");
  });

  test("rejects duplicate and malformed enabled chain ids", () => {
    expect(() => loadConfig({ ...baseEnv, ENABLED_CHAINS: "4663,4663" }, "stdio")).toThrow(
      "duplicate",
    );
    expect(() => loadConfig({ ...baseEnv, ENABLED_CHAINS: "4663,nope" }, "stdio")).toThrow(
      "positive integer",
    );
  });

  test("requires a receive-only address in serve mode", () => {
    expect(() => loadConfig(baseEnv, "serve")).toThrow("X402_PAY_TO");

    const config = loadConfig(
      {
        ...baseEnv,
        X402_PAY_TO: "0x0000000000000000000000000000000000000001",
      },
      "serve",
    );
    expect(config.x402.payTo).toBe("0x0000000000000000000000000000000000000001");
  });

  test("parses bounded hosted abuse-control settings", () => {
    const config = loadConfig(baseEnv, "stdio");
    expect(config.trustedProxy).toBe("none");
    expect(config.maxRequestBodyBytes).toBe(65_536);
    expect(config.freeTierMaxIdentities).toBe(10_000);
    expect(config.paymentReplayMaxEntries).toBe(10_000);
    expect(config.paymentReplayTtlSeconds).toBe(86_400);
    expect(config.maxQuoteUsd).toBe(100_000);
    expect(config.maxWhaleSinceHours).toBe(168);
    expect(config.maxWhaleResults).toBe(200);
    expect(config.liquidityClipUsd).toBe(10_000);
    expect(config.robinhoodQuoteMaxAgeSeconds).toBe(30);

    expect(() => loadConfig({ ...baseEnv, MAX_REQUEST_BODY_BYTES: "1048577" }, "stdio")).toThrow();
  });

  test("retains the configured x402 facilitator override", () => {
    const config = loadConfig(
      {
        ...baseEnv,
        X402_PAY_TO: "0x0000000000000000000000000000000000000001",
        X402_FACILITATOR_URL: "https://approved.example/facilitator",
      },
      "serve",
    );

    expect(config.x402.facilitatorUrl).toBe("https://approved.example/facilitator");
  });
});
