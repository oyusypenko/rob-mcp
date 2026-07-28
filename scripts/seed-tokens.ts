import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getAddress, type PublicClient } from "viem";
import { z } from "zod";
import {
  uniswapV2FactoryAbi,
  uniswapV2PairAbi,
  uniswapV3FactoryAbi,
  uniswapV3PoolAbi,
} from "../src/chain/abi";
import { assertClientChainId, createChainClient } from "../src/chain/client";
import { loadConfig } from "../src/config";
import {
  assertDiscoveredPoolIdentity,
  type DiscoveredPoolIdentity,
} from "../src/core/pool-discovery";
import { loadChainRegistry, type ChainConfig } from "../src/registry/chains";
import {
  tokenRegistryFileSchema,
  type TokenRegistryFile,
  type TokenVenueConfig,
} from "../src/registry/tokens";

const ROBINHOOD_ASSETS_URL = "https://api.robinhood.com/rhj/assets";
const ROBINHOOD_FEEDS_URL =
  "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
const ROBINHOOD_CHAIN_ID = 4663;
const ROBINHOOD_PROFILE = "robinhood-erc8056";
const zeroAddress = "0x0000000000000000000000000000000000000000";

const assetsResponseSchema = z.strictObject({
  assets: z.array(
    z.looseObject({
      tokenSymbol: z.string().min(1),
      tokenName: z.string().min(1),
      deployments: z.array(
        z.looseObject({
          contractAddress: z.string(),
          chainId: z.number().int().positive(),
        }),
      ),
    }),
  ),
});

const feedSchema = z.looseObject({
  proxyAddress: z.string(),
  heartbeat: z.number().int().positive(),
  docs: z.looseObject({
    baseAsset: z.string().optional(),
    blockchainName: z.string().optional(),
    productTypeCode: z.string().optional(),
  }),
});

const feedsResponseSchema = z.array(feedSchema);

export interface PoolDiscoveryReader {
  getV2Pair(input: {
    readonly factory: string;
    readonly token: string;
    readonly quoteToken: string;
  }): Promise<string>;
  getV3Pool(input: {
    readonly factory: string;
    readonly token: string;
    readonly quoteToken: string;
    readonly feeTier: number;
  }): Promise<string>;
  inspectV2Pool(pool: string): Promise<DiscoveredPoolIdentity>;
  inspectV3Pool(pool: string): Promise<DiscoveredPoolIdentity>;
}

export class ViemPoolDiscoveryReader implements PoolDiscoveryReader {
  constructor(private readonly client: PublicClient) {}

  async getV2Pair(input: {
    readonly factory: string;
    readonly token: string;
    readonly quoteToken: string;
  }): Promise<string> {
    return this.client.readContract({
      address: getAddress(input.factory),
      abi: uniswapV2FactoryAbi,
      functionName: "getPair",
      args: [getAddress(input.token), getAddress(input.quoteToken)],
    });
  }

  async getV3Pool(input: {
    readonly factory: string;
    readonly token: string;
    readonly quoteToken: string;
    readonly feeTier: number;
  }): Promise<string> {
    return this.client.readContract({
      address: getAddress(input.factory),
      abi: uniswapV3FactoryAbi,
      functionName: "getPool",
      args: [getAddress(input.token), getAddress(input.quoteToken), input.feeTier],
    });
  }

  async inspectV2Pool(pool: string): Promise<DiscoveredPoolIdentity> {
    const address = getAddress(pool);
    const [bytecode, factory, token0, token1] = await Promise.all([
      this.client.getBytecode({ address }),
      this.client.readContract({
        address,
        abi: uniswapV2PairAbi,
        functionName: "factory",
      }),
      this.client.readContract({
        address,
        abi: uniswapV2PairAbi,
        functionName: "token0",
      }),
      this.client.readContract({
        address,
        abi: uniswapV2PairAbi,
        functionName: "token1",
      }),
    ]);
    return { pool: address, bytecode, factory, token0, token1 };
  }

