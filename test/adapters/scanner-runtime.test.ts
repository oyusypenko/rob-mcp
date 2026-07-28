import { describe, expect, test } from "bun:test";
import {
  findFirstBlockAtOrAfter,
  WhaleScannerRuntime,
  type TimestampedTransferLogSource,
} from "../../src/adapters/scanner-runtime";
import type { DecodedTransferLog, TransferPricer } from "../../src/core/ports";
import type { Logger } from "../../src/logger";
import { InMemoryWhaleStore, fixedClock } from "../fakes";

const token = {
  ticker: "TEST",
  name: "Test",
  address: "0x0000000000000000000000000000000000000010",
  decimals: 18,
  issuerProfile: "issuer",
  venues: [],
};

class ScriptedTimestampSource implements TimestampedTransferLogSource {
  readonly ranges: Array<[bigint, bigint]> = [];

  async getHead(): Promise<bigint> {
    return 10n;
  }

  async getBlockTimestamp(_chainId: number, blockNumber: bigint): Promise<Date> {
    return new Date(Number(blockNumber) * 1_000);
  }

  async getTransferLogs(input: {
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<DecodedTransferLog[]> {
    this.ranges.push([input.fromBlock, input.toBlock]);
    return [];
  }
}

const pricer: TransferPricer = {
  async price() {
    throw new Error("no logs should require pricing");
  },
};

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe("scanner runtime", () => {
  test("finds the first block at or after a time cutoff without block-time assumptions", async () => {
    const block = await findFirstBlockAtOrAfter({
      head: 10n,
      cutoff: new Date(4_500),
      getTimestamp: async (candidate) => new Date(Number(candidate) * 1_000),
    });
    expect(block).toBe(5n);
  });

  test("backfills every configured token and exposes chain lag state", async () => {
    const source = new ScriptedTimestampSource();
    const store = new InMemoryWhaleStore();
    const runtime = new WhaleScannerRuntime({
      plans: [
        {
          chainId: 1,
          tokens: [token],
          issuerProfile: {
            mintRedeem: { zeroAddress: true, participantAddresses: [] },
          },
          initialChunkBlocks: 4n,
          reorgTailBlocks: 2n,
          headPollIntervalMs: 1,
        },
      ],
      source,
      store,
      pricer,
      whaleMinUsd: 100,
      maxBackfillHours: 1 / 3600,
      logger,
      now: fixedClock("1970-01-01T00:00:10.000Z"),
    });

    await runtime.backfill();
    expect(await store.getCursor(1, token.address)).toBe(10n);
    expect(source.ranges).toEqual([[9n, 10n]]);
    expect(runtime.snapshot()).toMatchObject({
      available: true,
      running: false,
      lagBlocks: "0",
      chains: [
        {
          chainId: 1,
          status: "scanning",
          head: "10",
          scannedThrough: "10",
          lagBlocks: "0",
          error: null,
        },
      ],
    });
    await runtime.close();
  });

  test("head-follow stops cleanly through the injected abortable wait", async () => {
    const source = new ScriptedTimestampSource();
    const store = new InMemoryWhaleStore();
    let waiting = false;
    const runtime = new WhaleScannerRuntime({
      plans: [
        {
          chainId: 1,
          tokens: [token],
          issuerProfile: {
            mintRedeem: { zeroAddress: true, participantAddresses: [] },
          },
          initialChunkBlocks: 10n,
          reorgTailBlocks: 2n,
          headPollIntervalMs: 1,
        },
      ],
      source,
      store,
      pricer,
      whaleMinUsd: 100,
      maxBackfillHours: 1,
      logger,
      now: fixedClock("1970-01-01T00:00:10.000Z"),
      wait: async (_milliseconds, signal) => {
        waiting = true;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    });

    runtime.startFollowing();
    while (!waiting) {
      await Promise.resolve();
    }
    await runtime.close();
    expect(runtime.snapshot()).toMatchObject({
      running: false,
      chains: [{ status: "stopped" }],
    });
  });
});
