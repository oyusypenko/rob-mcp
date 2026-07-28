import type { ChainIdReader } from "../src/chain/client";
import type { WhaleEvent, WhaleQuery, WhaleStore } from "../src/core/ports";

export class ScriptedChainIdReader implements ChainIdReader {
  readonly calls: string[] = [];

  constructor(private readonly result: number | Error) {}

  async getChainId(): Promise<number> {
    this.calls.push("getChainId");
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

export const fixedClock = (iso: string): (() => Date) => {
  const value = new Date(iso);
  return () => new Date(value);
};

export class InMemoryWhaleStore implements WhaleStore {
  readonly events: WhaleEvent[] = [];
  readonly cursors = new Map<string, bigint>();

  async getCursor(chainId: number, token: string): Promise<bigint | undefined> {
    return this.cursors.get(`${chainId}:${token.toLowerCase()}`);
  }

  async replaceRange(input: {
    chainId: number;
    token: string;
    fromBlock: bigint;
    throughBlock: bigint;
    events: readonly WhaleEvent[];
  }): Promise<void> {
    const token = input.token.toLowerCase();
    const retained = this.events.filter(
      (event) =>
        event.chainId !== input.chainId ||
        event.token.toLowerCase() !== token ||
        event.block < input.fromBlock,
    );
    this.events.splice(0, this.events.length, ...retained, ...input.events);
    this.cursors.set(`${input.chainId}:${token}`, input.throughBlock);
  }

  async query(input: WhaleQuery): Promise<{
    events: WhaleEvent[];
    scannedThrough: bigint | undefined;
  }> {
    const events = this.events.filter(
      (event) =>
        event.chainId === input.chainId &&
        (!input.token || event.token.toLowerCase() === input.token.toLowerCase()) &&
        (!input.kind || event.kind === input.kind) &&
        (!input.minUsd || event.amountUsd >= input.minUsd) &&
        (!input.since || new Date(event.time) >= input.since),
    );
    const cursors = [...this.cursors.entries()]
      .filter(([key]) => key.startsWith(`${input.chainId}:`))
      .map(([, cursor]) => cursor);
    return {
      events: events.slice(0, input.limit),
      scannedThrough:
        cursors.length === 0
          ? undefined
          : cursors.reduce((lowest, cursor) => (cursor < lowest ? cursor : lowest)),
    };
  }

  async close(): Promise<void> {}
}
