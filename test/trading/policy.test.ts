import { describe, expect, test } from "bun:test";

import {
  evaluateTradePolicy,
  type TradeCandidate,
  type TradePolicy,
  type TradePolicyContext,
} from "../../src/trading/policy.js";
import {
  InMemoryPreparedOrderLedger,
  prepareTrade,
  type UpstreamDryRunPort,
} from "../../src/trading/prepared-orders.js";

const policy: TradePolicy = {
  allowedTickers: new Set(["AAPL"]),
  maxOrderUsdMicros: 100_000_000n,
  maxDailyUsdMicros: 250_000_000n,
  maxPremiumDeviationBps: 200n,
  marketHoursOnly: true,
};

const candidate: TradeCandidate = {
  ticker: "aapl",
  side: "buy",
  amountUsdMicros: 100_000_000n,
};

const context: TradePolicyContext = {
  dailyExecutedUsdMicros: 100_000_000n,
  marketOpen: true,
  premiumDeviationBps: -200n,
};

describe("evaluateTradePolicy", () => {
  test("uses exact integer boundaries without floating-point rounding", () => {
    expect(evaluateTradePolicy(policy, candidate, context)).toEqual({ allowed: true });
    expect(
      evaluateTradePolicy(policy, { ...candidate, amountUsdMicros: 100_000_001n }, context),
    ).toEqual({ allowed: false, reason: "order-cap-exceeded" });
  });

  test.each([
    [{ ...candidate, amountUsdMicros: 0n }, context, policy, "invalid-amount"],
    [{ ...candidate, amountUsdMicros: -1n }, context, policy, "invalid-amount"],
    [
      { ...candidate, amountUsdMicros: Number.NaN as unknown as bigint },
      context,
      policy,
      "invalid-amount",
    ],
    [
      { ...candidate, amountUsdMicros: Number.POSITIVE_INFINITY as unknown as bigint },
      context,
      policy,
      "invalid-amount",
    ],
    [{ ...candidate, ticker: 42 as unknown as string }, context, policy, "invalid-order"],
    [
      { ...candidate, side: "hold" as unknown as TradeCandidate["side"] },
      context,
      policy,
      "invalid-order",
    ],
    [candidate, { ...context, dailyExecutedUsdMicros: -1n }, policy, "invalid-daily-total"],
    [
      candidate,
      {
        ...context,
        premiumDeviationBps: Number.NaN as unknown as bigint,
      },
      policy,
      "invalid-premium",
    ],
    [candidate, context, { ...policy, maxPremiumDeviationBps: -1n }, "invalid-policy"],
    [
      candidate,
      context,
      { ...policy, allowedTickers: null as unknown as ReadonlySet<string> },
      "invalid-policy",
    ],
    [{ ...candidate, ticker: "MSFT" }, context, policy, "ticker-not-allowed"],
    [candidate, { ...context, dailyExecutedUsdMicros: 150_000_001n }, policy, "daily-cap-exceeded"],
    [candidate, { ...context, marketOpen: false }, policy, "market-closed"],
    [candidate, { ...context, premiumDeviationBps: null }, policy, "premium-unavailable"],
    [candidate, { ...context, premiumDeviationBps: 201n }, policy, "premium-bound-exceeded"],
  ] as const)("refuses invalid or unsafe state", (order, state, configuredPolicy, reason) => {
    expect(evaluateTradePolicy(configuredPolicy, order, state)).toEqual({
      allowed: false,
      reason,
    });
  });
});

describe("prepared order lifecycle", () => {
  test("preparation performs the upstream dry run and stores an immutable record", async () => {
    const calls: TradeCandidate[] = [];
    const dryRun: UpstreamDryRunPort = {
      async dryRun(intent) {
        calls.push(intent);
        return {
          accepted: true,
          upstreamPreparedOrderId: "upstream-1",
          confirmedIntent: intent,
        };
      },
    };
    const ledger = new InMemoryPreparedOrderLedger();
    const result = await prepareTrade({
      policy,
      intent: candidate,
      context,
      dryRun,
      ledger,
      nowMs: 1_000,
      expiresInMs: 60_000,
      idFactory: () => "prepared-1",
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    if (!result.ok) throw new Error("expected preparation");
    expect(Object.isFrozen(result.preparedOrder)).toBe(true);
    expect(Object.isFrozen(result.preparedOrder.intent)).toBe(true);

    const first = ledger.reserveForExecution("prepared-1", 2_000);
    expect(first.ok).toBe(true);
    expect(ledger.reserveForExecution("prepared-1", 2_000)).toEqual({
      ok: false,
      reason: "prepared-order-already-reserved",
    });
    if (!first.ok) throw new Error("expected reservation");
    expect(ledger.completeExecution(first.reservation, "execution-1", 3_000)).toBe(true);
    expect(ledger.reserveForExecution("prepared-1", 4_000)).toEqual({
      ok: false,
      reason: "prepared-order-already-executed",
    });
  });

  test("rejects a mismatched dry run and never creates a prepared id", async () => {
    const ledger = new InMemoryPreparedOrderLedger();
    const result = await prepareTrade({
      policy,
      intent: candidate,
      context,
      dryRun: {
        async dryRun(intent) {
          return {
            accepted: true,
            upstreamPreparedOrderId: "upstream-1",
            confirmedIntent: { ...intent, amountUsdMicros: intent.amountUsdMicros + 1n },
          };
        },
      },
      ledger,
      nowMs: 1_000,
      expiresInMs: 60_000,
      idFactory: () => "prepared-1",
    });
    expect(result).toEqual({ ok: false, reason: "upstream-dry-run-mismatch" });
    expect(ledger.reserveForExecution("prepared-1", 2_000)).toEqual({
      ok: false,
      reason: "prepared-order-required",
    });
  });

  test("rejects malformed upstream confirmation without throwing", async () => {
    const ledger = new InMemoryPreparedOrderLedger();
    const result = await prepareTrade({
      policy,
      intent: candidate,
      context,
      dryRun: {
        async dryRun(intent) {
          return {
            accepted: true,
            upstreamPreparedOrderId: "upstream-1",
            confirmedIntent: {
              ...intent,
              ticker: 42 as unknown as string,
            },
          };
        },
      },
      ledger,
      nowMs: 1_000,
      expiresInMs: 60_000,
      idFactory: () => "prepared-1",
    });
    expect(result).toEqual({ ok: false, reason: "upstream-dry-run-mismatch" });
  });

  test("expires unreserved orders and requires reconciliation for reserved orders", () => {
    const ledger = new InMemoryPreparedOrderLedger();
    expect(
      ledger.add({
        id: "prepared-1",
        intent: candidate,
        upstreamPreparedOrderId: "upstream-1",
        preparedAtMs: 1_000,
        expiresAtMs: 2_000,
      }),
    ).toBe(true);
    const reservation = ledger.reserveForExecution("prepared-1", 1_500);
    if (!reservation.ok) throw new Error("expected reservation");
    expect(ledger.reconcile(reservation.reservation, { status: "unknown" }, 2_500)).toBe(true);
    expect(ledger.reserveForExecution("prepared-1", 2_500)).toEqual({
      ok: false,
      reason: "prepared-order-already-reserved",
    });
    expect(ledger.reconcile(reservation.reservation, { status: "not-executed" }, 2_500)).toBe(true);
    expect(ledger.reserveForExecution("prepared-1", 2_500)).toEqual({
      ok: false,
      reason: "prepared-order-required",
    });
  });
});
