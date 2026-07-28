import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { paymentMiddleware } from "@x402/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError, z } from "zod";

import type { Deps } from "../deps.js";
import { isPaidTool, toolHttpPath } from "../pricing.js";
import { definitionsForSurface } from "../tools/surfaces.js";
import { handleMcpHttpRequest } from "../mcp/http.js";
import { bodyErrorResponse, readBoundedBody, RequestBodyError } from "./body.js";
import { discoveryInputExample } from "./discovery.js";
import type { FreeCallLimiter } from "./rate-limit.js";
import { resolveClientIp, type TrustedProxyMode } from "./rate-limit.js";
import { BASE_SEPOLIA, type PaymentRuntime } from "./x402.js";

const toolDefinitions = definitionsForSurface("hosted");

interface RequestBindings {
  directIp?: string | null;
}

export interface HealthSnapshot {
  readonly status: "ok" | "degraded" | "stale";
  readonly [detail: string]: unknown;
}

export interface CreateHttpAppOptions {
  deps: Deps;
  payment: PaymentRuntime;
  freeCalls: FreeCallLimiter;
  trustedProxy: TrustedProxyMode;
  maxRequestBodyBytes: number;
  health(): Promise<HealthSnapshot>;
}

function attachDiscoveryMetadata(payment: PaymentRuntime): void {
  if (typeof payment.routeConfig !== "object" || "accepts" in payment.routeConfig) {
    throw new Error("Expected an x402 route map");
  }

  for (const definition of toolDefinitions) {
    if (!isPaidTool(definition.name)) continue;
    const route = payment.routeConfig[`POST ${toolHttpPath(definition.name)}`];
    if (!route) throw new Error(`Missing x402 HTTP route for ${definition.name}`);

    route.description = definition.description;
    const inputSchema = z.toJSONSchema(definition.inputSchema);
    route.extensions = declareDiscoveryExtension({
      bodyType: "json",
      input: discoveryInputExample(inputSchema),
      inputSchema,
    });
  }

  for (const routeKey of Object.keys(payment.routeConfig)) {
    const name = routeKey.slice(routeKey.lastIndexOf("/") + 1);
    if (isPaidTool(name) && !toolDefinitions.some((definition) => definition.name === name)) {
      throw new Error(`PRICING references an unavailable HTTP tool: ${name}`);
    }
  }
}

export function createHttpApp(options: CreateHttpAppOptions) {
  attachDiscoveryMetadata(options.payment);

  const app = new Hono<{ Bindings: RequestBindings }>();
  app.use("*", async (context, next) => {
    const path = new URL(context.req.url).pathname;
    const mustBoundBody = context.req.method === "POST" && path.startsWith("/api/v1/tools/");
    if (!mustBoundBody) {
      await next();
      return;
    }

    try {
      await readBoundedBody(context.req.raw.clone(), options.maxRequestBodyBytes);
    } catch (error) {
      if (error instanceof RequestBodyError) {
        return bodyErrorResponse(error);
      }
      throw error;
    }
    await next();
  });

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "mcp-session-id",
        "mcp-protocol-version",
        "payment-signature",
        "x-payment",
      ],
      exposeHeaders: [
        "mcp-session-id",
        "mcp-protocol-version",
        "payment-response",
        "x-payment-response",
      ],
    }),
  );

  const requirePayment = paymentMiddleware(
    options.payment.routeConfig,
    options.payment.resourceServer,
    { appName: "rob-mcp", testnet: options.payment.config.network === BASE_SEPOLIA },
    undefined,
    false,
  );

  // Hono middleware runs in registration order. The free-call decision is therefore made
  // before x402 verification, as required by D-7.
  app.use("*", async (context, next) => {
    const path = new URL(context.req.url).pathname;
    const routeName = path.startsWith("/api/v1/tools/") ? path.slice("/api/v1/tools/".length) : "";
    const isProtectedRoute = context.req.method === "POST" && isPaidTool(routeName);
    if (!isProtectedRoute) {
      await next();
      return;
    }

    const clientIp = resolveClientIp({
      headers: context.req.raw.headers,
      directIp: context.env?.directIp ?? null,
      trustedProxy: options.trustedProxy,
    });
    if (options.freeCalls.tryFreeCall(clientIp)) {
      await next();
      return;
    }

    return requirePayment(context, next);
  });

  app.get("/healthz", async (context) => {
    const health = await options.health();
    return context.json(health, health.status === "stale" ? 503 : 200);
  });

  for (const definition of toolDefinitions) {
    app.post(toolHttpPath(definition.name), async (context) => {
      try {
        const body = await context.req.json();
        const input = definition.inputSchema.parse(body);
        const output = await definition.handler(input, options.deps);
        return context.json(definition.outputSchema.parse(output));
      } catch (error) {
        if (error instanceof ZodError || error instanceof SyntaxError) {
          return context.json(
            {
              error: "invalid_request",
              details: error instanceof ZodError ? error.issues : undefined,
            },
            400,
          );
        }
        throw error;
      }
    });
  }

  app.all("/mcp", (context) =>
    handleMcpHttpRequest({
      request: context.req.raw,
      requestIp: resolveClientIp({
        headers: context.req.raw.headers,
        directIp: context.env?.directIp ?? null,
        trustedProxy: options.trustedProxy,
      }),
      deps: options.deps,
      payment: options.payment,
      freeCalls: options.freeCalls,
      maxRequestBodyBytes: options.maxRequestBodyBytes,
    }),
  );

  app.notFound((context) => context.json({ error: "not_found" }, 404));
  app.onError((error, context) => {
    console.error(
      JSON.stringify({ level: "error", event: "http_request_failed", error: error.message }),
    );
    return context.json({ error: "internal_error" }, 500);
  });

  return app;
}
