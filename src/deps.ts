import { assertClientChainId, createChainClient, type ReadOnlyChainClient } from "./chain/client";
import { ChainlinkOracleAdapter, ViemChainlinkReader } from "./adapters/chainlink";
import { DexRegistry } from "./adapters/dex-registry";
import { RegistryDexPoolCatalog } from "./adapters/dex-pools";
import { OracleRouter } from "./adapters/oracle-router";
import { RobinhoodFallbackOracleAdapter } from "./adapters/robinhood-fallback";
import { createWhaleScannerRuntime, type WhaleScannerRuntime } from "./adapters/scanner-runtime";
import { createSqliteWhaleStore } from "./adapters/sqlite-whale-store";
import { UniswapV2Adapter, ViemUniswapV2Reader } from "./adapters/uniswap-v2";
import { UniswapV3Adapter, ViemUniswapV3Reader } from "./adapters/uniswap-v3";
import type { Config } from "./config";
import type { DexRegistryPort, OraclePort, WhaleStore } from "./core/ports";
import { createLogger } from "./logger";
import { loadChainRegistry, type ChainRegistry } from "./registry/chains";
import { loadTokenRegistry, type TokenRegistry } from "./registry/tokens";

export interface Deps {
  readonly config: Config;
  readonly chainRegistry: ChainRegistry;
  readonly tokenRegistry: TokenRegistry;
  readonly clients: ReadonlyMap<number, ReadOnlyChainClient>;
  readonly oracle: OraclePort;
  readonly dex: DexRegistryPort;
  readonly whaleStore?: WhaleStore;
  readonly scanner?: WhaleScannerRuntime;
  readonly now: () => Date;
}

export interface CreateDepsOptions {
  readonly chainRegistry?: ChainRegistry;
  readonly tokenRegistry?: TokenRegistry;
  readonly clientFactory?: typeof createChainClient;
  readonly verifyRpcChainIds?: boolean;
  readonly oracle?: OraclePort;
  readonly dex?: DexRegistryPort;
  readonly whaleStore?: WhaleStore;
  readonly scanner?: WhaleScannerRuntime;
  readonly now?: () => Date;
}

export async function createDeps(config: Config, options: CreateDepsOptions = {}): Promise<Deps> {
  const chainRegistry = options.chainRegistry ?? (await loadChainRegistry(config.chainsPath));
  const tokenRegistry =
    options.tokenRegistry ??
    (await loadTokenRegistry(config.tokensDir, chainRegistry, config.enabledChains));
  const clientFactory = options.clientFactory ?? createChainClient;
  const clients = new Map<number, ReadOnlyChainClient>();

  for (const chainId of config.enabledChains) {
    const rpc = config.rpcByChain.get(chainId);
    if (!rpc) {
      throw new Error(`missing parsed RPC configuration for chain ${chainId}`);
    }
    const client = clientFactory(chainRegistry.get(chainId), rpc);
    if (options.verifyRpcChainIds !== false) {
      await assertClientChainId(client, chainId);
    }
    clients.set(chainId, client);
  }

  const now = options.now ?? (() => new Date());
  const chainlink = new ChainlinkOracleAdapter({
    chains: chainRegistry,
    reader: new ViemChainlinkReader(clients),
    now,
  });
  const oracle =
    options.oracle ??
    new OracleRouter(
      chainlink,
      new RobinhoodFallbackOracleAdapter({
        maxAgeSeconds: config.robinhoodQuoteMaxAgeSeconds,
        assertSequencerUsable: (chainId) => chainlink.assertChainSequencerUsable(chainId),
        now,
      }),
    );
  const poolCatalog = new RegistryDexPoolCatalog(tokenRegistry, chainRegistry);
  const quoterByChain = new Map<number, string>();
  for (const chainId of config.enabledChains) {
    const quoter = chainRegistry.get(chainId).venues.univ3?.quoter;
    if (quoter) {
      quoterByChain.set(chainId, quoter);
    }
  }
  const dex =
    options.dex ??
    new DexRegistry([
      new UniswapV2Adapter({
        pools: poolCatalog,
        reader: new ViemUniswapV2Reader(clients),
        oracle,
        spreadClipUsd: config.liquidityClipUsd,
        now,
      }),
      new UniswapV3Adapter({
        pools: poolCatalog,
        reader: new ViemUniswapV3Reader(clients, quoterByChain),
        oracle,
        quoterByChain,
        spreadClipUsd: config.liquidityClipUsd,
        now,
      }),
    ]);
  const whaleStore =
    options.whaleStore ??
    (config.mode === "stdio" ? undefined : await createSqliteWhaleStore(config.sqlitePath));
  const scanner =
    options.scanner ??
    (config.mode !== "stdio" && whaleStore
      ? await createWhaleScannerRuntime({
          config,
          chainRegistry,
          tokenRegistry,
          clients,
          store: whaleStore,
          pricerOracle: oracle,
          logger: createLogger(config.logLevel),
          clientFactory,
          verifyRpcChainIds: options.verifyRpcChainIds,
          now,
        })
      : undefined);

  return {
    config,
    chainRegistry,
    tokenRegistry,
    clients,
    oracle,
    dex,
    ...(whaleStore ? { whaleStore } : {}),
    ...(scanner ? { scanner } : {}),
    now,
  };
}
