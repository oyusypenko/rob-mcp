#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { loadConfig, type RuntimeMode } from "./config.js";
import { createDeps } from "./deps.js";
import { runStdioMcp } from "./mcp/stdio.js";

function modeFromArgs(args: readonly string[]): RuntimeMode | "trade" {
  const command = args[0];
  if (command === undefined) return "stdio";
  if (command === "serve" || command === "scan" || command === "trade") return command;
  throw new Error(`Unknown command: ${command}`);
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const mode = modeFromArgs(args);

  if (mode === "trade") {
    throw new Error(
      "Trading wrapper exposure is blocked until O-9 verifies the upstream Robinhood MCP contract",
    );
  }
  if (mode === "scan") {
    throw new Error("Whale scanner is not available in the current core implementation");
  }

  const config = loadConfig(env, mode);
  const deps = await createDeps(config);

  if (mode === "stdio") {
    const server = await runStdioMcp(deps);
    const shutdown = () => {
      void server.close().finally(() => process.exit(0));
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }

  const { startHostedServer } = await import("./http/start.js");
  const server = await startHostedServer(deps);
  const shutdown = () => {
    void server.stop().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "boot_failed",
        error: error instanceof Error ? error.message : "unknown error",
      }),
    );
    process.exit(1);
  });
}
