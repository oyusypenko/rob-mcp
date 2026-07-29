import type { DexVenue } from "../core/ports";
import type { ChainRegistry } from "../registry/chains";
import type { TokenRegistry } from "../registry/tokens";

export interface DexPoolConfig {
  readonly venue: DexVenue;
  readonly pool: string;
  readonly feeTier?: number;
  readonly tokenDecimals: number;
  readonly quoteAsset: {
    readonly symbol: string;
    readonly address: string;
    readonly decimals: number;
    readonly usdFeed: {
      readonly address: string;
      readonly decimals: number;
      readonly heartbeatSeconds?: number;
    };
  };
}

export interface DexPoolCatalog {
  pools(chainId: number, tokenAddress: string, venue: DexVenue): readonly DexPoolConfig[];
}

export class RegistryDexPoolCatalog implements DexPoolCatalog {
  constructor(
    private readonly tokens: TokenRegistry,
    private readonly chains: ChainRegistry,
  ) {}

  pools(chainId: number, tokenAddress: string, venue: DexVenue): readonly DexPoolConfig[] {
    const chain = this.chains.get(chainId);
    const token = this.tokens.resolve(chainId, tokenAddress);
    return token.venues
      .filter((pool) => pool.venue === venue)
      .map((pool) => {
        if (!pool.quoteToken) {
          throw new Error(`pool ${pool.pool} has no verified quote-token identity`);
        }
        const quoteAsset = chain.quoteAssets.find(
          (asset) => asset.address.toLowerCase() === pool.quoteToken!.toLowerCase(),
        );
        if (!quoteAsset) {
          throw new Error(`pool ${pool.pool} quote token is absent from chain registry`);
        }
        return {
          venue: pool.venue,
          pool: pool.pool,
          ...(pool.feeTier === undefined ? {} : { feeTier: pool.feeTier }),
          tokenDecimals: token.decimals,
          quoteAsset,
        };
      });
  }
}
