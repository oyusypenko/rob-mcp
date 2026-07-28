import { getAddress, parseAbiItem, type PublicClient } from "viem";
import type { DecodedTransferLog, TransferLogSource } from "../core/ports";

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export class ViemTransferLogSource implements TransferLogSource {
  constructor(private readonly clients: ReadonlyMap<number, PublicClient>) {}

  async getHead(chainId: number): Promise<bigint> {
    return this.client(chainId).getBlockNumber();
  }

  async getTransferLogs(input: {
    chainId: number;
    token: string;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<DecodedTransferLog[]> {
    const client = this.client(input.chainId);
    const logs = await client.getLogs({
      address: getAddress(input.token),
      event: transferEvent,
      fromBlock: input.fromBlock,
      toBlock: input.toBlock,
      strict: true,
    });
    const uniqueBlocks = [...new Set(logs.map(({ blockNumber }) => blockNumber))];
    const timestamps = new Map(
      await Promise.all(
        uniqueBlocks.map(async (blockNumber) => {
          const block = await client.getBlock({ blockNumber });
          return [blockNumber, new Date(Number(block.timestamp) * 1_000).toISOString()] as const;
        }),
      ),
    );

    return logs.map((log) => ({
      token: log.address,
      block: log.blockNumber,
      logIndex: log.logIndex,
      txHash: log.transactionHash,
      from: log.args.from,
      to: log.args.to,
      amount: log.args.value,
      time: timestamps.get(log.blockNumber)!,
    }));
  }

  private client(chainId: number): PublicClient {
    const client = this.clients.get(chainId);
    if (!client) {
      throw new Error(`no transfer-log client for chain ${chainId}`);
    }
    return client;
  }
}
