import type { Deps } from "./deps";

export interface HealthResult {
  readonly status: "ok" | "degraded";
  readonly chains: readonly {
    readonly chainId: number;
    readonly ok: boolean;
    readonly block?: string;
    readonly error?: string;
  }[];
}

export async function getHealth(deps: Deps): Promise<HealthResult> {
  const chains = await Promise.all(
    deps.config.enabledChains.map(async (chainId) => {
      const client = deps.clients.get(chainId);
      if (!client) {
        return { chainId, ok: false, error: "client unavailable" } as const;
      }
      try {
        const block = await client.getBlockNumber();
        return { chainId, ok: true, block: block.toString() } as const;
      } catch (error) {
        return {
          chainId,
          ok: false,
          error: error instanceof Error ? error.message : "RPC check failed",
        } as const;
      }
    }),
  );
  return {
    status: chains.every(({ ok }) => ok) ? "ok" : "degraded",
    chains,
  };
}
