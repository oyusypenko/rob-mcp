import { z, type ZodType } from "zod";
import { rankQuotes } from "../core/liquidity";
import { calculatePremium } from "../core/oracle";
import type { Deps } from "../deps";

export type ToolTier = "free" | "paid";

export class DataToolError extends Error {
  override readonly name = "DataToolError";

  constructor(
    readonly code: "NO_VERIFIED_POOL" | "SCANNER_UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

export interface ToolDefinition<
  TInputSchema extends ZodType = ZodType,
  TOutputSchema extends ZodType = ZodType,
> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: TInputSchema;
  readonly outputSchema: TOutputSchema;
  readonly tier: ToolTier;
  readonly surfaces: readonly ("hosted" | "local")[];
  readonly handler: (input: z.infer<TInputSchema>, deps: Deps) => Promise<z.infer<TOutputSchema>>;
}

type AnyToolDefinition = ToolDefinition<ZodType<any, any, any>, ZodType<any, any, any>>;

export const listStockTokensInputSchema = z.strictObject({
  search: z.string().trim().min(1).max(120).optional(),
  chain: z.number().int().positive().optional(),
});

export const listedStockTokenSchema = z.strictObject({
  chainId: z.number().int().positive(),
  ticker: z.string(),
  name: z.string(),
  address: z.string(),
  feed: z.string().optional(),
  venues: z.array(z.enum(["univ2", "univ3"])),
  updatedAt: z.iso.datetime(),
});

export const listStockTokensOutputSchema = z.strictObject({
  tokens: z.array(listedStockTokenSchema),
});

export const listStockTokensDefinition = {
  name: "list_stock_tokens",
  title: "List stock tokens",
  description: "List curated, on-chain-verified stock tokens across enabled EVM chains.",
  inputSchema: listStockTokensInputSchema,
  outputSchema: listStockTokensOutputSchema,
  tier: "free",
  surfaces: ["hosted", "local"],
  handler: async (input, deps) => ({
    tokens: deps.tokenRegistry.list(input),
  }),
} satisfies ToolDefinition<typeof listStockTokensInputSchema, typeof listStockTokensOutputSchema>;

const chainInput = {
  chain: z.number().int().positive().optional(),
} as const;

const venueSchema = z.enum(["univ2", "univ3"]);
const venueSelectorSchema = z.enum(["univ2", "univ3", "best"]);
const oracleSourceSchema = z.enum(["chainlink", "fallback"]);

const livePriceProvenanceShape = {
  chainId: z.number().int().positive(),
  oracleSource: oracleSourceSchema,
  oracleUpdatedAt: z.iso.datetime(),
  oracleAddress: z.string().optional(),
  oracleProvider: z.string().optional(),
  oraclePaused: z.literal(false),
  sequencerOk: z.literal(true),
} as const;

export const stockPremiumInputSchema = z.strictObject({
  ticker: z.string().trim().min(1).max(64),
  venue: venueSelectorSchema.optional(),
  ...chainInput,
});

export const stockPremiumOutputSchema = z.strictObject({
  ...livePriceProvenanceShape,
  ticker: z.string(),
  dexPriceUsd: z.number().positive().finite(),
  oraclePriceUsd: z.number().positive().finite(),
  premiumPct: z.number().finite(),
  venue: venueSchema,
  pool: z.string(),
  quoteOracleSource: oracleSourceSchema,
  quoteOracleUpdatedAt: z.iso.datetime(),
  quoteOracleAddress: z.string().optional(),
});

export const stockPremiumDefinition = {
  name: "stock_premium",
  title: "Stock-token premium",
  description: "Compare a verified DEX pool price with the gated reference oracle.",
  inputSchema: stockPremiumInputSchema,
  outputSchema: stockPremiumOutputSchema,
  tier: "paid",
  surfaces: ["hosted", "local"],
  handler: async (input, deps) => {
    const chainId = input.chain ?? deps.config.defaultChainId;
    const token = deps.tokenRegistry.resolve(chainId, input.ticker);
    const oracle = await deps.oracle.getPrice({
      chainId,
      ticker: token.ticker,
      tokenAddress: token.address,
      feed: token.feed,
      feedHeartbeatSeconds: token.feedHeartbeatSeconds,
    });
    const quotes = rankQuotes(
      "buy",
      await deps.dex.quote({
        chainId,
        tokenAddress: token.address,
        side: "buy",
        amountUsd: deps.config.liquidityClipUsd,
        referencePriceUsd: oracle.priceUsd,
        venue: input.venue ?? "best",
      }),
    );
    const best = requireQuote(quotes, token.ticker);
    const premium = calculatePremium(best.effectivePriceUsd.toString(), oracle.priceUsd.toString());
    return {
      chainId,
      ticker: token.ticker,
      ...premium,
      venue: best.venue,
      pool: best.pool,
      oracleSource: oracle.oracleSource,
      oracleUpdatedAt: oracle.oracleUpdatedAt,
      ...(oracle.oracleAddress ? { oracleAddress: oracle.oracleAddress } : {}),
      ...(oracle.provider ? { oracleProvider: oracle.provider } : {}),
      oraclePaused: false as const,
      sequencerOk: true as const,
      quoteOracleSource: best.oracleSource,
      quoteOracleUpdatedAt: best.oracleUpdatedAt,
      ...(best.oracleAddress ? { quoteOracleAddress: best.oracleAddress } : {}),
    };
  },
} satisfies ToolDefinition<typeof stockPremiumInputSchema, typeof stockPremiumOutputSchema>;

export const stockLiquidityInputSchema = z.strictObject({
  ticker: z.string().trim().min(1).max(64),
  depthPct: z.union([z.literal(1), z.literal(2), z.literal(5)]).optional(),
  ...chainInput,
});

export const liquidityVenueSchema = z.strictObject({
  ...livePriceProvenanceShape,
  venue: venueSchema,
  pool: z.string(),
  feeTier: z.number().int().positive().optional(),
  tvlToken: z.number().nonnegative().finite(),
  tvlQuote: z.number().nonnegative().finite(),
  buyDepthUsd: z.number().nonnegative().finite(),
  sellDepthUsd: z.number().nonnegative().finite(),
  spreadBps: z.number().nonnegative().finite(),
  quoteToken: z.string(),
  observedAt: z.iso.datetime(),
});

export const stockLiquidityOutputSchema = z.strictObject({
  chainId: z.number().int().positive(),
  ticker: z.string(),
  venues: z.array(liquidityVenueSchema),
});

export const stockLiquidityDefinition = {
  name: "stock_liquidity",
  title: "Stock-token liquidity",
  description: "Measure verified Uniswap pool depth and executable spread.",
  inputSchema: stockLiquidityInputSchema,
  outputSchema: stockLiquidityOutputSchema,
  tier: "paid",
  surfaces: ["hosted", "local"],
  handler: async (input, deps) => {
    const chainId = input.chain ?? deps.config.defaultChainId;
    const token = deps.tokenRegistry.resolve(chainId, input.ticker);
    return {
      chainId,
      ticker: token.ticker,
      venues: [
        ...(await deps.dex.liquidity({
          chainId,
          tokenAddress: token.address,
          depthPct: input.depthPct ?? 1,
        })),
      ],
    };
  },
} satisfies ToolDefinition<typeof stockLiquidityInputSchema, typeof stockLiquidityOutputSchema>;

export const stockQuoteInputSchema = z.strictObject({
  ticker: z.string().trim().min(1).max(64),
  side: z.enum(["buy", "sell"]),
  amountUsd: z.number().positive().finite(),
  venue: venueSelectorSchema.optional(),
  ...chainInput,
});

export const stockQuoteCandidateSchema = z.strictObject({
  ...livePriceProvenanceShape,
  venue: venueSchema,
  pool: z.string(),
  feeTier: z.number().int().positive().optional(),
  effectivePriceUsd: z.number().positive().finite(),
  priceImpactBps: z.number().nonnegative().finite(),
  quoteToken: z.string(),
  observedAt: z.iso.datetime(),
});

export const stockQuoteOutputSchema = z.strictObject({
  chainId: z.number().int().positive(),
  ticker: z.string(),
  side: z.enum(["buy", "sell"]),
  amountUsd: z.number().positive().finite(),
  best: stockQuoteCandidateSchema,
  all: z.array(stockQuoteCandidateSchema),
});

export const stockQuoteDefinition = {
  name: "stock_quote",
  title: "Stock-token quote",
  description: "Rank executable quotes across verified Uniswap pools.",
  inputSchema: stockQuoteInputSchema,
  outputSchema: stockQuoteOutputSchema,
  tier: "paid",
  surfaces: ["hosted", "local"],
  handler: async (input, deps) => {
    if (input.amountUsd > deps.config.maxQuoteUsd) {
      throw new Error(`amountUsd exceeds configured maximum ${deps.config.maxQuoteUsd}`);
    }
    const chainId = input.chain ?? deps.config.defaultChainId;
    const token = deps.tokenRegistry.resolve(chainId, input.ticker);
    const oracle = await deps.oracle.getPrice({
      chainId,
      ticker: token.ticker,
      tokenAddress: token.address,
      feed: token.feed,
      feedHeartbeatSeconds: token.feedHeartbeatSeconds,
    });
    const quotes = rankQuotes(
      input.side,
      await deps.dex.quote({
        chainId,
        tokenAddress: token.address,
        side: input.side,
        amountUsd: input.amountUsd,
        referencePriceUsd: oracle.priceUsd,
        venue: input.venue ?? "best",
      }),
    );
    return {
      chainId,
      ticker: token.ticker,
      side: input.side,
      amountUsd: input.amountUsd,
      best: requireQuote(quotes, token.ticker),
      all: quotes,
    };
  },
} satisfies ToolDefinition<typeof stockQuoteInputSchema, typeof stockQuoteOutputSchema>;

export const whaleActivityInputSchema = z.strictObject({
  ticker: z.string().trim().min(1).max(64).optional(),
  minUsd: z.number().nonnegative().finite().optional(),
  sinceHours: z.number().positive().finite().optional(),
  limit: z.number().int().positive().optional(),
  kind: z.enum(["transfer", "mint", "redeem", "ap-flow", "whale"]).optional(),
  ...chainInput,
});

export const whaleEventSchema = z.strictObject({
  chainId: z.number().int().positive(),
  txHash: z.string(),
  block: z.string(),
  time: z.iso.datetime(),
  token: z.string(),
  kind: z.enum(["transfer", "mint", "redeem", "ap-flow", "whale"]),
  from: z.string(),
  to: z.string(),
  amount: z.string(),
  amountUsd: z.number().nonnegative().finite(),
  oracleSource: oracleSourceSchema,
  oracleUpdatedAt: z.iso.datetime(),
  oracleAddress: z.string().optional(),
  oracleProvider: z.string().optional(),
});

export const whaleActivityOutputSchema = z.strictObject({
  chainId: z.number().int().positive(),
  events: z.array(whaleEventSchema),
  scannedThrough: z.string().nullable(),
});

export const whaleActivityDefinition = {
  name: "whale_activity",
  title: "Whale activity",
  description: "Query indexed whale, mint, redeem, and issuer-participant flows.",
  inputSchema: whaleActivityInputSchema,
  outputSchema: whaleActivityOutputSchema,
  tier: "paid",
  surfaces: ["hosted", "local"],
  handler: async (input, deps) => {
    if (!deps.whaleStore) {
      throw new DataToolError("SCANNER_UNAVAILABLE", "whale index is unavailable in this runtime");
    }
    if (input.sinceHours !== undefined && input.sinceHours > deps.config.maxWhaleSinceHours) {
      throw new Error(`sinceHours exceeds configured maximum ${deps.config.maxWhaleSinceHours}`);
    }
    if (input.limit !== undefined && input.limit > deps.config.maxWhaleResults) {
      throw new Error(`limit exceeds configured maximum ${deps.config.maxWhaleResults}`);
    }
    const chainId = input.chain ?? deps.config.defaultChainId;
    const token = input.ticker ? deps.tokenRegistry.resolve(chainId, input.ticker) : undefined;
    const result = await deps.whaleStore.query({
      chainId,
      ...(token ? { token: token.address } : {}),
      ...(input.minUsd === undefined ? {} : { minUsd: input.minUsd }),
      ...(input.sinceHours === undefined
        ? {}
        : {
            since: new Date(deps.now().getTime() - input.sinceHours * 60 * 60 * 1_000),
          }),
      ...(input.kind ? { kind: input.kind } : {}),
      limit: input.limit ?? deps.config.maxWhaleResults,
    });
    return {
      chainId,
      events: result.events.map(({ block, logIndex: _logIndex, ...event }) => ({
        ...event,
        block: block.toString(),
      })),
      scannedThrough: result.scannedThrough?.toString() ?? null,
    };
  },
} satisfies ToolDefinition<typeof whaleActivityInputSchema, typeof whaleActivityOutputSchema>;

export const toolDefinitions: readonly AnyToolDefinition[] = [
  listStockTokensDefinition,
  stockPremiumDefinition,
  stockLiquidityDefinition,
  stockQuoteDefinition,
  whaleActivityDefinition,
] as const;

export const toolDefinitionsByName: ReadonlyMap<string, AnyToolDefinition> = new Map(
  toolDefinitions.map((definition) => [definition.name, definition]),
);

function requireQuote<T>(quotes: readonly T[], ticker: string): T {
  const quote = quotes[0];
  if (!quote) {
    throw new DataToolError("NO_VERIFIED_POOL", `no verified pool is registered for ${ticker}`);
  }
  return quote;
}