  async inspectV3Pool(pool: string): Promise<DiscoveredPoolIdentity> {
    const address = getAddress(pool);
    const [bytecode, factory, token0, token1, feeTier] = await Promise.all([
      this.client.getBytecode({ address }),
      this.client.readContract({
        address,
        abi: uniswapV3PoolAbi,
        functionName: "factory",
      }),
      this.client.readContract({
        address,
        abi: uniswapV3PoolAbi,
        functionName: "token0",
      }),
      this.client.readContract({
        address,
        abi: uniswapV3PoolAbi,
        functionName: "token1",
      }),
      this.client.readContract({
        address,
        abi: uniswapV3PoolAbi,
        functionName: "fee",
      }),
    ]);
    return { pool: address, bytecode, factory, token0, token1, feeTier };
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`source ${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

export async function discoverVerifiedVenues(input: {
  readonly chain: ChainConfig;
  readonly token: string;
  readonly reader: PoolDiscoveryReader;
}): Promise<TokenVenueConfig[]> {
  const venues: TokenVenueConfig[] = [];
  const token = getAddress(input.token);

  for (const quoteAsset of input.chain.quoteAssets) {
    const quoteToken = getAddress(quoteAsset.address);
    const v2 = input.chain.venues.univ2;
    if (v2) {
      const pool = getAddress(
        await input.reader.getV2Pair({
          factory: v2.factory,
          token,
          quoteToken,
        }),
      );
      if (pool.toLowerCase() !== zeroAddress) {
        const identity = await input.reader.inspectV2Pool(pool);
        assertDiscoveredPoolIdentity(identity, {
          factory: v2.factory,
          tokenA: token,
          tokenB: quoteToken,
        });
        venues.push({ venue: "univ2", pool, quoteToken });
      }
    }

    const v3 = input.chain.venues.univ3;
    if (v3) {
      for (const feeTier of v3.feeTiers) {
        const pool = getAddress(
          await input.reader.getV3Pool({
            factory: v3.factory,
            token,
            quoteToken,
            feeTier,
          }),
        );
        if (pool.toLowerCase() === zeroAddress) {
          continue;
        }
        const identity = await input.reader.inspectV3Pool(pool);
        assertDiscoveredPoolIdentity(identity, {
          factory: v3.factory,
          tokenA: token,
          tokenB: quoteToken,
          feeTier,
        });
        venues.push({ venue: "univ3", pool, feeTier, quoteToken });
      }
    }
  }

  return venues.sort(
    (left, right) =>
      left.venue.localeCompare(right.venue) ||
      (left.quoteToken ?? "").localeCompare(right.quoteToken ?? "") ||
      (left.feeTier ?? 0) - (right.feeTier ?? 0) ||
      left.pool.localeCompare(right.pool),
  );
}

export async function seedRobinhoodTokens(input: {
  readonly chain: ChainConfig;
  readonly poolReader: PoolDiscoveryReader;
  readonly now?: () => Date;
}): Promise<TokenRegistryFile> {
  if (input.chain.id !== ROBINHOOD_CHAIN_ID) {
    throw new Error(`Robinhood seed adapter cannot seed chain ${input.chain.id}`);
  }
  const [assetsPayload, feedsPayload] = await Promise.all([
    fetchJson(ROBINHOOD_ASSETS_URL),
    fetchJson(ROBINHOOD_FEEDS_URL),
  ]);
  const assets = assetsResponseSchema.parse(assetsPayload).assets;
  const feeds = feedsResponseSchema.parse(feedsPayload);
  const feedByTicker = new Map<string, { address: string; heartbeatSeconds: number }>();

  for (const feed of feeds) {
    if (
      feed.docs.blockchainName !== "Robinhood" ||
      feed.docs.productTypeCode !== "primaryTokenizedPrice" ||
      !feed.docs.baseAsset
    ) {
      continue;
    }
    const ticker = feed.docs.baseAsset.toUpperCase();
    if (feedByTicker.has(ticker)) {
      throw new Error(`multiple primary Robinhood feeds for ${ticker}`);
    }
    feedByTicker.set(ticker, {
      address: getAddress(feed.proxyAddress),
      heartbeatSeconds: feed.heartbeat,
    });
  }

  const sourceTokens = assets
    .flatMap((asset) =>
      asset.deployments
        .filter(({ chainId }) => chainId === ROBINHOOD_CHAIN_ID)
        .map(({ contractAddress }) => ({
          ticker: asset.tokenSymbol.toUpperCase(),
          name: asset.tokenName,
          address: getAddress(contractAddress),
        })),
    )
    .sort((left, right) => left.ticker.localeCompare(right.ticker));

  if (sourceTokens.length === 0) {
    throw new Error("Robinhood source returned no chain 4663 deployments");
  }

  const tokens: TokenRegistryFile["tokens"] = [];
  for (const sourceToken of sourceTokens) {
    const feed = feedByTicker.get(sourceToken.ticker);
    tokens.push({
      ...sourceToken,
      decimals: 18,
      issuerProfile: ROBINHOOD_PROFILE,
      ...(feed
        ? {
            feed: feed.address,
            feedHeartbeatSeconds: feed.heartbeatSeconds,
          }
        : {}),
      venues: await discoverVerifiedVenues({
        chain: input.chain,
        token: sourceToken.address,
        reader: input.poolReader,
      }),
    });
  }

  return tokenRegistryFileSchema.parse({
    version: 1,
    chainId: ROBINHOOD_CHAIN_ID,
    updatedAt: (input.now ?? (() => new Date()))().toISOString(),
    tokens,
  });
}

async function main(): Promise<void> {
  const config = loadConfig({ ...process.env, ENABLED_CHAINS: String(ROBINHOOD_CHAIN_ID) });
  const chains = await loadChainRegistry(config.chainsPath);
  const chain = chains.get(ROBINHOOD_CHAIN_ID);
  const rpc = config.rpcByChain.get(ROBINHOOD_CHAIN_ID);
  if (!rpc) {
    throw new Error(`RPC_URL_${ROBINHOOD_CHAIN_ID} is required`);
  }
  const client = createChainClient(chain, rpc);
  await assertClientChainId(client, ROBINHOOD_CHAIN_ID);
  const outputPath = resolve(process.argv[2] ?? `data/tokens/${ROBINHOOD_CHAIN_ID}.json`);
  const registry = await seedRobinhoodTokens({
    chain,
    poolReader: new ViemPoolDiscoveryReader(client),
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({
      chainId: registry.chainId,
      tokens: registry.tokens.length,
      feeds: registry.tokens.filter(({ feed }) => feed !== undefined).length,
      venues: registry.tokens.reduce((count, token) => count + token.venues.length, 0),
      outputPath,
    }),
  );
}

if (import.meta.main) {
  await main();
}
