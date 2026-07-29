import { z } from "zod";

export type RuntimeMode = "stdio" | "serve" | "scan";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const rpcUrlSchema = z
  .url()
  .refine(
    (value) =>
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("ws://") ||
      value.startsWith("wss://"),
    "must use http(s) or ws(s)",
  );

const envSchema = z.object({
  ENABLED_CHAINS: z.string().default("4663"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8402),
  SQLITE_PATH: z.string().min(1).default("./rob.db"),
  CHAINS_PATH: z.string().min(1).default("./data/chains.json"),
  TOKENS_DIR: z.string().min(1).default("./data/tokens"),
  WHALE_MIN_USD: z.coerce.number().positive().default(50_000),
  MAX_QUOTE_USD: z.coerce.number().positive().default(100_000),
  MAX_WHALE_SINCE_HOURS: z.coerce.number().positive().default(168),
  MAX_WHALE_RESULTS: z.coerce.number().int().positive().default(200),
  LIQUIDITY_CLIP_USD: z.coerce.number().positive().default(10_000),
  ROBINHOOD_QUOTE_MAX_AGE_SECONDS: z.coerce.number().positive().default(30),
  FREE_CALLS_PER_DAY: z.coerce.number().int().nonnegative().default(20),
  FREE_TIER_MAX_IDENTITIES: z.coerce.number().int().positive().default(10_000),
  TRUST_PROXY: z.enum(["none", "fly"]).default("none"),
  MAX_REQUEST_BODY_BYTES: z.coerce.number().int().positive().max(1_048_576).default(65_536),
  PAYMENT_REPLAY_MAX_ENTRIES: z.coerce.number().int().positive().default(10_000),
  PAYMENT_REPLAY_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  X402_PAY_TO: z.string().regex(addressPattern).optional(),
  X402_NETWORK: z.enum(["eip155:8453", "eip155:84532"]).default("eip155:84532"),
  X402_FACILITATOR_URL: z.url().optional(),
  CDP_API_KEY_ID: z.string().min(1).optional(),
  CDP_API_KEY_SECRET: z.string().min(1).optional(),
});

export interface ChainRpcConfig {
  readonly url: string;
  readonly archiveUrl?: string;
}

export interface Config {
  readonly mode: RuntimeMode;
  readonly enabledChains: readonly number[];
  readonly defaultChainId: number;
  readonly rpcByChain: ReadonlyMap<number, ChainRpcConfig>;
  readonly port: number;
  readonly sqlitePath: string;
  readonly chainsPath: string;
  readonly tokensDir: string;
  readonly whaleMinUsd: number;
  readonly maxQuoteUsd: number;
  readonly maxWhaleSinceHours: number;
  readonly maxWhaleResults: number;
  readonly liquidityClipUsd: number;
  readonly robinhoodQuoteMaxAgeSeconds: number;
  readonly freeCallsPerDay: number;
  readonly freeTierMaxIdentities: number;
  readonly trustedProxy: "none" | "fly";
  readonly maxRequestBodyBytes: number;
  readonly paymentReplayMaxEntries: number;
  readonly paymentReplayTtlSeconds: number;
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly x402: {
    readonly payTo?: `0x${string}`;
    readonly network: "eip155:8453" | "eip155:84532";
    readonly facilitatorUrl?: string;
    readonly cdpApiKeyId?: string;
    readonly cdpApiKeySecret?: string;
  };
}

type Environment = Record<string, string | undefined>;

function parseEnabledChains(value: string): number[] {
  const rawIds = value.split(",").map((item) => item.trim());
  if (rawIds.length === 0 || rawIds.some((item) => item.length === 0)) {
    throw new Error("ENABLED_CHAINS must contain comma-separated chain ids");
  }

  const chainIds = rawIds.map((item) => Number(item));
  if (chainIds.some((chainId) => !Number.isSafeInteger(chainId) || chainId <= 0)) {
    throw new Error("ENABLED_CHAINS entries must be positive integers");
  }
  if (new Set(chainIds).size !== chainIds.length) {
    throw new Error("ENABLED_CHAINS contains a duplicate chain id");
  }
  return chainIds;
}

function optionalNonEmpty(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

export function loadConfig(env: Environment, mode: RuntimeMode = "stdio"): Config {
  const normalizedEnv = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, optionalNonEmpty(value)]),
  );
  const parsed = envSchema.parse(normalizedEnv);
  const enabledChains = parseEnabledChains(parsed.ENABLED_CHAINS);
  const rpcByChain = new Map<number, ChainRpcConfig>();

  for (const chainId of enabledChains) {
    const rpcKey = `RPC_URL_${chainId}`;
    const archiveKey = `${rpcKey}_ARCHIVE`;
    const url = normalizedEnv[rpcKey];
    if (!url) {
      throw new Error(`${rpcKey} is required for enabled chain ${chainId}`);
    }
    const archiveUrl = normalizedEnv[archiveKey];
    rpcByChain.set(chainId, {
      url: rpcUrlSchema.parse(url),
      ...(archiveUrl ? { archiveUrl: rpcUrlSchema.parse(archiveUrl) } : {}),
    });
  }

  if (mode === "serve" && !parsed.X402_PAY_TO) {
    throw new Error("X402_PAY_TO is required in serve mode");
  }
  if (mode === "serve" && parsed.X402_NETWORK === "eip155:8453") {
    throw new Error("Base mainnet payments are blocked until the O-5 compliance decision resolves");
  }

  const defaultChainId = enabledChains[0];
  if (defaultChainId === undefined) {
    throw new Error("at least one enabled chain is required");
  }

  return {
    mode,
    enabledChains,
    defaultChainId,
    rpcByChain,
    port: parsed.PORT,
    sqlitePath: parsed.SQLITE_PATH,
    chainsPath: parsed.CHAINS_PATH,
    tokensDir: parsed.TOKENS_DIR,
    whaleMinUsd: parsed.WHALE_MIN_USD,
    maxQuoteUsd: parsed.MAX_QUOTE_USD,
    maxWhaleSinceHours: parsed.MAX_WHALE_SINCE_HOURS,
    maxWhaleResults: parsed.MAX_WHALE_RESULTS,
    liquidityClipUsd: parsed.LIQUIDITY_CLIP_USD,
    robinhoodQuoteMaxAgeSeconds: parsed.ROBINHOOD_QUOTE_MAX_AGE_SECONDS,
    freeCallsPerDay: parsed.FREE_CALLS_PER_DAY,
    freeTierMaxIdentities: parsed.FREE_TIER_MAX_IDENTITIES,
    trustedProxy: parsed.TRUST_PROXY,
    maxRequestBodyBytes: parsed.MAX_REQUEST_BODY_BYTES,
    paymentReplayMaxEntries: parsed.PAYMENT_REPLAY_MAX_ENTRIES,
    paymentReplayTtlSeconds: parsed.PAYMENT_REPLAY_TTL_SECONDS,
    logLevel: parsed.LOG_LEVEL,
    x402: {
      ...(parsed.X402_PAY_TO ? { payTo: parsed.X402_PAY_TO as `0x${string}` } : {}),
      network: parsed.X402_NETWORK,
      ...(parsed.X402_FACILITATOR_URL ? { facilitatorUrl: parsed.X402_FACILITATOR_URL } : {}),
      ...(parsed.CDP_API_KEY_ID ? { cdpApiKeyId: parsed.CDP_API_KEY_ID } : {}),
      ...(parsed.CDP_API_KEY_SECRET ? { cdpApiKeySecret: parsed.CDP_API_KEY_SECRET } : {}),
    },
  };
}
