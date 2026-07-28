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
  },
): Promise<DecodedTransferLog[]> {
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
    if (input.fromBlock === input.toBlock) {
      throw error;
    }
    const midpoint = (input.fromBlock + input.toBlock) / 2n;
    const [left, right] = await Promise.all([
      fetchLogsAdaptive(source, { ...input, toBlock: midpoint }),
      fetchLogsAdaptive(source, {
        ...input,
        fromBlock: midpoint + 1n,
      }),
    ]);
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

  const logs: DecodedTransferLog[] = [];
  for (
    let chunkFrom = fromBlock;
    chunkFrom <= input.throughBlock;
    chunkFrom += input.initialChunkBlocks
  ) {
    const chunkTo = minBigInt(input.throughBlock, chunkFrom + input.initialChunkBlocks - 1n);
    logs.push(
      ...(await fetchLogsAdaptive(input.source, {
        chainId: input.chainId,
        token: input.token.address,
        fromBlock: chunkFrom,
        toBlock: chunkTo,
      })),
    );
  }
  const events: WhaleEvent[] = [];

  for (const log of logs) {
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
    fromBlock,
    throughBlock: input.throughBlock,
    events,
  });
  return {
    fromBlock,
    throughBlock: input.throughBlock,
    events: events.length,
  };
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
