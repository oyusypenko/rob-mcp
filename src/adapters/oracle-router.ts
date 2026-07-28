import type { OraclePort, OraclePrice } from "../core/ports";

export class OracleRouter implements OraclePort {
  constructor(
    private readonly chainlink: OraclePort,
    private readonly fallback: OraclePort,
  ) {}

  getPrice(input: {
    readonly chainId: number;
    readonly ticker: string;
    readonly tokenAddress: string;
    readonly feed?: string;
    readonly feedHeartbeatSeconds?: number;
  }): Promise<OraclePrice> {
    return input.feed ? this.chainlink.getPrice(input) : this.fallback.getPrice(input);
  }
}
