import { getAddress, type PublicClient } from "viem";
import { aggregatorV3Abi } from "../chain/abi";
import { assertSequencerUsable, validateOracleRound, type SequencerRound } from "../core/oracle";
import type { OraclePort, OraclePrice } from "../core/ports";
import { decimalToNumber } from "../core/decimal";
import type { ChainRegistry } from "../registry/chains";

export interface ChainlinkReader {
  readRound(
    chainId: number,
    address: string,
  ): Promise<{
    readonly decimals: number;
    readonly answer: bigint;
    readonly updatedAt: bigint;
  }>;
  readSequencerRound(chainId: number, address: string): Promise<SequencerRound>;
}

export class ViemChainlinkReader implements ChainlinkReader {
  constructor(private readonly clients: ReadonlyMap<number, PublicClient>) {}

  async readRound(
    chainId: number,
    address: string,
  ): Promise<{
    decimals: number;
    answer: bigint;
    updatedAt: bigint;
  }> {
    const client = this.client(chainId);
    const [decimals, round] = await Promise.all([
      client.readContract({
        address: getAddress(address),
        abi: aggregatorV3Abi,
        functionName: "decimals",
      }),
      client.readContract({
        address: getAddress(address),
        abi: aggregatorV3Abi,
        functionName: "latestRoundData",
      }),
    ]);
    return {
      decimals,
      answer: round[1],
      updatedAt: round[3],
    };
  }

  async readSequencerRound(chainId: number, address: string): Promise<SequencerRound> {
    const round = await this.client(chainId).readContract({
      address: getAddress(address),
      abi: aggregatorV3Abi,
      functionName: "latestRoundData",
    });
    return { answer: round[1], startedAt: round[2] };
  }

  private client(chainId: number): PublicClient {
    const client = this.clients.get(chainId);
    if (!client) {
      throw new Error(`no Chainlink client for chain ${chainId}`);
    }
    return client;
  }
}

export class ChainlinkOracleAdapter implements OraclePort {
  private readonly chains: ChainRegistry;
  private readonly reader: ChainlinkReader;
  private readonly sequencerGracePeriodSeconds?: number;
  private readonly now: () => Date;

  constructor(input: {
    readonly chains: ChainRegistry;
    readonly reader: ChainlinkReader;
    readonly sequencerGracePeriodSeconds?: number;
    readonly now?: () => Date;
  }) {
    this.chains = input.chains;
    this.reader = input.reader;
    this.sequencerGracePeriodSeconds = input.sequencerGracePeriodSeconds;
    this.now = input.now ?? (() => new Date());
  }

  async assertChainSequencerUsable(chainId: number): Promise<true> {
    const oracle = this.chains.get(chainId).oracle;
    if (!oracle.requiresSequencerUptime) {
      return true;
    }
    if (!oracle.sequencerUptimeFeed) {
      return assertSequencerUsable({
        required: true,
        round: undefined,
        gracePeriodSeconds: 0,
        now: this.now,
      });
    }
    if (this.sequencerGracePeriodSeconds === undefined) {
      return assertSequencerUsable({
        required: true,
        round: undefined,
        gracePeriodSeconds: 0,
        now: this.now,
      });
    }
    const round = await this.reader.readSequencerRound(chainId, oracle.sequencerUptimeFeed);
    return assertSequencerUsable({
      required: true,
      round,
      gracePeriodSeconds: this.sequencerGracePeriodSeconds,
      now: this.now,
    });
  }

  async getPrice(input: {
    chainId: number;
    ticker: string;
    tokenAddress: string;
    feed?: string;
    feedHeartbeatSeconds?: number;
  }): Promise<OraclePrice> {
    await this.assertChainSequencerUsable(input.chainId);
    if (!input.feed || input.feedHeartbeatSeconds === undefined) {
      throw new Error(`no Chainlink feed configured for ${input.ticker}`);
    }
    const round = await this.reader.readRound(input.chainId, input.feed);
    const validated = validateOracleRound({
      chainId: input.chainId,
      feedAddress: input.feed,
      decimals: round.decimals,
      answer: round.answer,
      updatedAt: round.updatedAt,
      maxAgeSeconds: input.feedHeartbeatSeconds,
      now: this.now,
    });
    return {
      chainId: input.chainId,
      priceUsd: decimalToNumber(validated.priceUsd),
      oracleSource: "chainlink",
      oracleUpdatedAt: validated.oracleUpdatedAt,
      oracleAddress: input.feed,
      oraclePaused: false,
      sequencerOk: true,
    };
  }
}
