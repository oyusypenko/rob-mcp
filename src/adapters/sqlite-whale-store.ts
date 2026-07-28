import type { WhaleEvent, WhaleQuery, WhaleStore } from "../core/ports";

interface Statement {
  run(bindings?: Record<string, unknown>): unknown;
  get(bindings?: Record<string, unknown>): unknown;
  all(bindings?: Record<string, unknown>): unknown[];
}

interface SqliteDatabase {
  run(sql: string): unknown;
  prepare(sql: string): Statement;
  transaction<T extends (...args: never[]) => unknown>(
    callback: T,
  ): T & {
    immediate: T;
  };
  close(throwOnError?: boolean): void;
}

interface EventRow {
  chainId: bigint;
  txHash: string;
  block: bigint;
  logIndex: bigint;
  blockTimestamp: string;
  token: string;
  kind: WhaleEvent["kind"];
  from: string;
  to: string;
  amount: string;
  amountUsd: number;
  oracleSource: WhaleEvent["oracleSource"];
  oracleUpdatedAt: string;
  oracleAddress: string | null;
  oracleProvider: string | null;
}

export class SqliteWhaleStore implements WhaleStore {
  private readonly getCursorStatement: Statement;
  private readonly deleteRangeStatement: Statement;
  private readonly insertEventStatement: Statement;
  private readonly upsertCursorStatement: Statement;
  private readonly queryStatement: Statement;
  private readonly scannedThroughStatement: Statement;
  private readonly replaceTransaction: (input: {
    chainId: number;
    token: string;
    fromBlock: bigint;
    throughBlock: bigint;
    events: readonly WhaleEvent[];
  }) => void;

  constructor(private readonly database: SqliteDatabase) {
    database.run("PRAGMA journal_mode = WAL;");
    database.run(`
      CREATE TABLE IF NOT EXISTS events (
        chainId INTEGER NOT NULL,
        token TEXT NOT NULL,
        block INTEGER NOT NULL,
        logIndex INTEGER NOT NULL,
        blockTimestamp TEXT NOT NULL,
        kind TEXT NOT NULL,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        amount TEXT NOT NULL,
        amountUsd REAL NOT NULL,
        txHash TEXT NOT NULL,
        oracleSource TEXT NOT NULL,
        oracleUpdatedAt TEXT NOT NULL,
        oracleAddress TEXT,
        oracleProvider TEXT,
        PRIMARY KEY(chainId, txHash, logIndex)
      );
      CREATE INDEX IF NOT EXISTS events_query
        ON events(chainId, token, block DESC, logIndex DESC);
      CREATE TABLE IF NOT EXISTS cursor (
        chainId INTEGER NOT NULL,
        token TEXT NOT NULL,
        lastBlock INTEGER NOT NULL,
        PRIMARY KEY(chainId, token)
      );
    `);
    this.getCursorStatement = database.prepare(
      "SELECT lastBlock FROM cursor WHERE chainId = $chainId AND token = $token",
    );
    this.deleteRangeStatement = database.prepare(
      "DELETE FROM events WHERE chainId = $chainId AND token = $token AND block >= $fromBlock",
    );
    this.insertEventStatement = database.prepare(`
      INSERT OR REPLACE INTO events (
        chainId, token, block, blockTimestamp, logIndex, kind, "from", "to",
        amount, amountUsd, txHash, oracleSource, oracleUpdatedAt, oracleAddress,
        oracleProvider
      ) VALUES (
        $chainId, $token, $block, $blockTimestamp, $logIndex, $kind, $from, $to,
        $amount, $amountUsd, $txHash, $oracleSource, $oracleUpdatedAt, $oracleAddress,
        $oracleProvider
      )
    `);
    this.upsertCursorStatement = database.prepare(`
      INSERT INTO cursor(chainId, token, lastBlock)
      VALUES ($chainId, $token, $lastBlock)
      ON CONFLICT(chainId, token) DO UPDATE SET lastBlock = excluded.lastBlock
    `);
    this.queryStatement = database.prepare(`
      SELECT chainId, txHash, block, blockTimestamp, logIndex, token, kind,
             "from", "to", amount, amountUsd,
             oracleSource, oracleUpdatedAt, oracleAddress, oracleProvider
      FROM events
      WHERE chainId = $chainId
        AND ($token IS NULL OR token = $token)
        AND ($kind IS NULL OR kind = $kind)
        AND ($minUsd IS NULL OR amountUsd >= $minUsd)
        AND ($since IS NULL OR blockTimestamp >= $since)
      ORDER BY block DESC, logIndex DESC
      LIMIT $limit
    `);
    this.scannedThroughStatement = database.prepare(`
      SELECT MIN(lastBlock) AS scannedThrough
      FROM cursor
      WHERE chainId = $chainId AND ($token IS NULL OR token = $token)
    `);

    const transaction = database.transaction(
      (input: {
        chainId: number;
        token: string;
        fromBlock: bigint;
        throughBlock: bigint;
        events: readonly WhaleEvent[];
      }) => {
        const token = input.token.toLowerCase();
        this.deleteRangeStatement.run({
          chainId: input.chainId,
          token,
          fromBlock: input.fromBlock,
        });
        for (const event of input.events) {
          this.insertEventStatement.run({
            chainId: event.chainId,
            token: event.token.toLowerCase(),
            block: event.block,
            logIndex: event.logIndex,
            blockTimestamp: event.time,
            kind: event.kind,
            from: event.from.toLowerCase(),
            to: event.to.toLowerCase(),
            amount: event.amount,
            amountUsd: event.amountUsd,
            txHash: event.txHash.toLowerCase(),
            oracleSource: event.oracleSource,
            oracleUpdatedAt: event.oracleUpdatedAt,
            oracleAddress: event.oracleAddress?.toLowerCase() ?? null,
            oracleProvider: event.oracleProvider ?? null,
          });
        }
        this.upsertCursorStatement.run({
          chainId: input.chainId,
          token,
          lastBlock: input.throughBlock,
        });
      },
    );
    this.replaceTransaction = transaction.immediate;
  }

