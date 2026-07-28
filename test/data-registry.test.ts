import { expect, test } from "bun:test";
import { loadChainRegistry } from "../src/registry/chains";

test("checked-in 4663 issuer profile includes the verified ForwarderV4 participant", async () => {
  const registry = await loadChainRegistry("data/chains.json");
  expect(
    registry
      .get(4663)
      .issuerProfile.mintRedeem.participantAddresses.map((address) => address.toLowerCase()),
  ).toContain("0xcfaece2151502da2a21d47234ae1f08618a60a94");
});
