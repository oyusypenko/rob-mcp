import { describe, expect, test } from "bun:test";
import {
  assertDiscoveredPoolIdentity,
  type DiscoveredPoolIdentity,
} from "../../src/core/pool-discovery";

const factory = "0x00000000000000000000000000000000000000f0";
const token0 = "0x0000000000000000000000000000000000000010";
const token1 = "0x0000000000000000000000000000000000000020";

function pool(overrides: Partial<DiscoveredPoolIdentity> = {}): DiscoveredPoolIdentity {
  return {
    pool: "0x00000000000000000000000000000000000000a0",
    bytecode: "0x6000",
    factory,
    token0,
    token1,
    feeTier: 500,
    ...overrides,
  };
}

describe("discovered pool identity", () => {
  test("accepts verified bytecode, factory, canonical tokens, and fee", () => {
    expect(() =>
      assertDiscoveredPoolIdentity(pool(), {
        factory,
        tokenA: token1,
        tokenB: token0,
        feeTier: 500,
      }),
    ).not.toThrow();
  });

  test("rejects absent bytecode, a foreign factory, wrong ordering, and wrong fee", () => {
    const expected = { factory, tokenA: token0, tokenB: token1, feeTier: 500 };
    expect(() => assertDiscoveredPoolIdentity(pool({ bytecode: "0x" }), expected)).toThrow(
      "no deployed bytecode",
    );
    expect(() =>
      assertDiscoveredPoolIdentity(
        pool({ factory: "0x00000000000000000000000000000000000000f1" }),
        expected,
      ),
    ).toThrow("different factory");
    expect(() =>
      assertDiscoveredPoolIdentity(pool({ token0: token1, token1: token0 }), expected),
    ).toThrow("token ordering");
    expect(() => assertDiscoveredPoolIdentity(pool({ feeTier: 3000 }), expected)).toThrow(
      "different fee tier",
    );
  });

  test("accepts a v2 pool only when no fee tier is reported", () => {
    expect(() =>
      assertDiscoveredPoolIdentity(pool({ feeTier: undefined }), {
        factory,
        tokenA: token0,
        tokenB: token1,
      }),
    ).not.toThrow();
    expect(() =>
      assertDiscoveredPoolIdentity(pool(), {
        factory,
        tokenA: token0,
        tokenB: token1,
      }),
    ).toThrow("unexpectedly reports a fee tier");
  });
});
