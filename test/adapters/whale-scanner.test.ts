import { describe, expect, test } from "bun:test";
import type { DecodedTransferLog, TransferLogSource, TransferPricer } from "../../src/core/ports";
import { fetchLogsAdaptive, scanTokenRange } from "../../src/adapters/whale-scanner";
import { InMemoryWhaleStore } from "../fakes";

const token = "0x0000000000000000000000000000000000000010";
const from = "0x0000000000000000000000000000000000000001";
const to = "0x0000000000000000000000000000000000000002";

class SplittingSource implements TransferLogSource {
  readonly calls: Array<[bigint, bigint]> = [];

  async getHead(): Promise<bigint> {
    return 8n;
  }

  async getTransferLogs(input: {
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<DecodedTransferLog[]> {
    this.calls.push([input.fromBlock, input.toBlock]);
    if (input.toBlock - input.fromBlock + 1n > 2n) {
      throw new Error("provider range limit");
    }
    return [
      {
        token,
        block: input.fromBlock,
        logIndex: 0,
        txHash: `0x${input.fromBlock.toString(16).padStart(64, "0")}`,
        from,
        to,
        amount: 10n ** 18n,
        time: "2026-07-29T00:00:00.000Z",
      },
    ];
  }
}

const pricer: TransferPricer = {
  async price() {
    return {
      amountUsd: 125,
      oracleSource: "chainlink",
      oracleUpdatedAt: "2026-07-29T00:00:00.000Z",
      oracleAddress: "0x0000000000000000000000000000000000000030",
    };
  },
};

describe("whale scanner", () => {
  test("adaptively splits provider-limited eth_getLogs ranges", async () => {
    const source = new SplittingSource();
    const logs = await fetchLogsAdaptive(source, {
      chainId: 1,
      token,
      fromBlock: 1n,
      toBlock: 8n,
    });

    expect(logs).toHaveLength(4);
    expect(source.calls).toContainEqual([1n, 8n]);
    expect(source.calls).toContainEqual([1n, 2n]);
  });

  test("replaces the reorg tail and persists the resume cursor atomically", async () => {
    const source = new SplittingSource();
    const store = new InMemoryWhaleStore();
    store.cursors.set(`1:${token}`, 5n);

    const result = await scanTokenRange({
      chainId: 1,
      token: {
        ticker: "TEST",
        name: "Test",
        address: token,
        decimals: 18,
        issuerProfile: "issuer",
        venues: [],
      },
      issuerProfile: {
        mintRedeem: { zeroAddress: true, participantAddresses: [] },
      },
      source,
      store,
      pricer,
      whaleMinUsd: 100,
      initialChunkBlocks: 5n,
      initialBlock: 1n,
      throughBlock: 8n,
      reorgTailBlocks: 2n,
    });

    expect(result.fromBlock).toBe(4n);
    expect(result.throughBlock).toBe(8n);
    expect(await store.getCursor(1, token)).toBe(8n);
    expect(store.events.every((event) => event.amountUsd === 125)).toBe(true);
  });
});
