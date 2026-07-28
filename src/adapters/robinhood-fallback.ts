import { z } from "zod";
import { decimalMidpoint, decimalMultiply, decimalToNumber } from "../core/decimal";
import { OracleSafetyError } from "../core/oracle";
import type { OraclePort, OraclePrice } from "../core/ports";

const deploymentSchema = z.looseObject({
  contractAddress: z.string(),
  chainId: z.number().int().positive(),
});

const pricesSchema = z.looseObject({
  quotes: z.array(
    z.looseObject({
      tokenSymbol: z.string(),
      deployments: z.array(deploymentSchema),
      bid: z.string(),
      ask: z.string(),
      currency: z.literal("USD"),
      generatedAt: z.iso.datetime(),
      isTradingHalt: z.boolean(),
    }),
  ),
});

const assetsSchema = z.looseObject({
  assets: z.array(
    z.looseObject({
      tokenSymbol: z.string(),
      deployments: z.array(deploymentSchema),
      currentMultiplier: z.string(),
    }),
  ),
});

export class RobinhoodFallbackOracleAdapter implements OraclePort {
  private readonly fetcher: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  private readonly now: () => Date;
  private readonly maxAgeSeconds: number;
  private readonly sequencerGate: (chainId: number) => Promise<true>;

  constructor(input: {
    readonly fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
    readonly now?: () => Date;
    readonly maxAgeSeconds: number;
    readonly assertSequencerUsable: (chainId: number) => Promise<true>;
  }) {
    this.fetcher = input.fetch ?? fetch;
    this.now = input.now ?? (() => new Date());
    this.maxAgeSeconds = input.maxAgeSeconds;
    this.sequencerGate = input.assertSequencerUsable;
  }

  async getPrice(input: {
    chainId: number;
    ticker: string;
    tokenAddress: string;
  }): Promise<OraclePrice> {
    await this.sequencerGate(input.chainId);
    const fetchedAt = this.now();
    const [prices, assets] = await Promise.all([
      this.getJson(`https://api.robinhood.com/rhj/prices/${input.ticker}`),
      this.getJson("https://api.robinhood.com/rhj/assets"),
    ]);
    const quote = pricesSchema
      .parse(prices)
      .quotes.find(
        (item) =>
          item.tokenSymbol.toUpperCase() === input.ticker.toUpperCase() &&
          hasDeployment(item.deployments, input),
      );
    const asset = assetsSchema
      .parse(assets)
      .assets.find(
        (item) =>
          item.tokenSymbol.toUpperCase() === input.ticker.toUpperCase() &&
          hasDeployment(item.deployments, input),
      );
    if (!quote || !asset) {
      throw new Error(`Robinhood fallback data is incomplete for ${input.ticker}`);
    }
    if (quote.isTradingHalt) {
      throw new OracleSafetyError("ORACLE_PAUSED", "Robinhood fallback reports a trading halt");
    }
    const generatedAt = new Date(quote.generatedAt);
    const ageSeconds = (fetchedAt.getTime() - generatedAt.getTime()) / 1_000;
    if (
      !Number.isFinite(this.maxAgeSeconds) ||
      this.maxAgeSeconds <= 0 ||
      ageSeconds < 0 ||
      ageSeconds > this.maxAgeSeconds
    ) {
      throw new OracleSafetyError("STALE_ORACLE_ROUND", "Robinhood fallback quote is stale");
    }

    const midpoint = decimalMidpoint(quote.bid, quote.ask);
    const tokenPrice = decimalMultiply(midpoint, asset.currentMultiplier);
    return {
      chainId: input.chainId,
      priceUsd: decimalToNumber(tokenPrice),
      oracleSource: "fallback",
      oracleUpdatedAt: quote.generatedAt,
      provider: "robinhood-rhj",
      multiplier: asset.currentMultiplier,
      multiplierUpdatedAt: fetchedAt.toISOString(),
      oraclePaused: false,
      sequencerOk: true,
    };
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.fetcher(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Robinhood fallback returned HTTP ${response.status}`);
    }
    return response.json();
  }
}

function hasDeployment(
  deployments: readonly { contractAddress: string; chainId: number }[],
  input: { chainId: number; tokenAddress: string },
): boolean {
  return deployments.some(
    (deployment) =>
      deployment.chainId === input.chainId &&
      deployment.contractAddress.toLowerCase() === input.tokenAddress.toLowerCase(),
  );
}
