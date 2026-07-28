import { assertClientChainId, createChainClient, type ReadOnlyChainClient } from "../chain/client";
import type { Config } from "../config";
import type { TransferLogSource, TransferPricer, WhaleStore } from "../core/ports";
import type { IssuerClassificationProfile } from "../core/whale";
import type { Logger } from "../logger";
import type { ChainRegistry } from "../registry/chains";
import type { TokenConfig, TokenRegistry } from "../registry/tokens";
import { OracleTransferPricer } from "./transfer-pricer";
import { ViemTransferLogSource } from "./viem-transfer-source";
import { scanTokenRange } from "./whale-scanner";

export interface TimestampedTransferLogSource extends TransferLogSource {
  getBlockTimestamp(chainId: number, blockNumber: bigint): Promise<Date>;
}

export interface ScannerChainPlan {
  readonly chainId: number;
  readonly tokens: readonly TokenConfig[];
  readonly issuerProfile: IssuerClassificationProfile;
  readonly initialChunkBlocks: bigint;
  readonly reorgTailBlocks: bigint;
  readonly headPollIntervalMs: number;
}

export interface ScannerChainSnapshot {
  readonly chainId: number;
  readonly status: "idle" | "scanning" | "following" | "error" | "stopped";
  readonly head: string | null;
  readonly scannedThrough: string | null;
  readonly lagBlocks: string | null;
  readonly lastScanAt: string | null;
  readonly error: string | null;
}

export interface ScannerSnapshot {
  readonly available: true;
  readonly running: boolean;
  readonly lagBlocks: string | null;
  readonly chains: readonly ScannerChainSnapshot[];
}

interface MutableScannerChainState {
  status: ScannerChainSnapshot["status"];
  head?: bigint;
  scannedThrough?: bigint;
  lastScanAt?: string;
  error?: string;
}