  async getCursor(chainId: number, token: string): Promise<bigint | undefined> {
    const row = this.getCursorStatement.get({
      chainId,
      token: token.toLowerCase(),
    }) as { lastBlock: bigint } | undefined;
    return row?.lastBlock;
  }

  async replaceRange(input: {
    chainId: number;
    token: string;
    fromBlock: bigint;
    throughBlock: bigint;
    events: readonly WhaleEvent[];
  }): Promise<void> {
    this.replaceTransaction(input);
  }

  async query(input: WhaleQuery): Promise<{
    events: WhaleEvent[];
    scannedThrough: bigint | undefined;
  }> {
    const bindings = {
      chainId: input.chainId,
      token: input.token?.toLowerCase() ?? null,
      kind: input.kind ?? null,
      minUsd: input.minUsd ?? null,
      since: input.since?.toISOString() ?? null,
      limit: input.limit,
    };
    const rows = this.queryStatement.all(bindings) as EventRow[];
    const cursor = this.scannedThroughStatement.get(bindings) as
      { scannedThrough: bigint | null } | undefined;
    return {
      events: rows.map((row) => ({
        chainId: Number(row.chainId),
        txHash: row.txHash,
        block: row.block,
        logIndex: Number(row.logIndex),
        time: row.blockTimestamp,
        token: row.token,
        kind: row.kind,
        from: row.from,
        to: row.to,
        amount: row.amount,
        amountUsd: row.amountUsd,
        oracleSource: row.oracleSource,
        oracleUpdatedAt: row.oracleUpdatedAt,
        ...(row.oracleAddress ? { oracleAddress: row.oracleAddress } : {}),
        ...(row.oracleProvider ? { oracleProvider: row.oracleProvider } : {}),
      })),
      scannedThrough: cursor?.scannedThrough ?? undefined,
    };
  }

  async close(): Promise<void> {
    this.database.close(false);
  }
}

export async function createSqliteWhaleStore(path: string): Promise<SqliteWhaleStore> {
  // Deliberately guarded: importing the stdio MCP on plain Node must not resolve
  // Bun's native module unless scan/serve mode actually asks for the store.
  const { Database } = await import("bun:sqlite");
  const database = new Database(path, {
    create: true,
    strict: true,
    safeIntegers: true,
  });
  return new SqliteWhaleStore(database as unknown as SqliteDatabase);
}
