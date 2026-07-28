import { createFacilitatorConfig } from "@coinbase/x402";
import type { RoutesConfig } from "@x402/core/http";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";

import { PRICING, toolHttpPath } from "../pricing.js";
import { paymentFingerprint, PaymentReplayGuard } from "./payment-replay.js";

export const BASE_MAINNET = "eip155:8453";
export const BASE_SEPOLIA = "eip155:84532";
export const TESTNET_FACILITATOR_URL = "https://x402.org/facilitator";

export type X402Network = typeof BASE_MAINNET | typeof BASE_SEPOLIA;

export interface X402Config {
  network: X402Network;
  payTo: `0x${string}`;
  cdpApiKeyId?: string;
  cdpApiKeySecret?: string;
  paymentReplayMaxEntries: number;
  paymentReplayTtlMs: number;
  facilitatorUrl?: string;
}

export interface PaymentRuntime {
  readonly config: X402Config;
  readonly resourceServer: x402ResourceServer;
  readonly routeConfig: RoutesConfig;
  readonly replayGuard: PaymentReplayGuard;
  facilitatorReachable(): Promise<boolean>;
}

export function facilitatorConfig(config: X402Config) {
  if (config.network === BASE_MAINNET) {
    if (!config.cdpApiKeyId || !config.cdpApiKeySecret) {
      throw new Error("CDP facilitator credentials are required on Base mainnet");
    }
    return createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret);
  }

  return {
    url: config.facilitatorUrl ?? TESTNET_FACILITATOR_URL,
  };
}

export async function createPaymentRuntime(config: X402Config): Promise<PaymentRuntime> {
  // API assumptions verified from the pinned SDK declarations and official docs on 2026-07-29:
  // x402 v2 uses CAIP-2 networks, a registered ExactEvmScheme, and an initialized resource server.
  const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig(config));
  // The pinned 2.20.0 resource server has lifecycle hooks but no cross-transport
  // in-flight reservation guarantee (verified from its implementation on 2026-07-29).
  const replayGuard = new PaymentReplayGuard({
    maxFingerprints: config.paymentReplayMaxEntries,
    ttlMs: config.paymentReplayTtlMs,
  });
  const resourceServer = new x402ResourceServer(facilitatorClient)
    .register(config.network as Network, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  resourceServer.onBeforeVerify(async ({ paymentPayload }) => {
    try {
      const fingerprint = await paymentFingerprint(paymentPayload);
      if (!replayGuard.reserve(fingerprint)) {
        return {
          abort: true,
          reason: "payment_replay_or_capacity",
          message: "payment is already in flight, already used, or replay capacity is full",
        };
      }
    } catch {
      return {
        abort: true,
        reason: "payment_fingerprint_failed",
        message: "payment fingerprinting failed closed",
      };
    }
  });
  resourceServer.onAfterVerify(async ({ paymentPayload, result }) => {
    if (!result.isValid) {
      replayGuard.release(await paymentFingerprint(paymentPayload));
    }
  });
  resourceServer.onVerifyFailure(async ({ paymentPayload }) => {
    replayGuard.release(await paymentFingerprint(paymentPayload));
  });
  resourceServer.onAfterSettle(async ({ paymentPayload }) => {
    replayGuard.settle(await paymentFingerprint(paymentPayload));
  });
  resourceServer.onSettleFailure(async ({ paymentPayload }) => {
    replayGuard.cancel(await paymentFingerprint(paymentPayload));
  });
  resourceServer.onVerifiedPaymentCanceled(async ({ paymentPayload }) => {
    replayGuard.cancel(await paymentFingerprint(paymentPayload));
  });

  await resourceServer.initialize();

  const routeConfig: RoutesConfig = Object.fromEntries(
    Object.entries(PRICING).map(([name, price]) => [
      `POST ${toolHttpPath(name)}`,
      {
        accepts: {
          scheme: "exact",
          network: config.network,
          payTo: config.payTo,
          price,
        },
        description: `rob-mcp ${name} data tool`,
        mimeType: "application/json",
        serviceName: "rob-mcp",
        tags: ["tokenized-equities", "onchain-data"],
      },
    ]),
  );

  return {
    config,
    resourceServer,
    routeConfig,
    replayGuard,
    async facilitatorReachable(): Promise<boolean> {
      try {
        await facilitatorClient.getSupported();
        return true;
      } catch {
        return false;
      }
    },
  };
}
