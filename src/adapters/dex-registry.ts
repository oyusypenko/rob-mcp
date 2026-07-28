import type { DexLiquidity, DexPort, DexQuote, DexRegistryPort } from "../core/ports";

export class DexRegistry implements DexRegistryPort {
  private readonly adapters: ReadonlyMap<DexPort["venue"], DexPort>;

  constructor(adapters: readonly DexPort[]) {
    const byVenue = new Map<DexPort["venue"], DexPort>();
    for (const adapter of adapters) {
      if (byVenue.has(adapter.venue)) {
        throw new Error(`duplicate DEX adapter ${adapter.venue}`);
      }
      byVenue.set(adapter.venue, adapter);
    }
    this.adapters = byVenue;
  }

  async quote(input: {
    chainId: number;
    tokenAddress: string;
    side: "buy" | "sell";
    amountUsd: number;
    referencePriceUsd: number;
    venue: "univ2" | "univ3" | "best";
  }): Promise<DexQuote[]> {
    const adapters =
      input.venue === "best" ? [...this.adapters.values()] : [this.required(input.venue)];
    return (await Promise.all(adapters.map((adapter) => adapter.quote(input)))).flat();
  }

  async liquidity(input: {
    chainId: number;
    tokenAddress: string;
    depthPct: 1 | 2 | 5;
  }): Promise<DexLiquidity[]> {
    return (
      await Promise.all([...this.adapters.values()].map((adapter) => adapter.liquidity(input)))
    ).flat();
  }

  private required(venue: DexPort["venue"]): DexPort {
    const adapter = this.adapters.get(venue);
    if (!adapter) {
      throw new Error(`DEX venue ${venue} is not configured`);
    }
    return adapter;
  }
}
