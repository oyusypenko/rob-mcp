const evmAddressPattern = /^0x[0-9a-fA-F]{40}$/;
const bytecodePattern = /^0x[0-9a-fA-F]+$/;

export interface DiscoveredPoolIdentity {
  readonly pool: string;
  readonly bytecode: string | undefined;
  readonly factory: string;
  readonly token0: string;
  readonly token1: string;
  readonly feeTier?: number;
}

export interface ExpectedPoolIdentity {
  readonly factory: string;
  readonly tokenA: string;
  readonly tokenB: string;
  readonly feeTier?: number;
}

export function assertDiscoveredPoolIdentity(
  observed: DiscoveredPoolIdentity,
  expected: ExpectedPoolIdentity,
): void {
  const pool = normalizedAddress(observed.pool, "pool");
  const bytecode = observed.bytecode?.toLowerCase();
  if (!bytecode || bytecode === "0x" || !bytecodePattern.test(bytecode)) {
    throw new Error(`discovered pool ${pool} has no deployed bytecode`);
  }

  if (
    normalizedAddress(observed.factory, "observed factory") !==
    normalizedAddress(expected.factory, "expected factory")
  ) {
    throw new Error(`discovered pool ${pool} reports a different factory`);
  }

  const expectedTokens = [
    normalizedAddress(expected.tokenA, "expected token A"),
    normalizedAddress(expected.tokenB, "expected token B"),
  ].sort();
  const observedTokens = [
    normalizedAddress(observed.token0, "observed token0"),
    normalizedAddress(observed.token1, "observed token1"),
  ];
  if (
    observedTokens[0] !== expectedTokens[0] ||
    observedTokens[1] !== expectedTokens[1] ||
    observedTokens[0]! >= observedTokens[1]!
  ) {
    throw new Error(`discovered pool ${pool} reports an invalid token ordering`);
  }

  if (expected.feeTier === undefined) {
    if (observed.feeTier !== undefined) {
      throw new Error(`discovered v2 pool ${pool} unexpectedly reports a fee tier`);
    }
    return;
  }
  if (!Number.isSafeInteger(observed.feeTier) || observed.feeTier !== expected.feeTier) {
    throw new Error(`discovered pool ${pool} reports a different fee tier`);
  }
}

function normalizedAddress(address: string, label: string): string {
  if (!evmAddressPattern.test(address)) {
    throw new Error(`${label} is not an EVM address`);
  }
  return address.toLowerCase();
}
