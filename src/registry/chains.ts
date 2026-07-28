import { readFile } from "node:fs/promises";
import { z } from "zod";
import { addressSchema, issuerProfileSchema } from "./issuer-profiles";

const venueV2Schema = z.strictObject({
  factory: addressSchema,
});

const venueV3Schema = z.strictObject({
  factory: addressSchema,
  quoter: addressSchema,
  router: addressSchema,
  feeTiers: z.array(z.number().int().positive()).default([]),
});

const quoteAssetSchema = z.strictObject({
  symbol: z.string().min(1),
  address: addressSchema,
  decimals: z.number().int().min(0).max(255),
  usdFeed: z.strictObject({
    address: addressSchema,
    decimals: z.number().int().min(0).max(255),
    heartbeatSeconds: z.number().int().positive().optional(),
  }),
});

export const chainSchema = z.strictObject({
  id: z.number().int().positive(),
  name: z.string().min(1),
  nativeCurrency: z.strictObject({
    name: z.string().min(1),
    symbol: z.string().min(1),
    decimals: z.number().int().min(0).max(255),
  }),
  explorer: z.strictObject({
    name: z.string().min(1),
    url: z.url(),
  }),
  venues: z.strictObject({
    univ2: venueV2Schema.optional(),
    univ3: venueV3Schema.optional(),
  }),
  quoteAssets: z.array(quoteAssetSchema).default([]),
  scanner: z
    .strictObject({
      initialChunkBlocks: z.number().int().positive(),
      reorgTailBlocks: z.number().int().positive(),
      headPollIntervalMs: z.number().int().positive(),
    })
    .optional(),
  oracle: z.strictObject({
    kind: z.literal("chainlink-aggregator-v3"),
    requiresSequencerUptime: z.boolean().default(false),
    sequencerUptimeFeed: addressSchema.nullable(),
  }),
  issuerProfile: issuerProfileSchema,
});

export const chainRegistryFileSchema = z.strictObject({
  version: z.literal(1),
  chains: z.array(chainSchema).min(1),
});

export type ChainConfig = z.infer<typeof chainSchema>;
export type ChainRegistryFile = z.infer<typeof chainRegistryFileSchema>;

export class ChainRegistry {
  readonly chains: readonly ChainConfig[];
  private readonly byId: ReadonlyMap<number, ChainConfig>;

  constructor(file: ChainRegistryFile) {
    const byId = new Map<number, ChainConfig>();
    for (const chain of file.chains) {
      if (byId.has(chain.id)) {
        throw new Error(`duplicate chain id ${chain.id}`);
      }
      byId.set(chain.id, chain);
    }
    this.chains = Object.freeze([...file.chains]);
    this.byId = byId;
  }

  get(chainId: number): ChainConfig {
    const chain = this.byId.get(chainId);
    if (!chain) {
      throw new Error(`unsupported chain ${chainId}`);
    }
    return chain;
  }

  has(chainId: number): boolean {
    return this.byId.has(chainId);
  }
}

export async function loadChainRegistry(path: string): Promise<ChainRegistry> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  return new ChainRegistry(chainRegistryFileSchema.parse(raw));
}