export interface WhaleScannerRuntimeOptions {
  readonly plans: readonly ScannerChainPlan[];
  readonly source: TimestampedTransferLogSource;
  readonly store: WhaleStore;
  readonly pricer: TransferPricer;
  readonly whaleMinUsd: number;
  readonly maxBackfillHours: number;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export class WhaleScannerRuntime {
  private readonly plans: ReadonlyMap<number, ScannerChainPlan>;
  private readonly states = new Map<number, MutableScannerChainState>();
  private readonly initialBlocks = new Map<number, bigint>();
  private readonly controller = new AbortController();
  private readonly now: () => Date;
  private readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private followPromise?: Promise<void>;
  private active = false;
  private closed = false;

  constructor(private readonly options: WhaleScannerRuntimeOptions) {
    if (
      options.plans.length === 0 ||
      !Number.isFinite(options.maxBackfillHours) ||
      options.maxBackfillHours <= 0
    ) {
      throw new Error("scanner runtime options are invalid");
    }
    this.plans = new Map(options.plans.map((plan) => [plan.chainId, plan]));
    if (this.plans.size !== options.plans.length) {
      throw new Error("scanner runtime has duplicate chain plans");
    }
    for (const plan of options.plans) {
      if (
        plan.initialChunkBlocks < 1n ||
        plan.reorgTailBlocks < 1n ||
        !Number.isSafeInteger(plan.headPollIntervalMs) ||
        plan.headPollIntervalMs < 1
      ) {
        throw new Error(`scanner plan for chain ${plan.chainId} is invalid`);
      }
      this.states.set(plan.chainId, { status: "idle" });
    }
    this.now = options.now ?? (() => new Date());
    this.wait = options.wait ?? waitForAbortableDelay;
  }

  async backfill(): Promise<void> {
    this.assertStartable();
    this.active = true;
    try {
      for (const plan of this.plans.values()) {
        this.controller.signal.throwIfAborted();
        await this.scanChain(plan, "scanning");
      }
    } catch (error) {
      if (!this.controller.signal.aborted) {
        throw error;
      }
    } finally {
      this.active = false;
    }
  }

  startFollowing(): void {
    this.assertStartable();
    this.active = true;
    this.followPromise = Promise.all(
      [...this.plans.values()].map((plan) => this.followChain(plan)),
    ).then(() => undefined);
  }

  snapshot(): ScannerSnapshot {
    const chains = [...this.plans.keys()].map((chainId): ScannerChainSnapshot => {
      const state = this.states.get(chainId)!;
      const lag =
        state.head !== undefined && state.scannedThrough !== undefined
          ? maxBigInt(0n, state.head - state.scannedThrough)
          : undefined;
      return {
        chainId,
        status: state.status,
        head: state.head?.toString() ?? null,
        scannedThrough: state.scannedThrough?.toString() ?? null,
        lagBlocks: lag?.toString() ?? null,
        lastScanAt: state.lastScanAt ?? null,
        error: state.error ?? null,
      };
    });
    const knownLags = chains
      .map(({ lagBlocks }) => (lagBlocks === null ? undefined : BigInt(lagBlocks)))
      .filter((lag): lag is bigint => lag !== undefined);
    const highestLag =
      knownLags.length === 0
        ? undefined
        : knownLags.reduce((highest, lag) => maxBigInt(highest, lag), 0n);
    return {
      available: true,
      running: this.active,
      lagBlocks: highestLag?.toString() ?? null,
      chains,
    };
  }

  async stop(): Promise<void> {
    if (!this.controller.signal.aborted) {
      this.controller.abort();
    }
    await this.followPromise;
    this.active = false;
    for (const state of this.states.values()) {
      state.status = "stopped";
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.stop();
    await this.options.store.close();
  }

  private assertStartable(): void {
    if (this.closed || this.controller.signal.aborted) {
      throw new Error("scanner runtime is closed");
    }
    if (this.active) {
      throw new Error("scanner runtime is already active");
    }
  }

  private async followChain(plan: ScannerChainPlan): Promise<void> {
    while (!this.controller.signal.aborted) {
      try {
        await this.scanChain(plan, "following");
      } catch (error) {
        if (this.controller.signal.aborted) {
          return;
        }
        this.options.logger.error("scanner head-follow failed", {
          chainId: plan.chainId,
          error: errorMessage(error),
        });
      }
      try {
        await this.wait(plan.headPollIntervalMs, this.controller.signal);
      } catch (error) {
        if (this.controller.signal.aborted) {
          return;
        }
        throw error;
      }
    }
  }

  private async scanChain(plan: ScannerChainPlan, status: "scanning" | "following"): Promise<void> {
    const state = this.states.get(plan.chainId)!;
    state.status = status;
    state.error = undefined;
    try {
      const head = await this.options.source.getHead(plan.chainId);
      state.head = head;
      const initialBlock = await this.initialBlock(plan.chainId, head);
      for (const token of plan.tokens) {
        this.controller.signal.throwIfAborted();
        await scanTokenRange({
          chainId: plan.chainId,
          token,
          issuerProfile: plan.issuerProfile,
          source: this.options.source,
          store: this.options.store,
          pricer: this.options.pricer,
          whaleMinUsd: this.options.whaleMinUsd,
          initialChunkBlocks: plan.initialChunkBlocks,
          initialBlock,
          throughBlock: head,
          reorgTailBlocks: plan.reorgTailBlocks,
          signal: this.controller.signal,
        });
      }
      state.scannedThrough = head;
      state.lastScanAt = this.now().toISOString();
      this.options.logger.info("scanner range complete", {
        chainId: plan.chainId,
        throughBlock: head.toString(),
        tokens: plan.tokens.length,
        mode: status,
      });
    } catch (error) {
      if (this.controller.signal.aborted) {
        throw error;
      }
      state.status = "error";
      state.error = errorMessage(error);
      throw error;
    }
  }

  private async initialBlock(chainId: number, head: bigint): Promise<bigint> {
    const cached = this.initialBlocks.get(chainId);
    if (cached !== undefined) {
      return cached;
    }
    const cutoff = new Date(this.now().getTime() - this.options.maxBackfillHours * 60 * 60 * 1_000);
    const initialBlock = await findFirstBlockAtOrAfter({
      head,
      cutoff,
      getTimestamp: (blockNumber) => this.options.source.getBlockTimestamp(chainId, blockNumber),
    });
    this.initialBlocks.set(chainId, initialBlock);
    return initialBlock;
  }
}

export async function findFirstBlockAtOrAfter(input: {
  readonly head: bigint;
  readonly cutoff: Date;
  readonly getTimestamp: (blockNumber: bigint) => Promise<Date>;
}): Promise<bigint> {
  if (input.head < 0n || !Number.isFinite(input.cutoff.getTime())) {
    throw new Error("block timestamp search options are invalid");
  }
  let low = 0n;
  let high = input.head;
  const firstTimestamp = await input.getTimestamp(low);
  if (firstTimestamp >= input.cutoff) {
    return low;
  }
  const headTimestamp = await input.getTimestamp(high);
  if (headTimestamp < input.cutoff) {
    return high;
  }

  while (low < high) {
    const midpoint = (low + high) / 2n;
    const timestamp = await input.getTimestamp(midpoint);
    if (timestamp < input.cutoff) {
      low = midpoint + 1n;
    } else {
      high = midpoint;
    }
  }
  return low;
}

export async function createWhaleScannerRuntime(input: {
  readonly config: Config;
  readonly chainRegistry: ChainRegistry;
  readonly tokenRegistry: TokenRegistry;
  readonly clients: ReadonlyMap<number, ReadOnlyChainClient>;
  readonly store: WhaleStore;
  readonly pricerOracle: ConstructorParameters<typeof OracleTransferPricer>[1];
  readonly logger: Logger;
  readonly clientFactory?: typeof createChainClient;
  readonly verifyRpcChainIds?: boolean;
  readonly now?: () => Date;
}): Promise<WhaleScannerRuntime> {
  const scannerClients = new Map<number, ReadOnlyChainClient>();
  const clientFactory = input.clientFactory ?? createChainClient;
  const plans: ScannerChainPlan[] = [];

  for (const chainId of input.config.enabledChains) {
    const chain = input.chainRegistry.get(chainId);
    if (!chain.scanner) {
      throw new Error(`scanner tuning is missing for enabled chain ${chainId}`);
    }
    const rpc = input.config.rpcByChain.get(chainId);
    if (!rpc) {
      throw new Error(`scanner RPC configuration is missing for chain ${chainId}`);
    }
    const existingClient = input.clients.get(chainId);
    if (!existingClient) {
      throw new Error(`scanner client is missing for chain ${chainId}`);
    }
    const scannerClient = rpc.archiveUrl
      ? clientFactory(chain, { url: rpc.archiveUrl })
      : existingClient;
    if (rpc.archiveUrl && input.verifyRpcChainIds !== false) {
      await assertClientChainId(scannerClient, chainId);
    }
    scannerClients.set(chainId, scannerClient);
    plans.push({
      chainId,
      tokens: input.tokenRegistry.entries(chainId),
      issuerProfile: chain.issuerProfile,
      initialChunkBlocks: BigInt(chain.scanner.initialChunkBlocks),
      reorgTailBlocks: BigInt(chain.scanner.reorgTailBlocks),
      headPollIntervalMs: chain.scanner.headPollIntervalMs,
    });
  }

  return new WhaleScannerRuntime({
    plans,
    source: new ViemTransferLogSource(scannerClients),
    store: input.store,
    pricer: new OracleTransferPricer(input.tokenRegistry, input.pricerOracle),
    whaleMinUsd: input.config.whaleMinUsd,
    maxBackfillHours: input.config.maxWhaleSinceHours,
    logger: input.logger,
    now: input.now,
  });
}

async function waitForAbortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
