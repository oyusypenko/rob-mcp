import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getAddress } from "viem";
import { z } from "zod";
import { tokenRegistryFileSchema, type TokenRegistryFile } from "../src/registry/tokens";

const ROBINHOOD_ASSETS_URL = "https://api.robinhood.com/rhj/assets";
const ROBINHOOD_FEEDS_URL =
  "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
const ROBINHOOD_CHAIN_ID = 4663;
const ROBINHOOD_PROFILE = "robinhood-erc8056";

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

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`source ${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

export async function seedRobinhoodTokens(
  now: () => Date = () => new Date(),
): Promise<TokenRegistryFile> {
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

  const tokens = assets
    .flatMap((asset) =>
      asset.deployments
        .filter(({ chainId }) => chainId === ROBINHOOD_CHAIN_ID)
        .map(({ contractAddress }) => ({
          ticker: asset.tokenSymbol.toUpperCase(),
          name: asset.tokenName,
          address: getAddress(contractAddress),
          decimals: 18,
          issuerProfile: ROBINHOOD_PROFILE,
          ...(feedByTicker.has(asset.tokenSymbol.toUpperCase())
            ? {
                feed: feedByTicker.get(asset.tokenSymbol.toUpperCase())!.address,
                feedHeartbeatSeconds: feedByTicker.get(asset.tokenSymbol.toUpperCase())!
                  .heartbeatSeconds,
              }
            : {}),
          venues: [],
        })),
    )
    .sort((left, right) => left.ticker.localeCompare(right.ticker));

  if (tokens.length === 0) {
    throw new Error("Robinhood source returned no chain 4663 deployments");
  }

  return tokenRegistryFileSchema.parse({
    version: 1,
    chainId: ROBINHOOD_CHAIN_ID,
    updatedAt: now().toISOString(),
    tokens,
  });
}

async function main(): Promise<void> {
  const outputPath = resolve(process.argv[2] ?? `data/tokens/${ROBINHOOD_CHAIN_ID}.json`);
  const registry = await seedRobinhoodTokens();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({
      chainId: registry.chainId,
      tokens: registry.tokens.length,
      feeds: registry.tokens.filter(({ feed }) => feed !== undefined).length,
      outputPath,
    }),
  );
}

if (import.meta.main) {
  await main();
}
