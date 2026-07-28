import { describe, expect, test } from "bun:test";
import { classifyTransfer, type IssuerClassificationProfile } from "../../src/core/whale";

const zero = "0x0000000000000000000000000000000000000000";
const participant = "0x0000000000000000000000000000000000000001";
const userA = "0x0000000000000000000000000000000000000002";
const userB = "0x0000000000000000000000000000000000000003";

const profile: IssuerClassificationProfile = {
  mintRedeem: {
    zeroAddress: true,
    participantAddresses: [participant],
  },
};

describe("classifyTransfer", () => {
  test.each([
    [zero, userA, 1, "mint"],
    [userA, zero, 1, "redeem"],
    [participant, userA, 1, "ap-flow"],
    [userA, participant, 1, "ap-flow"],
    [userA, userB, 100, "whale"],
    [userA, userB, 99, "transfer"],
  ] as const)("classifies profile-driven transfer semantics", (from, to, amountUsd, expected) => {
    expect(
      classifyTransfer({
        from,
        to,
        amountUsd,
        whaleMinUsd: 100,
        issuerProfile: profile,
      }),
    ).toBe(expected);
  });
});
