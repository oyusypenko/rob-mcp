import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { x402ResourceServer } from "@x402/core/server";
import type { RoutesConfig } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";

import type { Deps } from "../src/deps.js";
import { createHttpApp } from "../src/http/app.js";
import { createFreeCallLimiter } from "../src/http/rate-limit.js";
import { PaymentReplayGuard } from "../src/http/payment-replay.js";
import { BASE_SEPOLIA, type PaymentRuntime } from "../src/http/x402.js";
import { createMcpServer } from "../src/mcp/server.js";
import { PRICING, toolHttpPath } from "../src/pricing.js";
import { isEligibleForSurface, LOCAL_ONLY_TOOL_NAMES } from "../src/tools/surfaces.js";
import { ChainRegistry, chainRegistryFileSchema } from "../src/registry/chains.js";
import { TokenRegistry, tokenRegistryFileSchema } from "../src/registry/tokens.js";

function fakeDeps(): Deps {
  const chains = new ChainRegistry(
    chainRegistryFileSchema.parse({
      version: 1,
      chains: [
        {
          id: 7,
          name: "Seven",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          explorer: { name: "Explorer", url: "https://explorer.example" },
          venues: {},
          oracle: { kind: "chainlink-aggregator-v3", sequencerUptimeFeed: null },
          issuerProfile: {
            id: "issuer",
            tokenStandard: "erc20",
            multiplier: { kind: "none", feedIncludesMultiplier: false },
            mintRedeem: { zeroAddress: true, participantAddresses: [] },
          },
        },
      ],
    }),
  );
  const tokens = new TokenRegistry(
    chains,
    [
      tokenRegistryFileSchema.parse({
        version: 1,
        chainId: 7,
        updatedAt: "2026-07-29T00:00:00.000Z",
        tokens: [
          {
            ticker: "AAA",
            name: "Alpha",
            address: "0x0000000000000000000000000000000000000007",
            decimals: 18,
            issuerProfile: "issuer",
            venues: [],
          },
        ],
      }),
    ],
    [7],
  );

  return { chainRegistry: chains, tokenRegistry: tokens } as Deps;
}

function fakePayment(): PaymentRuntime {
  const routeConfig = Object.fromEntries(
    Object.entries(PRICING).map(([name, price]) => [
      `POST ${toolHttpPath(name)}`,
      {
        accepts: {
          scheme: "exact",
          network: BASE_SEPOLIA,
          payTo: "0x0000000000000000000000000000000000000001",
          price,
        },
      },
    ]),
  ) as RoutesConfig;
  return {
    config: {
      network: BASE_SEPOLIA,
      payTo: "0x0000000000000000000000000000000000000001",
      paymentReplayMaxEntries: 10,
      paymentReplayTtlMs: 60_000,
    },
    resourceServer: new x402ResourceServer().register(BASE_SEPOLIA, new ExactEvmScheme()),
    routeConfig,
    replayGuard: new PaymentReplayGuard(),
    async facilitatorReachable() {
      return true;
    },
  };
}

describe("generated surfaces", () => {
  test("serves health and the canonical free HTTP tool route", async () => {
    const app = createHttpApp({
      deps: fakeDeps(),
      payment: fakePayment(),
      freeCalls: createFreeCallLimiter({ callsPerDay: 0 }),
      trustedProxy: "none",
      maxRequestBodyBytes: 65_536,
      async health() {
        return { status: "ok" };
      },
    });

    expect((await app.request("/healthz")).status).toBe(200);
    expect((await app.request("/list_stock_tokens", { method: "POST" })).status).toBe(404);

    const response = await app.request("/api/v1/tools/list_stock_tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chain: 7 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tokens: [
        {
          chainId: 7,
          ticker: "AAA",
          name: "Alpha",
          address: "0x0000000000000000000000000000000000000007",
          venues: [],
          updatedAt: "2026-07-29T00:00:00.000Z",
        },
      ],
    });

    expect(
      (
        await app.request("/api/v1/tools/list_stock_tokens", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "{}",
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await app.request("/api/v1/tools/list_stock_tokens", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": "70000",
          },
          body: "{}",
        })
      ).status,
    ).toBe(413);
  });

  test("registers the same definition through MCP with Zod v4 structured output", async () => {
    const server = await createMcpServer(fakeDeps());
    const client = new Client({ name: "surface-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "list_stock_tokens",
      arguments: { chain: 7 },
    });
    expect(result.structuredContent).toEqual({
      tokens: [
        {
          chainId: 7,
          ticker: "AAA",
          name: "Alpha",
          address: "0x0000000000000000000000000000000000000007",
          venues: [],
          updatedAt: "2026-07-29T00:00:00.000Z",
        },
      ],
    });

    await client.close();
    await server.close();
  });

  test("hosted eligibility excludes every local trading tool even if mis-tagged", () => {
    for (const name of LOCAL_ONLY_TOOL_NAMES) {
      expect(isEligibleForSurface({ name, surfaces: ["hosted", "local"] }, "hosted")).toBe(false);
      expect(isEligibleForSurface({ name, surfaces: ["local"] }, "local")).toBe(true);
    }
  });
});
