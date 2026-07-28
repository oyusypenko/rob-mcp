import {
  evaluateTradePolicy,
  isTradeCandidate,
  type TradeCandidate,
  type TradePolicy,
  type TradePolicyContext,
} from "./policy.js";

export interface UpstreamDryRunResult {
  readonly accepted: boolean;
  readonly upstreamPreparedOrderId?: string;
  readonly confirmedIntent?: TradeCandidate;
  readonly reason?: string;
}

export interface UpstreamDryRunPort {
  dryRun(intent: TradeCandidate): Promise<UpstreamDryRunResult>;
}

export interface PreparedOrderRecord {
  readonly id: string;
  readonly intent: TradeCandidate;
  readonly upstreamPreparedOrderId: string;
  readonly preparedAtMs: number;
  readonly expiresAtMs: number;
}

export interface ExecutionReservation {
  readonly preparedOrderId: string;
  readonly reservationId: string;
  readonly reservedAtMs: number;
}

export type ReserveExecutionResult =
  | { readonly ok: true; readonly reservation: ExecutionReservation }
  | {
      readonly ok: false;
      readonly reason:
        | "prepared-order-required"
        | "prepared-order-expired"
        | "prepared-order-already-reserved"
        | "prepared-order-already-executed";
    };

export type ReconciliationOutcome =
  | { readonly status: "executed"; readonly upstreamExecutionId: string }
  | { readonly status: "not-executed" }
  | { readonly status: "unknown" };

export interface PreparedOrderLedger {
  add(record: PreparedOrderRecord): boolean;
  reserveForExecution(preparedOrderId: string, nowMs: number): ReserveExecutionResult;
  completeExecution(
    reservation: ExecutionReservation,
    upstreamExecutionId: string,
    nowMs: number,
  ): boolean;
  reconcile(
    reservation: ExecutionReservation,
    outcome: ReconciliationOutcome,
    nowMs: number,
  ): boolean;
  purgeExpired(nowMs: number): number;
}

type LedgerEntry =
  | { readonly state: "prepared"; readonly record: PreparedOrderRecord }
  | {
      readonly state: "reserved";
      readonly record: PreparedOrderRecord;
      readonly reservation: ExecutionReservation;
    }
  | {
      readonly state: "executed";
      readonly record: PreparedOrderRecord;
      readonly upstreamExecutionId: string;
      readonly executedAtMs: number;
    };

function sameIntent(left: TradeCandidate, right: TradeCandidate): boolean {
  if (!isTradeCandidate(left) || !isTradeCandidate(right)) return false;
  return (
    left.ticker.toUpperCase() === right.ticker.toUpperCase() &&
    left.side === right.side &&
    left.amountUsdMicros === right.amountUsdMicros
  );
}

function immutableRecord(record: PreparedOrderRecord): PreparedOrderRecord {
  return Object.freeze({
    ...record,
    intent: Object.freeze({ ...record.intent }),
  });
}

export class InMemoryPreparedOrderLedger implements PreparedOrderLedger {
  readonly #entries = new Map<string, LedgerEntry>();
  #reservationSequence = 0;

