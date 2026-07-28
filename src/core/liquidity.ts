export interface PoolMathMetrics {
  readonly spotPriceUsd: number;
  readonly tvlToken: number;
  readonly tvlQuote: number;
  readonly buyDepthUsd: number;
  readonly sellDepthUsd: number;
}

export function calculateV2PoolMetrics(input: {
  readonly reserveToken: bigint;
  readonly reserveQuote: bigint;
  readonly tokenDecimals: number;
  readonly quoteDecimals: number;
  readonly depthPct: 1 | 2 | 5;
}): PoolMathMetrics {
  const token = toDecimalAmount(input.reserveToken, input.tokenDecimals);
  const quote = toDecimalAmount(input.reserveQuote, input.quoteDecimals);
  if (token <= 0 || quote <= 0) {
    throw new Error("pool reserves must be positive");
  }
  const price = quote / token;
  const depth = input.depthPct / 100;

  return {
    spotPriceUsd: price,
    tvlToken: token,
    tvlQuote: quote,
    // Constant-product depth approximation before LP fees.
    buyDepthUsd: quote * depth,
    sellDepthUsd: token * (depth / (1 - depth)) * price,
  };
}

export function calculateV3PoolMetrics(input: {
  readonly sqrtPriceX96: bigint;
  readonly liquidity: bigint;
  readonly tokenIsToken0: boolean;
  readonly tokenDecimals: number;
  readonly quoteDecimals: number;
  readonly depthPct: 1 | 2 | 5;
}): PoolMathMetrics {
  if (input.sqrtPriceX96 <= 0n || input.liquidity <= 0n) {
    throw new Error("v3 pool price and liquidity must be positive");
  }
  const sqrtPrice = Number(input.sqrtPriceX96) / 2 ** 96;
  const liquidity = Number(input.liquidity);
  if (!Number.isFinite(sqrtPrice) || !Number.isFinite(liquidity)) {
    throw new Error("v3 pool state is outside the supported numeric range");
  }
  const amount0 = liquidity / sqrtPrice / 10 ** input.tokenDecimals;
  const amount1 = (liquidity * sqrtPrice) / 10 ** input.quoteDecimals;
  const token = input.tokenIsToken0 ? amount0 : amount1;
  const quote = input.tokenIsToken0 ? amount1 : amount0;
  if (token <= 0 || quote <= 0) {
    throw new Error("v3 virtual reserves must be positive");
  }
  const price = quote / token;
  const depth = input.depthPct / 100;
  return {
    spotPriceUsd: price,
    tvlToken: token,
    tvlQuote: quote,
    buyDepthUsd: quote * depth,
    sellDepthUsd: token * (depth / (1 - depth)) * price,
  };
}

export function priceImpactBps(effectivePriceUsd: number, referencePriceUsd: number): number {
  if (
    !Number.isFinite(effectivePriceUsd) ||
    effectivePriceUsd <= 0 ||
    !Number.isFinite(referencePriceUsd) ||
    referencePriceUsd <= 0
  ) {
    throw new Error("quote prices must be positive");
  }
  return Math.abs(effectivePriceUsd / referencePriceUsd - 1) * 10_000;
}

export function rankQuotes<
  T extends {
    readonly effectivePriceUsd: number;
  },
>(side: "buy" | "sell", candidates: readonly T[]): T[] {
  return [...candidates].sort((left, right) =>
    side === "buy"
      ? left.effectivePriceUsd - right.effectivePriceUsd
      : right.effectivePriceUsd - left.effectivePriceUsd,
  );
}

function toDecimalAmount(value: bigint, decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("token decimals are invalid");
  }
  return Number(value) / 10 ** decimals;
}
