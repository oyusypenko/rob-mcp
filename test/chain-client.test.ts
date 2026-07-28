import { describe, expect, test } from "bun:test";
import { assertClientChainId } from "../src/chain/client";
import { ScriptedChainIdReader } from "./fakes";

describe("assertClientChainId", () => {
  test("accepts the configured chain", async () => {
    const reader = new ScriptedChainIdReader(4663);
    await expect(assertClientChainId(reader, 4663)).resolves.toBeUndefined();
    expect(reader.calls).toEqual(["getChainId"]);
  });

  test("rejects a mismatched RPC before startup completes", async () => {
    const reader = new ScriptedChainIdReader(42161);
    await expect(assertClientChainId(reader, 4663)).rejects.toThrow(
      "expected chain 4663, received 42161",
    );
  });
});
