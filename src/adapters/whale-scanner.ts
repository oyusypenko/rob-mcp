import type {
  DecodedTransferLog,
  TransferLogSource,
  TransferPricer,
  WhaleEvent,
  WhaleStore,
} from "../core/ports";
import { classifyTransfer, type IssuerClassificationProfile } from "../core/whale";
import type { TokenConfig } from "../registry/tokens";

export async function fetchLogsAdaptive(
  source: TransferLogSource,
  input: {
    readonly chainId: number;
    readonly token: string;
    readonly fromBlock: bigint;
    readonly toBlock: bigint;
    readonly signal?: AbortSignal;
  },
): Promise<DecodedTransferLog[]> {
  input.signal?.throwIfAborted();
  if (input.fromBlock > input.toBlock) {
    return [];
  }
  try {
    return [
      ...(await source.getTransferLogs({
        chainId: input.chainId,
        token: input.token,
        fromBlock: input.fromBlock,
        toBlock: input.toBlock,
      })),
    ];
  } catch (error) {
    if (
      input.fromBlock === input.toBlock ||
      !isProviderRangeLimitError(error) ||
      input.signal?.aborted
    ) {
      throw error;
    }
    const midpoint = (input.fromBlock + input.toBlock) / 2n;
    const left = await fetchLogsAdaptive(source, { ...input, toBlock: midpoint });
    const right = await fetchLogsAdaptive(source, {
      ...input,
      fromBlock: midpoint + 1n,
    });
    return [...left, ...right];
  }
}

export async function scanTokenRange(input: {
  readonly chainId: number;
  readonly token: TokenConfig;
  readonly issuerProfile: IssuerClassificationProfile;
  readonly source: TransferLogSource;
  readonly store: WhaleStore;
  readonly pricer: TransferPricer;
  readonly whaleMinUsd: number;
  readonly initialChunkBlocks: bigint;
  readonly initialBlock: bigint;
  readonly throughBlock: bigint;
  readonly reorgTailBlocks: bigint;
  readonly signal?: AbortSignal;
}): Promise<{
  readonly fromBlock: bigint;
  readonly throughBlock: bigint;
  readonly events: number;
}> {
  if (input.initialBlock < 0n || input.initialChunkBlocks < 1n || input.reorgTailBlocks < 1n) {
    throw new Error("scanner block options are invalid");
  }
  const cursor = await input.store.getCursor(input.chainId, input.token.address);
  const fromBlock =
    cursor === undefined
      ? input.initialBlock
      : maxBigInt(input.initialBlock, cursor - input.reorgTailBlocks + 1n);
  if (fromBlock > input.throughBlock) {
    return { fromBlock, throughBlock: input.throughBlock, events: 0 };
  }

  let eventCount = 0;
  for (
    let chunkFrom = fromBlock;
    chunkFrom <= input.throughBlock;
    chunkFrom += input.initialChunkBlocks
  ) {
    input.signal?.throwIfAborted();
    const chunkTo = minBigInt(input.throughBlock, chunkFrom + input.initialChunkBlocks - 1n);
    const logs = await fetchLogsAdaptive(input.source, {
      chainId: input.chainId,
      token: input.token.address,
      fromBlock: chunkFrom,
      toBlock: chunkTo,
      signal: input.signal,
    });
    const events: WhaleEvent[] = [];

    for (const log of logs) {
      input.signal?.throwIfAborted();
      const amount = formatTokenAmount(log.amount, input.token.decimals);
      const priced = await input.pricer.price({
        chainId: input.chainId,
        ticker: input.token.ticker,
        tokenAddress: input.token.address,
        tokenAmount: amount,
      });
      events.push({
        chainId: input.chainId,
        txHash: log.txHash,
        block: log.block,
        logIndex: log.logIndex,
        time: log.time,
        token: input.token.address,
        kind: classifyTransfer({
          from: log.from,
          to: log.to,
          amountUsd: priced.amountUsd,
          whaleMinUsd: input.whaleMinUsd,
          issuerProfile: input.issuerProfile,
        }),
        from: log.from,
        to: log.to,
        amount,
        ...priced,
      });
    }

    await input.store.replaceRange({
      chainId: input.chainId,
      token: input.token.address,
      fromBlock: chunkFrom,
      throughBlock: chunkTo,
      events,
    });
    eventCount += events.length;
  }

  return {
    fromBlock,
    throughBlock: input.throughBlock,
    events: eventCount,
  };
}

export function isProviderRangeLimitError(error: unknown): boolean {
  const pending: unknown[] = [error];
  const visited = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || current === null || visited.has(current)) {
      continue;
    }
    visited.add(current);
    if (typeof current === "string") {
      if (
        /(block|query|response|result|log).{0,32}(range|limit|large|many|size)|range.{0,32}(limit|large)|more than.{0,16}(result|log)/i.test(
          current,
        )
      ) {
        return true;
      }
      continue;
    }
    if (typeof current !== "object") {
      continue;
    }
    const record = current as Record<string, unknown>;
    if (record.code === -32005) {
      return true;
    }
    if (record.message !== undefined) pending.push(record.message);
    if (record.shortMessage !== undefined) pending.push(record.shortMessage);
    if (record.details !== undefined) pending.push(record.details);
    if (record.cause !== undefined) pending.push(record.cause);
  }
  return false;
}

function formatTokenAmount(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("token decimals are invalid");
  }
  if (decimals === 0) {
    return value.toString();
  }
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fractional = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole.toString();
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
