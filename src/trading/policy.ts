export type TradeSide = "buy" | "sell";

/** Exact millionths of one USD, matching USDC's six decimal places. */
export type UsdMicros = bigint;
/** Exact basis points (1/100 of one percent). */
export type BasisPoints = bigint;

export interface TradePolicy {
  readonly allowedTickers: ReadonlySet<string>;
  readonly maxOrderUsdMicros: UsdMicros;
  readonly maxDailyUsdMicros: UsdMicros;
  readonly maxPremiumDeviationBps: BasisPoints;
  readonly marketHoursOnly: boolean;
}

export interface TradeCandidate {
  readonly ticker: string;
  readonly side: TradeSide;
  readonly amountUsdMicros: UsdMicros;
}

export interface TradePolicyContext {
  readonly dailyExecutedUsdMicros: UsdMicros;
  readonly marketOpen: boolean;
  readonly premiumDeviationBps: BasisPoints | null;
}

export type TradePolicyFailure =
  | "invalid-policy"
  | "invalid-order"
  | "invalid-amount"
  | "invalid-daily-total"
  | "invalid-premium"
  | "ticker-not-allowed"
  | "order-cap-exceeded"
  | "daily-cap-exceeded"
  | "market-closed"
  | "premium-unavailable"
  | "premium-bound-exceeded";

export type TradePolicyDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: TradePolicyFailure };

function isNonNegativeBigint(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n;
}

export function isTradeCandidate(value: unknown): value is TradeCandidate {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TradeCandidate>;
  return (
    typeof candidate.ticker === "string" &&
    candidate.ticker.trim().length > 0 &&
    (candidate.side === "buy" || candidate.side === "sell") &&
    typeof candidate.amountUsdMicros === "bigint"
  );
}

export function evaluateTradePolicy(
  policy: TradePolicy,
  candidate: TradeCandidate,
  context: TradePolicyContext,
): TradePolicyDecision {
  if (
    typeof policy.allowedTickers?.has !== "function" ||
    typeof policy.marketHoursOnly !== "boolean" ||
    typeof policy.maxOrderUsdMicros !== "bigint" ||
    policy.maxOrderUsdMicros <= 0n ||
    typeof policy.maxDailyUsdMicros !== "bigint" ||
    policy.maxDailyUsdMicros <= 0n ||
    !isNonNegativeBigint(policy.maxPremiumDeviationBps)
  ) {
    return { allowed: false, reason: "invalid-policy" };
  }

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof candidate.ticker !== "string" ||
    candidate.ticker.trim().length === 0 ||
    (candidate.side !== "buy" && candidate.side !== "sell")
  ) {
    return { allowed: false, reason: "invalid-order" };
  }
  if (typeof candidate.amountUsdMicros !== "bigint" || candidate.amountUsdMicros <= 0n) {
    return { allowed: false, reason: "invalid-amount" };
  }
  if (!isNonNegativeBigint(context.dailyExecutedUsdMicros)) {
    return { allowed: false, reason: "invalid-daily-total" };
  }
  if (context.premiumDeviationBps !== null && typeof context.premiumDeviationBps !== "bigint") {
    return { allowed: false, reason: "invalid-premium" };
  }
  if (typeof context.marketOpen !== "boolean") {
    return { allowed: false, reason: "market-closed" };
  }

  if (!policy.allowedTickers.has(candidate.ticker.toUpperCase())) {
    return { allowed: false, reason: "ticker-not-allowed" };
  }
  if (candidate.amountUsdMicros > policy.maxOrderUsdMicros) {
    return { allowed: false, reason: "order-cap-exceeded" };
  }
  if (context.dailyExecutedUsdMicros + candidate.amountUsdMicros > policy.maxDailyUsdMicros) {
    return { allowed: false, reason: "daily-cap-exceeded" };
  }
  if (policy.marketHoursOnly && !context.marketOpen) {
    return { allowed: false, reason: "market-closed" };
  }
  if (context.premiumDeviationBps === null) {
    return { allowed: false, reason: "premium-unavailable" };
  }
  const absolutePremium =
    context.premiumDeviationBps < 0n ? -context.premiumDeviationBps : context.premiumDeviationBps;
  if (absolutePremium > policy.maxPremiumDeviationBps) {
    return { allowed: false, reason: "premium-bound-exceeded" };
  }

  return { allowed: true };
}
