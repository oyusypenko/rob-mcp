import { describe, expect, test } from "bun:test";
import {
  assertSequencerUsable,
  calculatePremium,
  OracleSafetyError,
  validateOracleRound,
} from "../../src/core/oracle";
import { fixedClock } from "../fakes";

const now = fixedClock("2026-07-29T12:00:00.000Z");

describe("oracle core", () => {
  test("normalizes a fresh positive aggregator round with provenance", () => {
    expect(
      validateOracleRound({
        chainId: 4663,
        feedAddress: "0x0000000000000000000000000000000000000001",
        decimals: 8,
        answer: 12_345_000_000n,
        updatedAt: 1_785_326_390n,
        maxAgeSeconds: 30,
        now,
      }),
    ).toEqual({
      chainId: 4663,
      priceUsd: "123.45",
      oracleSource: "chainlink",
      oracleAddress: "0x0000000000000000000000000000000000000001",
      oracleUpdatedAt: "2026-07-29T11:59:50.000Z",
    });
  });

  test("rejects invalid and stale rounds", () => {
    expect(() =>
      validateOracleRound({
        chainId: 1,
        feedAddress: "0x0000000000000000000000000000000000000001",
        decimals: 8,
        answer: 0n,
        updatedAt: 1_785_326_390n,
        maxAgeSeconds: 30,
        now,
      }),
    ).toThrow("positive");
    expect(() =>
      validateOracleRound({
        chainId: 1,
        feedAddress: "0x0000000000000000000000000000000000000001",
        decimals: 8,
        answer: 1n,
        updatedAt: 1_785_326_300n,
        maxAgeSeconds: 30,
        now,
      }),
    ).toThrow("stale");
  });

  test("fails closed when a required L2 sequencer feed is absent", () => {
    try {
      assertSequencerUsable({
        required: true,
        round: undefined,
        gracePeriodSeconds: 60,
        now,
      });
      throw new Error("expected sequencer check to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(OracleSafetyError);
      expect((error as OracleSafetyError).code).toBe("SEQUENCER_STATUS_UNAVAILABLE");
    }
  });

  test("rejects sequencer downtime and the post-recovery grace period", () => {
    expect(() =>
      assertSequencerUsable({
        required: true,
        round: { answer: 1n, startedAt: 1_785_326_000n },
        gracePeriodSeconds: 60,
        now,
      }),
    ).toThrow("down");
    expect(() =>
      assertSequencerUsable({
        required: true,
        round: { answer: 0n, startedAt: 1_785_326_370n },
        gracePeriodSeconds: 60,
        now,
      }),
    ).toThrow("grace period");
  });

  test("computes premium without an issuer-specific multiplier", () => {
    expect(calculatePremium("102.5", "100")).toEqual({
      dexPriceUsd: 102.5,
      oraclePriceUsd: 100,
      premiumPct: 2.5,
    });
  });
});