  add(record: PreparedOrderRecord): boolean {
    if (
      this.#entries.has(record.id) ||
      typeof record.id !== "string" ||
      record.id.length === 0 ||
      typeof record.upstreamPreparedOrderId !== "string" ||
      record.upstreamPreparedOrderId.length === 0 ||
      !isTradeCandidate(record.intent) ||
      record.intent.amountUsdMicros <= 0n ||
      !Number.isSafeInteger(record.preparedAtMs) ||
      !Number.isSafeInteger(record.expiresAtMs) ||
      record.preparedAtMs < 0 ||
      record.expiresAtMs <= record.preparedAtMs
    ) {
      return false;
    }
    this.#entries.set(record.id, {
      state: "prepared",
      record: immutableRecord(record),
    });
    return true;
  }

  reserveForExecution(preparedOrderId: string, nowMs: number): ReserveExecutionResult {
    const entry = this.#entries.get(preparedOrderId);
    if (!entry) return { ok: false, reason: "prepared-order-required" };
    if (entry.state === "executed") {
      return { ok: false, reason: "prepared-order-already-executed" };
    }
    if (entry.state === "reserved") {
      return { ok: false, reason: "prepared-order-already-reserved" };
    }
    if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs >= entry.record.expiresAtMs) {
      this.#entries.delete(preparedOrderId);
      return { ok: false, reason: "prepared-order-expired" };
    }

    this.#reservationSequence += 1;
    const reservation = Object.freeze({
      preparedOrderId,
      reservationId: `${preparedOrderId}:${this.#reservationSequence}`,
      reservedAtMs: nowMs,
    });
    this.#entries.set(preparedOrderId, {
      state: "reserved",
      record: entry.record,
      reservation,
    });
    return { ok: true, reservation };
  }

  completeExecution(
    reservation: ExecutionReservation,
    upstreamExecutionId: string,
    nowMs: number,
  ): boolean {
    const entry = this.#matchingReservation(reservation);
    if (
      !entry ||
      typeof upstreamExecutionId !== "string" ||
      upstreamExecutionId.length === 0 ||
      !Number.isSafeInteger(nowMs) ||
      nowMs < 0
    ) {
      return false;
    }
    this.#entries.set(reservation.preparedOrderId, {
      state: "executed",
      record: entry.record,
      upstreamExecutionId,
      executedAtMs: nowMs,
    });
    return true;
  }

  reconcile(
    reservation: ExecutionReservation,
    outcome: ReconciliationOutcome,
    nowMs: number,
  ): boolean {
    const entry = this.#matchingReservation(reservation);
    if (!entry || !Number.isSafeInteger(nowMs) || nowMs < 0) return false;
    if (outcome.status === "unknown") return true;
    if (outcome.status === "executed") {
      return this.completeExecution(reservation, outcome.upstreamExecutionId, nowMs);
    }
    if (nowMs >= entry.record.expiresAtMs) {
      this.#entries.delete(reservation.preparedOrderId);
    } else {
      this.#entries.set(reservation.preparedOrderId, {
        state: "prepared",
        record: entry.record,
      });
    }
    return true;
  }

  purgeExpired(nowMs: number): number {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return 0;
    let purged = 0;
    for (const [id, entry] of this.#entries) {
      if (entry.state === "prepared" && nowMs >= entry.record.expiresAtMs) {
        this.#entries.delete(id);
        purged += 1;
      }
    }
    return purged;
  }

  #matchingReservation(
    reservation: ExecutionReservation,
  ): Extract<LedgerEntry, { state: "reserved" }> | null {
    const entry = this.#entries.get(reservation.preparedOrderId);
    if (
      entry?.state !== "reserved" ||
      entry.reservation.reservationId !== reservation.reservationId
    ) {
      return null;
    }
    return entry;
  }
}

export type PrepareTradeResult =
  | { readonly ok: true; readonly preparedOrder: PreparedOrderRecord }
  | {
      readonly ok: false;
      readonly reason:
        | "policy-refused"
        | "upstream-dry-run-refused"
        | "upstream-dry-run-mismatch"
        | "invalid-preparation-window"
        | "prepared-order-conflict";
    };

export async function prepareTrade(options: {
  policy: TradePolicy;
  intent: TradeCandidate;
  context: TradePolicyContext;
  dryRun: UpstreamDryRunPort;
  ledger: PreparedOrderLedger;
  nowMs: number;
  expiresInMs: number;
  idFactory(): string;
}): Promise<PrepareTradeResult> {
  if (!evaluateTradePolicy(options.policy, options.intent, options.context).allowed) {
    return { ok: false, reason: "policy-refused" };
  }
  if (
    !Number.isSafeInteger(options.nowMs) ||
    options.nowMs < 0 ||
    !Number.isSafeInteger(options.expiresInMs) ||
    options.expiresInMs <= 0
  ) {
    return { ok: false, reason: "invalid-preparation-window" };
  }
  const expiresAtMs = options.nowMs + options.expiresInMs;
  if (!Number.isSafeInteger(expiresAtMs)) {
    return { ok: false, reason: "invalid-preparation-window" };
  }

  const dryRun = await options.dryRun.dryRun(Object.freeze({ ...options.intent }));
  if (!dryRun.accepted || !dryRun.upstreamPreparedOrderId || !dryRun.confirmedIntent) {
    return { ok: false, reason: "upstream-dry-run-refused" };
  }
  if (!sameIntent(options.intent, dryRun.confirmedIntent)) {
    return { ok: false, reason: "upstream-dry-run-mismatch" };
  }

  const record = immutableRecord({
    id: options.idFactory(),
    intent: options.intent,
    upstreamPreparedOrderId: dryRun.upstreamPreparedOrderId,
    preparedAtMs: options.nowMs,
    expiresAtMs,
  });
  if (!options.ledger.add(record)) {
    return { ok: false, reason: "prepared-order-conflict" };
  }
  return { ok: true, preparedOrder: record };
}
