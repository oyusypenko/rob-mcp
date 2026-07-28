import type { TransferKind } from "./whale";

export interface OraclePrice {
  readonly chainId: number;
  readonly priceUsd: number;
  readonly oracleSource: "chainlink" | "fallback";
  readonly oracleUpdatedAt: string;
  readonly oracleAddress?: string;
  readonly provider?: string;
  readonly multiplier?: string;
  readonly multiplierUpdatedAt?: string;
  readonly oraclePaused: false;
  readonly sequencerOk: true;
}

export interface OraclePort {
  getPrice(input: {
    readonly chainId: number;
    readonly ticker: string;
    readonly tokenAddress: string;
    readonly feed?: string;
    readonly feedHeartbeatSeconds?: number;
  }): Promise<OraclePrice>;
}

export type DexVenue = "univ2" | "univ3";

export interface DexQuote {
  readonly chainId: number;
  readonly venue: DexVenue;
  readonly pool: string;
  readonly feeTier?: number;
  readonly effectivePriceUsd: number;
  readonly priceImpactBps: number;
  readonly observedAt: string;
  readonly quoteToken: string;
  readonly oracleSource: "chainlink" | "fallback";
  readonly oracleUpdatedAt: string;
  readonly oracleAddress?: string;
  readonly oraclePaused: false;
  readonly sequencerOk: true;
}

export interface DexLiquidity {
  readonly chainId: number;
  readonly venue: DexVenue;
  readonly pool: string;
  readonly feeTier?: number;
  readonly tvlToken: number;
  readonly tvlQuote: number;
  readonly buyDepthUsd: number;
  readonly sellDepthUsd: number;
  readonly spreadBps: number;
  readonly observedAt: string;
  readonly quoteToken: string;
  readonly oracleSource: "chainlink" | "fallback";
  readonly oracleUpdatedAt: string;
  readonly oracleAddress?: string;
  readonly oraclePaused: false;
  readonly sequencerOk: true;
}

export interface DexPort {
  readonly venue: DexVenue;
  quote(input: {
    readonly chainId: number;
    readonly tokenAddress: string;
    readonly side: "buy" | "sell";
    readonly amountUsd: number;
    readonly referencePriceUsd: number;
  }): Promise<readonly DexQuote[]>;
  liquidity(input: {
    readonly chainId: number;
    readonly tokenAddress: string;
    readonly depthPct: 1 | 2 | 5;
  }): Promise<readonly DexLiquidity[]>;
}

export interface DexRegistryPort {
  quote(input: {
    readonly chainId: number;
    readonly tokenAddress: string;
    readonly side: "buy" | "sell";
    readonly amountUsd: number;
    readonly referencePriceUsd: number;
    readonly venue: DexVenue | "best";
  }): Promise<readonly DexQuote[]>;
  liquidity(input: {
    readonly chainId: number;
    readonly tokenAddress: string;
    readonly depthPct: 1 | 2 | 5;
  }): Promise<readonly DexLiquidity[]>;
}

export interface WhaleEvent {
  readonly chainId: number;
  readonly txHash: string;
  readonly block: bigint;
  readonly logIndex: number;
  readonly time: string;
  readonly token: string;
  readonly kind: TransferKind;
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly amountUsd: number;
  readonly oracleSource: "chainlink" | "fallback";
  readonly oracleUpdatedAt: string;
  readonly oracleAddress?: string;
  readonly oracleProvider?: string;
}

export interface WhaleQuery {
  readonly chainId: number;
  readonly token?: string;
  readonly minUsd?: number;
  readonly since?: Date;
  readonly kind?: TransferKind;
  readonly limit: number;
}

export interface WhaleStore {
  getCursor(chainId: number, token: string): Promise<bigint | undefined>;
  replaceRange(input: {
    readonly chainId: number;
    readonly token: string;
    readonly fromBlock: bigint;
    readonly throughBlock: bigint;
    readonly events: readonly WhaleEvent[];
  }): Promise<void>;
  query(input: WhaleQuery): Promise<{
    readonly events: readonly WhaleEvent[];
    readonly scannedThrough: bigint | undefined;
  }>;
  close(): Promise<void>;
}

export interface DecodedTransferLog {
  readonly token: string;
  readonly block: bigint;
  readonly logIndex: number;
  readonly txHash: string;
  readonly from: string;
  readonly to: string;
  readonly amount: bigint;
  readonly time: string;
}

export interface TransferLogSource {
  getHead(chainId: number): Promise<bigint>;
  getTransferLogs(input: {
    readonly chainId: number;
    readonly token: string;
    readonly fromBlock: bigint;
    readonly toBlock: bigint;
  }): Promise<readonly DecodedTransferLog[]>;
}

export interface TransferPricer {
  price(input: {
    readonly chainId: number;
    readonly ticker: string;
    readonly tokenAddress: string;
    readonly tokenAmount: string;
  }): Promise<{
    readonly amountUsd: number;
    readonly oracleSource: "chainlink" | "fallback";
    readonly oracleUpdatedAt: string;
    readonly oracleAddress?: string;
    readonly oracleProvider?: string;
  }>;
}
