import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createPaymentWrapper } from "@x402/mcp";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { z } from "zod";

import type { Deps } from "../deps.js";
import { PRICING, isPaidTool } from "../pricing.js";
import { toolErrorPayload } from "../tools/definitions.js";
import { definitionsForSurface, type ToolSurface } from "../tools/surfaces.js";
import type { FreeCallLimiter } from "../http/rate-limit.js";
import type { PaymentRuntime } from "../http/x402.js";

export interface CreateMcpServerOptions {
  surface?: ToolSurface;
  payment?: PaymentRuntime;
  freeCalls?: FreeCallLimiter;
  requestIp?: string | null;
}

type ToolOutput = Record<string, unknown>;
interface TextToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

function toToolResult(output: ToolOutput): TextToolResult {
  const result: TextToolResult = {
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
  };
  result.structuredContent = output;
  return result;
}

export async function createMcpServer(
  deps: Deps,
  options: CreateMcpServerOptions = {},
): Promise<McpServer> {
  const surface = options.surface ?? "local";
  const toolDefinitions = definitionsForSurface(surface);
  const server = new McpServer({
    name: "rob-mcp",
    version: "0.0.1",
  });

  for (const definition of toolDefinitions) {
    const execute = async (input: Record<string, unknown>): Promise<TextToolResult> => {
      try {
        const parsedInput = definition.inputSchema.parse(input);
        const output = await definition.handler(parsedInput, deps);
        const parsedOutput = definition.outputSchema.parse(output) as ToolOutput;
        return toToolResult(parsedOutput);
      } catch (error) {
        const runtimeError = toolErrorPayload(error);
        if (!runtimeError) throw error;
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(runtimeError) }],
        };
      }
    };

    let callback: (input: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>;

    if (surface === "local" || definition.tier === "free") {
      callback = async (input) => execute(input);
    } else {
      if (!options.payment || !isPaidTool(definition.name)) {
        throw new Error(`Missing x402 payment configuration for paid tool: ${definition.name}`);
      }

      const price = PRICING[definition.name];
      const accepts = await options.payment.resourceServer.buildPaymentRequirements({
        scheme: "exact",
        network: options.payment.config.network,
        payTo: options.payment.config.payTo,
        price,
      });

      const paid = createPaymentWrapper(options.payment.resourceServer, {
        accepts,
        resource: {
          url: `mcp://tool/${definition.name}`,
          description: definition.description,
          mimeType: "application/json",
          serviceName: "rob-mcp",
          tags: ["tokenized-equities", "onchain-data"],
        },
        extensions: declareDiscoveryExtension({
          toolName: definition.name,
          description: definition.description,
          inputSchema: z.toJSONSchema(definition.inputSchema),
          output: {
            schema: z.toJSONSchema(definition.outputSchema),
          },
        }),
      })(execute);

      callback = async (input, extra) => {
        if (
          options.freeCalls &&
          options.requestIp &&
          options.freeCalls.tryFreeCall(options.requestIp)
        ) {
          return execute(input);
        }
        return paid(input, extra);
      };
    }

    // API assumption verified against @modelcontextprotocol/sdk 1.30.0 on 2026-07-29:
    // registerTool accepts whole Zod v4 object schemas and structuredContent with outputSchema.
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: definition.outputSchema,
      },
      callback,
    );
  }

  if (surface === "hosted" && options.payment) {
    for (const name of Object.keys(PRICING)) {
      if (!toolDefinitions.some((definition) => definition.name === name)) {
        throw new Error(`PRICING references an unknown tool: ${name}`);
      }
    }
  }

  return server;
}
