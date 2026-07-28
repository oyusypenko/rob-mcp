import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ChainRegistry } from "./chains";
import { addressSchema } from "./issuer-profiles";

export const tokenVenueSchema = z.strictObject({
  venue: z.enum(["univ2", "univ3"]),
  pool: addressSchema,
  feeTier: z.number().int().positive().optional(),
  quoteToken: addressSchema.optional(),
});

export const tokenSchema = z
  .strictObject({
    ticker: z.string().trim().min(1).max(32),
    name: z.string().trim().min(1).max(200),
    address: addressSchema,
    decimals: z.number().int().min(0).max(255),
    issuerProfile: z.string().min(1),
    feed: addressSchema.optional(),
    feedHeartbeatSeconds: z.number().int().positive().optional(),
    venues: z.array(tokenVenueSchema),
  })
  .refine((token) => (token.feed === undefined) === (token.feedHeartbeatSeconds === undefined), {
    error: "feed and feedHeartbeatSeconds must be configured together",
  });

export const tokenRegistryFileSchema = z.strictObject({
  version: z.literal(1),
  chainId: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  tokens: z.array(tokenSchema),
});

export type TokenConfig = z.infer<typeof tokenSchema>;
export type TokenVenueConfig = z.infer<typeof tokenVenueSchema>;
export type TokenRegistryFile = z.infer<typeof tokenRegistryFileSchema>;

export interface ListedStockToken {
  readonly chainId: number;
  readonly ticker: string;
  readonly name: string;
  readonly address: string;
  readonly feed?: string;
  readonly venues: ("univ2" | "univ3")[];
  readonly updatedAt: string;
}

interface TokenRecord extends TokenConfig {
  readonly chainId: number;
  readonly updatedAt: string;
}

export class TokenRegistry {
  private readonly enabledChains: ReadonlySet<number>;
  private readonly byChain: ReadonlyMap<number, readonly TokenRecord[]>;
  private readonly byLookup: ReadonlyMap<string, TokenRecord>;

  constructor(
    chains: ChainRegistry,
    files: readonly TokenRegistryFile[],
    enabledChainIds: readonly number[],
  ) {
    this.enabledChains = new Set(enabledChainIds);
    const byChain = new Map<number, readonly TokenRecord[]>();
    const byLookup = new Map<string, TokenRecord>();

    for (const chainId of enabledChainIds) {
      if (!chains.has(chainId)) {
        throw new Error(`enabled chain ${chainId} is absent from chain registry`);
      }
    }

    for (const file of files) {
      const chain = chains.get(file.chainId);
      if (byChain.has(file.chainId)) {
        throw new Error(`duplicate token registry for chain ${file.chainId}`);
      }
      const records = file.tokens.map((token) => {
        if (token.issuerProfile !== chain.issuerProfile.id) {
          throw new Error(
            `${token.ticker} issuer profile ${token.issuerProfile} does not match chain ${file.chainId} issuer profile ${chain.issuerProfile.id}`,
          );
        }
        return { ...token, chainId: file.chainId, updatedAt: file.updatedAt };
      });

      for (const record of records) {
        for (const identifier of [record.ticker, record.address]) {
          const key = lookupKey(file.chainId, identifier);
          if (byLookup.has(key)) {
            throw new Error(`duplicate token identifier ${identifier} on chain ${file.chainId}`);
          }
          byLookup.set(key, record);
        }
      }
      byChain.set(file.chainId, Object.freeze(records));
    }

    for (const chainId of enabledChainIds) {
      if (!byChain.has(chainId)) {
        throw new Error(`missing token registry for enabled chain ${chainId}`);
      }
    }

    this.byChain = byChain;
    this.byLookup = byLookup;
  }

  resolve(chainId: number, identifier: string): TokenConfig {
    if (!this.enabledChains.has(chainId)) {
      throw new Error(`chain ${chainId} is not enabled`);
    }
    const token = this.byLookup.get(lookupKey(chainId, identifier));
    if (!token) {
      throw new Error(`unknown token ${identifier} on chain ${chainId}`);
    }
    return token;
  }

  list(options: { chain?: number; search?: string } = {}): ListedStockToken[] {
    const chainIds =
      options.chain === undefined ? [...this.enabledChains] : [this.assertEnabled(options.chain)];
    const search = options.search?.trim().toLowerCase();
    const result: ListedStockToken[] = [];

    for (const chainId of chainIds) {
      for (const token of this.byChain.get(chainId) ?? []) {
        if (
          search &&
          !token.ticker.toLowerCase().includes(search) &&
          !token.name.toLowerCase().includes(search) &&
          !token.address.toLowerCase().includes(search)
        ) {
          continue;
        }
        result.push({
          chainId,
          ticker: token.ticker,
          name: token.name,
          address: token.address,
          feed: token.feed,
          venues: [...new Set(token.venues.map(({ venue }) => venue))].sort(),
          updatedAt: token.updatedAt,
        });
      }
    }
    return result.sort(
      (left, right) => left.chainId - right.chainId || left.ticker.localeCompare(right.ticker),
    );
  }

  entries(chainId: number): readonly TokenConfig[] {
    this.assertEnabled(chainId);
    return this.byChain.get(chainId) ?? [];
  }

  private assertEnabled(chainId: number): number {
    if (!this.enabledChains.has(chainId)) {
      throw new Error(`chain ${chainId} is not enabled`);
    }
    return chainId;
  }
}

function lookupKey(chainId: number, identifier: string): string {
  return `${chainId}:${identifier.trim().toLowerCase()}`;
}

export async function loadTokenRegistry(
  directory: string,
  chains: ChainRegistry,
  enabledChainIds: readonly number[],
): Promise<TokenRegistry> {
  const files = await Promise.all(
    enabledChainIds.map(async (chainId) => {
      const raw: unknown = JSON.parse(await readFile(join(directory, `${chainId}.json`), "utf8"));
      return tokenRegistryFileSchema.parse(raw);
    }),
  );
  return new TokenRegistry(chains, files, enabledChainIds);
}
