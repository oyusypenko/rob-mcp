import { describe, expect, test } from "bun:test";

import {
  BASE_SEPOLIA,
  facilitatorConfig,
  TESTNET_FACILITATOR_URL,
  type X402Config,
} from "../../src/http/x402.js";

const baseConfig: X402Config = {
  network: BASE_SEPOLIA,
  payTo: "0x0000000000000000000000000000000000000001",
  paymentReplayMaxEntries: 10,
  paymentReplayTtlMs: 60_000,
};

describe("Base Sepolia facilitator selection", () => {
  test("uses the D-24 x402.org endpoint by default", () => {
    expect(facilitatorConfig(baseConfig)).toEqual({
      url: TESTNET_FACILITATOR_URL,
    });
    expect(TESTNET_FACILITATOR_URL).toBe("https://x402.org/facilitator");
  });

  test("honors the operator-configured facilitator override", () => {
    expect(
      facilitatorConfig({
        ...baseConfig,
        facilitatorUrl: "https://approved.example/facilitator",
      }),
    ).toEqual({
      url: "https://approved.example/facilitator",
    });
  });
});
