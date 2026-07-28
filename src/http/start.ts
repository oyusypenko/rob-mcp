import type { Deps } from "../deps.js";
import { getHealth } from "../health.js";
import { createHttpApp, type HealthSnapshot } from "./app.js";
import { createFreeCallLimiter, InMemoryFreeCallStore } from "./rate-limit.js";
import { createPaymentRuntime } from "./x402.js";

export interface HostedServer {
  readonly port: number;
  stop(): Promise<void>;
}

export async function startHostedServer(deps: Deps): Promise<HostedServer> {
  const payTo = deps.config.x402.payTo;
  if (!payTo) throw new Error("X402_PAY_TO is required in serve mode");

  const payment = await createPaymentRuntime({
    network: deps.config.x402.network,
    payTo,
    ...(deps.config.x402.cdpApiKeyId ? { cdpApiKeyId: deps.config.x402.cdpApiKeyId } : {}),
    ...(deps.config.x402.cdpApiKeySecret
      ? { cdpApiKeySecret: deps.config.x402.cdpApiKeySecret }
      : {}),
    paymentReplayMaxEntries: deps.config.paymentReplayMaxEntries,
    paymentReplayTtlMs: deps.config.paymentReplayTtlSeconds * 1_000,
    ...(deps.config.x402.facilitatorUrl ? { facilitatorUrl: deps.config.x402.facilitatorUrl } : {}),
  });
  const freeCalls = createFreeCallLimiter({
    callsPerDay: deps.config.freeCallsPerDay,
    store: new InMemoryFreeCallStore({
      maxIdentities: deps.config.freeTierMaxIdentities,
    }),
  });

  const health = async (): Promise<HealthSnapshot> => {
    const [coreHealth, facilitatorReachable] = await Promise.all([
      getHealth(deps),
      payment.facilitatorReachable(),
    ]);
    const scanner = deps.scanner?.snapshot() ?? {
      available: false as const,
      running: false,
      lagBlocks: null,
      chains: [],
    };
    const scannerFailed =
      scanner.available && scanner.chains.some((chain) => chain.status === "error");
    return {
      status:
        !facilitatorReachable || scannerFailed
          ? "stale"
          : coreHealth.status === "degraded"
            ? "degraded"
            : "ok",
      chains: coreHealth.chains,
      scanner,
      facilitator: { reachable: facilitatorReachable },
    };
  };

  const app = createHttpApp({
    deps,
    payment,
    freeCalls,
    trustedProxy: deps.config.trustedProxy,
    maxRequestBodyBytes: deps.config.maxRequestBodyBytes,
    health,
  });
  const server = Bun.serve({
    hostname: "0.0.0.0",
    port: deps.config.port,
    fetch(request, bunServer) {
      const directIp = bunServer.requestIP(request)?.address ?? null;
      return app.fetch(request, { directIp });
    },
  });

  return {
    port: server.port ?? deps.config.port,
    async stop(): Promise<void> {
      await server.stop(true);
    },
  };
}
