import { z } from "zod";

export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected an EVM address");

export const issuerProfileSchema = z.strictObject({
  id: z.string().min(1),
  tokenStandard: z.enum(["erc20", "erc8056"]),
  multiplier: z.strictObject({
    kind: z.enum(["none", "erc8056-ui-multiplier"]),
    feedIncludesMultiplier: z.boolean(),
  }),
  mintRedeem: z.strictObject({
    zeroAddress: z.boolean(),
    participantAddresses: z.array(addressSchema),
  }),
});

export type IssuerProfile = z.infer<typeof issuerProfileSchema>;

export function issuerParticipantSet(profile: IssuerProfile): ReadonlySet<string> {
  return new Set(profile.mintRedeem.participantAddresses.map((address) => address.toLowerCase()));
}
