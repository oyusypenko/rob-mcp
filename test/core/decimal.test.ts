import { describe, expect, test } from "bun:test";
import { decimalMidpoint, decimalMultiply, decimalToNumber } from "../../src/core/decimal";

describe("decimal arithmetic", () => {
  test("computes an exact midpoint without binary floating-point drift", () => {
    expect(decimalMidpoint("213.45", "213.47")).toBe("213.46");
  });

  test("applies an 18-place issuer multiplier exactly", () => {
    expect(decimalMultiply("213.46", "0.250000000000000000")).toBe("53.365");
  });

  test("rejects invalid or non-positive market values", () => {
    expect(() => decimalMidpoint("", "1")).toThrow();
    expect(() => decimalMultiply("-1", "1")).toThrow();
    expect(() => decimalToNumber("0")).toThrow();
  });
});
