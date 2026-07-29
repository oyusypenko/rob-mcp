export interface OracleRoundInput {
  readonly chainId: number;
  readonly feedAddress: string;
  readonly decimals: number;
  readonly answer: bigint;
  readonly updatedAt: bigint;
  readonly maxAgeSeconds: number;
  readonly now: () => Date;
}

export interface ValidatedOraclePrice {
  readonly chainId: number;
  readonly priceUsd: string;
  readonly oracleSource: "chainlink";
  readonly oracleAddress: string;
  readonly oracleUpdatedAt: string;
}

export interface SequencerRound {
  readonly answer: bigint;
  readonly startedAt: bigint;
}

export type OracleSafetyCode =
  | "INVALID_ORACLE_ROUND"
  | "STALE_ORACLE_ROUND"
  | "ORACLE_PAUSED"
  | "ORACLE_SOURCE_UNAVAILABLE"
  | "SEQUENCER_STATUS_UNAVAILABLE"
  | "SEQUENCER_DOWN"
  | "SEQUENCER_GRACE_PERIOD";

export class OracleSafetyError extends Error {
  override readonly name = "OracleSafetyError";

  constructor(
    readonly code: OracleSafetyCode,
    message: string,
  ) {
    super(message);
  }
}

export function validateOracleRound(input: OracleRoundInput): ValidatedOraclePrice {
  if (input.answer <= 0n) {
    throw new OracleSafetyError("INVALID_ORACLE_ROUND", "oracle answer must be positive");
  }
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 255) {
    throw new OracleSafetyError("INVALID_ORACLE_ROUND", "oracle decimals are invalid");
  }
  if (!Number.isFinite(input.maxAgeSeconds) || input.maxAgeSeconds <= 0) {
    throw new OracleSafetyError("INVALID_ORACLE_ROUND", "oracle maximum age must be positive");
  }

  const nowSeconds = BigInt(Math.floor(input.now().getTime() / 1_000));
  if (input.updatedAt <= 0n || input.updatedAt > nowSeconds) {
    throw new OracleSafetyError("INVALID_ORACLE_ROUND", "oracle timestamp is invalid");
  }
  if (nowSeconds - input.updatedAt > BigInt(input.maxAgeSeconds)) {
    throw new OracleSafetyError("STALE_ORACLE_ROUND", "oracle round is stale");
  }

  return {
    chainId: input.chainId,
    priceUsd: formatFixed(input.answer, input.decimals),
    oracleSource: "chainlink",
    oracleAddress: input.feedAddress,
    oracleUpdatedAt: new Date(Number(input.updatedAt) * 1_000).toISOString(),
  };
}

export function assertSequencerUsable(input: {
  readonly required: boolean;
  readonly round: SequencerRound | undefined;
  readonly gracePeriodSeconds: number;
  readonly now: () => Date;
}): true {
  if (!input.required) {
    return true;
  }
  if (!input.round) {
    throw new OracleSafetyError(
      "SEQUENCER_STATUS_UNAVAILABLE",
      "L2 sequencer uptime feed is required but not configured",
    );
  }
  if (input.round.answer !== 0n) {
    throw new OracleSafetyError("SEQUENCER_DOWN", "L2 sequencer is down");
  }
  if (!Number.isFinite(input.gracePeriodSeconds) || input.gracePeriodSeconds < 0) {
    throw new OracleSafetyError("INVALID_ORACLE_ROUND", "sequencer grace period is invalid");
  }

  const nowSeconds = BigInt(Math.floor(input.now().getTime() / 1_000));
  if (input.round.startedAt <= 0n || input.round.startedAt > nowSeconds) {
    throw new OracleSafetyError("INVALID_ORACLE_ROUND", "sequencer status timestamp is invalid");
  }
  if (nowSeconds - input.round.startedAt <= BigInt(input.gracePeriodSeconds)) {
    throw new OracleSafetyError(
      "SEQUENCER_GRACE_PERIOD",
      "L2 sequencer recovery grace period has not elapsed",
    );
  }
  return true;
}

export function calculatePremium(
  dexPriceUsd: string,
  oraclePriceUsd: string,
): {
  readonly dexPriceUsd: number;
  readonly oraclePriceUsd: number;
  readonly premiumPct: number;
} {
  const dex = Number(dexPriceUsd);
  const oracle = Number(oraclePriceUsd);
  if (!Number.isFinite(dex) || dex <= 0) {
    throw new Error("DEX price must be positive");
  }
  if (!Number.isFinite(oracle) || oracle <= 0) {
    throw new Error("oracle price must be positive");
  }
  return {
    dexPriceUsd: dex,
    oraclePriceUsd: oracle,
    premiumPct: ((dex - oracle) / oracle) * 100,
  };
}

function formatFixed(value: bigint, decimals: number): string {
  if (decimals === 0) {
    return value.toString();
  }
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fractional = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fractional.length > 0 ? `${whole}.${fractional}` : whole.toString();
}
