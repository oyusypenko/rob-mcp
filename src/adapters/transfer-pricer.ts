import { decimalMultiply, decimalToNumber } from "../core/decimal";
import type { OraclePort, TransferPricer } from "../core/ports";
import type { TokenRegistry } from "../registry/tokens";

export class OracleTransferPricer implements TransferPricer {
  constructor(
    private readonly tokens: TokenRegistry,
    private readonly oracle: OraclePort,
  ) {}

  async price(input: {
    readonly chainId: number;
    readonly ticker: string;
    readonly tokenAddress: string;
    readonly tokenAmount: string;
  }) {
    const token = this.tokens.resolve(input.chainId, input.tokenAddress);
    const price = await this.oracle.getPrice({
      chainId: input.chainId,
      ticker: input.ticker,
      tokenAddress: input.tokenAddress,
      feed: token.feed,
      feedHeartbeatSeconds: token.feedHeartbeatSeconds,
    });
    return {
      amountUsd: decimalToNumber(decimalMultiply(input.tokenAmount, price.priceUsd.toString())),
      oracleSource: price.oracleSource,
      oracleUpdatedAt: price.oracleUpdatedAt,
      ...(price.oracleAddress ? { oracleAddress: price.oracleAddress } : {}),
      ...(price.provider ? { oracleProvider: price.provider } : {}),
    };
  }
}
