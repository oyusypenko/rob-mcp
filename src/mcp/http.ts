import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import type { Deps } from "../deps.js";
import { bodyErrorResponse, boundedJsonRequest, RequestBodyError } from "../http/body.js";
import type { FreeCallLimiter } from "../http/rate-limit.js";
import type { PaymentRuntime } from "../http/x402.js";
import { createMcpServer } from "./server.js";

export async function handleMcpHttpRequest(options: {
  request: Request;
  requestIp: string | null;
  maxRequestBodyBytes: number;
  deps: Deps;
  payment: PaymentRuntime;
  freeCalls: FreeCallLimiter;
}): Promise<Response> {
  let request = options.request;
  if (request.method === "POST") {
    try {
      request = await boundedJsonRequest(request, options.maxRequestBodyBytes);
    } catch (error) {
      if (error instanceof RequestBodyError) {
        return bodyErrorResponse(error);
      }
      throw error;
    }
  }

  // API assumption verified against @modelcontextprotocol/sdk 1.30.0 on 2026-07-29:
  // this Web-Standard transport is the Bun/Hono bridge and omitted sessions are stateless.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = await createMcpServer(options.deps, {
    surface: "hosted",
    payment: options.payment,
    freeCalls: options.freeCalls,
    requestIp: options.requestIp,
  });
  await server.connect(transport);

  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}
