import { getAddress, type PublicClient } from "viem";
import { quoterV2Abi, uniswapV3PoolAbi } from "../chain/abi";
import { calculateV3PoolMetrics, priceImpactBps } from "../core/liquidity";
import type { DexLiquidity, DexPort, DexQuote, OraclePort, OraclePrice } from "../core/ports";
import type { DexPoolCatalog, DexPoolConfig } from "./dex-pools";

export interface UniswapV3Reader {
  readPool(
    chainId: number,
    pool: string,
  ): Promise<{
    readonly token0: string;
    readonly token1: string;
    readonly sqrtPriceX96: bigint;
    readonly liquidity: bigint;
  }>;
  quoteExactInputSingle(input: {
    readonly chainId: number;
    readonly quoter: string;
    readonly tokenIn: string;
    readonly tokenOut: string;
    readonly amountIn: bigint;
    readonly feeTier: number;
  }): Promise<bigint>;
}

export class ViemUniswapV3Reader implements UniswapV3Reader {
  constructor(
    private readonly clients: ReadonlyMap<number, PublicClient>,
    private readonly quoterByChain: ReadonlyMap<number, string>,
  ) {}

  async readPool(chainId: number, pool: string) {
    const client = this.client(chainId);
    const address = getAddress(pool);
    const [token0, token1, slot0, liquidity] = await Promise.all([
      client.readContract({
        address,
        abi: uniswapV3PoolAbi,
        functionName: "token0",
      }),
      client.readContract({
        address,
        abi: uniswapV3PoolAbi,
        functionName: "token1",
      }),
      client.readContract({
        address,
        abi: uniswapV3PoolAbi,
        functionName: "slot0",
      }),
      client.readContract({
        address,
        abi: uniswapV3PoolAbi,
        functionName: "liquidity",
      }),
    ]);
    return {
      token0,
      token1,
      sqrtPriceX96: slot0[0],
      liquidity,
    };
  }

  async quoteExactInputSingle(input: {
    chainId: number;
    quoter: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    feeTier: number;
  }): Promise<bigint> {
    const { result } = await this.client(input.chainId).simulateContract({
      address: getAddress(input.quoter),
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn: getAddress(input.tokenIn),
          tokenOut: getAddress(input.tokenOut),
          amountIn: input.amountIn,
          fee: input.feeTier,
          sqrtPriceLimitX96: 0n,
        },
      ],
      account: null,
    });
    return result[0];
  }

  quoter(chainId: number): string {
    const quoter = this.quoterByChain.get(chainId);
    if (!quoter) {
      throw new Error(`no Uniswap v3 quoter for chain ${chainId}`);
    }
    return quoter;
  }

  private client(chainId: number): PublicClient {
    const client = this.clients.get(chainId);
    if (!client) {
      throw new Error(`no Uniswap v3 client for chain ${chainId}`);
    }
    return client;
  }
}

export class UniswapV3Adapter implements DexPort {
  readonly venue = "univ3" as const;
  private readonly now: () => Date;

  constructor(
    private readonly input: {
      readonly pools: DexPoolCatalog;
      readonly reader: UniswapV3Reader;
      readonly oracle: OraclePort;
      readonly quoterByChain?: ReadonlyMap<number, string>;
      readonly spreadClipUsd: number;
      readonly now?: () => Date;
    },
  ) {
    if (!Number.isFinite(input.spreadClipUsd) || input.spreadClipUsd <= 0) {
      throw new Error("v3 spread clip must be positive");
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
    const observedAt = this.now().toISOString();
    return Promise.all(
      this.input.pools
        .pools(input.chainId, input.tokenAddress, this.venue)
        .map((pool) => this.quotePool(input, pool, observedAt)),
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
        if (pool.feeTier === undefined) {
          throw new Error(`v3 pool ${pool.pool} has no verified fee tier`);
        }
        const state = await this.input.reader.readPool(input.chainId, pool.pool);
        const quotePrice = await this.quoteAssetPrice(input.chainId, pool);
        assertPair(state, input.tokenAddress, pool.quoteAsset.address);
        const tokenIsToken0 = state.token0.toLowerCase() === input.tokenAddress.toLowerCase();
        const rawMetrics = calculateV3PoolMetrics({
          sqrtPriceX96: state.sqrtPriceX96,
          liquidity: state.liquidity,
          tokenIsToken0,
          tokenDecimals: pool.tokenDecimals,
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
            quotePrice,
          ),
        ]);
        return {
          chainId: input.chainId,
          venue: this.venue,
          pool: pool.pool,
          feeTier: pool.feeTier,
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
    existingQuotePrice?: OraclePrice,
  ): Promise<DexQuote> {
    if (pool.feeTier === undefined) {
      throw new Error(`v3 pool ${pool.pool} has no verified fee tier`);
    }
    const quotePrice = existingQuotePrice ?? (await this.quoteAssetPrice(input.chainId, pool));
    const tokenAmount =
      input.side === "sell" ? input.amountUsd / input.referencePriceUsd : undefined;
    const tokenIn = input.side === "buy" ? pool.quoteAsset.address : input.tokenAddress;
    const tokenOut = input.side === "buy" ? input.tokenAddress : pool.quoteAsset.address;
    const amountIn =
      input.side === "buy"
        ? toUnits(input.amountUsd / quotePrice.priceUsd, pool.quoteAsset.decimals)
        : toUnits(tokenAmount!, pool.tokenDecimals);
    const amountOut = await this.input.reader.quoteExactInputSingle({
      chainId: input.chainId,
      quoter: this.quoter(input.chainId),
      tokenIn,
      tokenOut,
      amountIn,
      feeTier: pool.feeTier,
    });
    const effectivePriceUsd =
      input.side === "buy"
        ? input.amountUsd / fromUnits(amountOut, pool.tokenDecimals)
        : (fromUnits(amountOut, pool.quoteAsset.decimals) * quotePrice.priceUsd) / tokenAmount!;
    return {
      chainId: input.chainId,
      venue: this.venue,
      pool: pool.pool,
      feeTier: pool.feeTier,
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

  private quoter(chainId: number): string {
    const quoter = this.input.quoterByChain?.get(chainId);
    if (!quoter) {
      throw new Error(`no Uniswap v3 quoter for chain ${chainId}`);
    }
    return quoter;
  }
}

function assertPair(state: { token0: string; token1: string }, token: string, quote: string): void {
  const pair = new Set([state.token0.toLowerCase(), state.token1.toLowerCase()]);
  if (!pair.has(token.toLowerCase()) || !pair.has(quote.toLowerCase())) {
    throw new Error("configured v3 pool tokens do not match registry");
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
