import { getAddress, type PublicClient } from "viem";
import { uniswapV2PairAbi } from "../chain/abi";
import { calculateV2PoolMetrics, priceImpactBps } from "../core/liquidity";
import type { DexLiquidity, DexPort, DexQuote, OraclePort, OraclePrice } from "../core/ports";
import type { DexPoolCatalog, DexPoolConfig } from "./dex-pools";

export interface UniswapV2Reader {
  readPool(
    chainId: number,
    pool: string,
  ): Promise<{
    readonly token0: string;
    readonly token1: string;
    readonly reserve0: bigint;
    readonly reserve1: bigint;
  }>;
}

export class ViemUniswapV2Reader implements UniswapV2Reader {
  constructor(private readonly clients: ReadonlyMap<number, PublicClient>) {}

  async readPool(chainId: number, pool: string) {
    const client = this.client(chainId);
    const address = getAddress(pool);
    const [token0, token1, reserves] = await Promise.all([
      client.readContract({
        address,
        abi: uniswapV2PairAbi,
        functionName: "token0",
      }),
      client.readContract({
        address,
        abi: uniswapV2PairAbi,
        functionName: "token1",
      }),
      client.readContract({
        address,
        abi: uniswapV2PairAbi,
        functionName: "getReserves",
      }),
    ]);
    return {
      token0,
      token1,
      reserve0: reserves[0],
      reserve1: reserves[1],
    };
  }

  private client(chainId: number): PublicClient {
    const client = this.clients.get(chainId);
    if (!client) {
      throw new Error(`no Uniswap v2 client for chain ${chainId}`);
    }
    return client;
  }
}

export class UniswapV2Adapter implements DexPort {
  readonly venue = "univ2" as const;
  private readonly now: () => Date;

  constructor(
    private readonly input: {
      readonly pools: DexPoolCatalog;
      readonly reader: UniswapV2Reader;
      readonly oracle: OraclePort;
      readonly spreadClipUsd: number;
      readonly now?: () => Date;
    },
  ) {
    if (!Number.isFinite(input.spreadClipUsd) || input.spreadClipUsd <= 0) {
      throw new Error("v2 spread clip must be positive");
    }
    this.now = input.now ?? (() => new Date());
  }

  async quote(input: {
    chainId: number;
    tokenAddress: string;
    side: "buy" | "sell";
    amountUsd: number;
    referencePriceUsd: number;
  }): Promise<DexQuote[]> {
    return Promise.all(
      this.input.pools
        .pools(input.chainId, input.tokenAddress, this.venue)
        .map((pool) => this.quotePool(input, pool, this.now().toISOString())),
    );
  }

  async liquidity(input: {
    chainId: number;
    tokenAddress: string;
    depthPct: 1 | 2 | 5;
  }): Promise<DexLiquidity[]> {
    return Promise.all(
      this.input.pools.pools(input.chainId, input.tokenAddress, this.venue).map(async (rawPool) => {
        const pool = rawPool;
        const quotePrice = await this.quoteAssetPrice(input.chainId, pool);
        const state = await this.input.reader.readPool(input.chainId, pool.pool);
        const tokenIsToken0 = state.token0.toLowerCase() === input.tokenAddress.toLowerCase();
        assertPair(state, input.tokenAddress, pool.quoteAsset.address);
        const rawMetrics = calculateV2PoolMetrics({
          reserveToken: tokenIsToken0 ? state.reserve0 : state.reserve1,
          reserveQuote: tokenIsToken0 ? state.reserve1 : state.reserve0,
          tokenDecimals: 18,
          quoteDecimals: pool.quoteAsset.decimals,
          depthPct: input.depthPct,
        });
        const metrics = {
          spotPriceUsd: rawMetrics.spotPriceUsd * quotePrice.priceUsd,
          tvlToken: rawMetrics.tvlToken,
          tvlQuote: rawMetrics.tvlQuote * quotePrice.priceUsd,
          buyDepthUsd: rawMetrics.buyDepthUsd * quotePrice.priceUsd,
          sellDepthUsd: rawMetrics.sellDepthUsd * quotePrice.priceUsd,
        };
        const observedAt = this.now().toISOString();
        const [buy, sell] = await Promise.all([
          this.quotePool(
            {
              ...input,
              side: "buy",
              amountUsd: this.input.spreadClipUsd,
              referencePriceUsd: metrics.spotPriceUsd,
            },
            pool,
            observedAt,
            state,
            quotePrice,
          ),
          this.quotePool(
            {
              ...input,
              side: "sell",
              amountUsd: this.input.spreadClipUsd,
              referencePriceUsd: metrics.spotPriceUsd,
            },
            pool,
            observedAt,
            state,
            quotePrice,
          ),
        ]);
        return {
          chainId: input.chainId,
          venue: this.venue,
          pool: pool.pool,
          ...metrics,
          spreadBps: (buy.effectivePriceUsd / sell.effectivePriceUsd - 1) * 10_000,
          observedAt,
          quoteToken: pool.quoteAsset.address,
          ...oracleProvenance(quotePrice),
        };
      }),
    );
  }

