#!/usr/bin/env bun
/**
 * One-time per-clone Codex bootstrap. Safe and idempotent.
 *
 * It regenerates the mirror, installs the repo Git hook path, and runs the parity verifier.
 * Project trust and non-managed hook trust remain explicit interactive Codex actions.
 */

import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

function run(command: string[]) {
  const result = Bun.spawnSync({
    cmd: command,
    cwd: ROOT,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

run(["bun", "scripts/sync-codex.ts"]);
run(["git", "config", "core.hooksPath", ".githooks"]);
run(["bun", "scripts/verify-codex-parity.ts"]);

console.log("");
console.log("Codex clone setup is complete.");
console.log("Remaining interactive actions:");
console.log("  1. Trust this project when Codex prompts.");
console.log("  2. Run /hooks in Codex and approve the rob-mcp hooks.");
if (!process.env.CONTEXT7_API_KEY)
  console.log("  3. Export CONTEXT7_API_KEY locally to avoid anonymous Context7 quota limits.");
