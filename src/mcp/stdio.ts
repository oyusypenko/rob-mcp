import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Deps } from "../deps.js";
import { createMcpServer } from "./server.js";

export async function runStdioMcp(deps: Deps): Promise<McpServer> {
  const server = await createMcpServer(deps);
  await server.connect(new StdioServerTransport());
  return server;
}