  private async quotePool(
    input: {
      chainId: number;
      tokenAddress: string;
      side: "buy" | "sell";
      amountUsd: number;
      referencePriceUsd: number;
    },
    pool: DexPoolConfig,
    observedAt: string,
    existingState?: Awaited<ReturnType<UniswapV2Reader["readPool"]>>,
    existingQuotePrice?: OraclePrice,
  ): Promise<DexQuote> {
    const state = existingState ?? (await this.input.reader.readPool(input.chainId, pool.pool));
    const quotePrice = existingQuotePrice ?? (await this.quoteAssetPrice(input.chainId, pool));
    assertPair(state, input.tokenAddress, pool.quoteAsset.address);
    const tokenIsToken0 = state.token0.toLowerCase() === input.tokenAddress.toLowerCase();
    const reserveToken = tokenIsToken0 ? state.reserve0 : state.reserve1;
    const reserveQuote = tokenIsToken0 ? state.reserve1 : state.reserve0;
    const tokenAmount =
      input.side === "sell" ? input.amountUsd / input.referencePriceUsd : undefined;
    const amountIn =
      input.side === "buy"
        ? toUnits(input.amountUsd / quotePrice.priceUsd, pool.quoteAsset.decimals)
        : toUnits(tokenAmount!, 18);
    const reserveIn = input.side === "buy" ? reserveQuote : reserveToken;
    const reserveOut = input.side === "buy" ? reserveToken : reserveQuote;
    const amountInWithFee = amountIn * 997n;
    const amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1_000n + amountInWithFee);
    const effectivePriceUsd =
      input.side === "buy"
        ? input.amountUsd / fromUnits(amountOut, 18)
        : (fromUnits(amountOut, pool.quoteAsset.decimals) * quotePrice.priceUsd) / tokenAmount!;
    return {
      chainId: input.chainId,
      venue: this.venue,
      pool: pool.pool,
      effectivePriceUsd,
      priceImpactBps: priceImpactBps(effectivePriceUsd, input.referencePriceUsd),
      observedAt,
      quoteToken: pool.quoteAsset.address,
      ...oracleProvenance(quotePrice),
    };
  }

  private quoteAssetPrice(chainId: number, pool: DexPoolConfig): Promise<OraclePrice> {
    return this.input.oracle.getPrice({
      chainId,
      ticker: pool.quoteAsset.symbol,
      tokenAddress: pool.quoteAsset.address,
      feed: pool.quoteAsset.usdFeed.address,
      feedHeartbeatSeconds: pool.quoteAsset.usdFeed.heartbeatSeconds,
    });
  }
}

function assertPair(state: { token0: string; token1: string }, token: string, quote: string): void {
  const pair = new Set([state.token0.toLowerCase(), state.token1.toLowerCase()]);
  if (!pair.has(token.toLowerCase()) || !pair.has(quote.toLowerCase())) {
    throw new Error("configured v2 pool tokens do not match registry");
  }
}

function toUnits(value: number, decimals: number): bigint {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("quote amount must be positive");
  }
  return BigInt(Math.floor(value * 10 ** decimals));
}

function fromUnits(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}

function oracleProvenance(price: OraclePrice) {
  return {
    oracleSource: price.oracleSource,
    oracleUpdatedAt: price.oracleUpdatedAt,
    ...(price.oracleAddress ? { oracleAddress: price.oracleAddress } : {}),
    oraclePaused: false as const,
    sequencerOk: true as const,
  };
}
