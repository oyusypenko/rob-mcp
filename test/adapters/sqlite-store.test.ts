import { describe, expect, test } from "bun:test";
import { createSqliteWhaleStore } from "../../src/adapters/sqlite-whale-store";
import type { WhaleEvent } from "../../src/core/ports";

const token = "0x0000000000000000000000000000000000000010";

function event(block: bigint, logIndex = 0): WhaleEvent {
  return {
    chainId: 1,
    txHash: `0x${block.toString(16).padStart(64, "0")}`,
    block,
    logIndex,
    time: "2026-07-29T00:00:00.000Z",
    token,
    kind: "whale",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: "1",
    amountUsd: 125,
    oracleSource: "chainlink",
    oracleUpdatedAt: "2026-07-29T00:00:00.000Z",
    oracleAddress: "0x0000000000000000000000000000000000000030",
  };
}

describe("SQLite whale store", () => {
  test("atomically replaces reorg ranges and persists cursors", async () => {
    const store = await createSqliteWhaleStore(":memory:");
    try {
      await store.replaceRange({
        chainId: 1,
        token,
        fromBlock: 10n,
        throughBlock: 12n,
        events: [event(10n), event(12n)],
      });
      await store.replaceRange({
        chainId: 1,
        token,
        fromBlock: 11n,
        throughBlock: 13n,
        events: [event(13n)],
      });

      const result = await store.query({ chainId: 1, limit: 10 });
      expect(result.events.map(({ block }) => block)).toEqual([13n, 10n]);
      expect(result.scannedThrough).toBe(13n);
      expect(await store.getCursor(1, token)).toBe(13n);
    } finally {
      await store.close();
    }
  });
});
