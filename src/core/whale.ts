export type TransferKind = "mint" | "redeem" | "ap-flow" | "whale" | "transfer";

const zeroAddress = "0x0000000000000000000000000000000000000000";

export interface IssuerClassificationProfile {
  readonly mintRedeem: {
    readonly zeroAddress: boolean;
    readonly participantAddresses: readonly string[];
  };
}

export function classifyTransfer(input: {
  readonly from: string;
  readonly to: string;
  readonly amountUsd: number;
  readonly whaleMinUsd: number;
  readonly issuerProfile: IssuerClassificationProfile;
}): TransferKind {
  if (
    !Number.isFinite(input.amountUsd) ||
    input.amountUsd < 0 ||
    !Number.isFinite(input.whaleMinUsd) ||
    input.whaleMinUsd <= 0
  ) {
    throw new Error("transfer classification requires valid USD amounts");
  }

  const from = input.from.toLowerCase();
  const to = input.to.toLowerCase();
  if (input.issuerProfile.mintRedeem.zeroAddress && from === zeroAddress) {
    return "mint";
  }
  if (input.issuerProfile.mintRedeem.zeroAddress && to === zeroAddress) {
    return "redeem";
  }

  const participants = new Set(
    input.issuerProfile.mintRedeem.participantAddresses.map((address) => address.toLowerCase()),
  );
  if (participants.has(from) || participants.has(to)) {
    return "ap-flow";
  }
  return input.amountUsd >= input.whaleMinUsd ? "whale" : "transfer";
}
