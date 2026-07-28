#!/usr/bin/env bun
/**
 * Runtime/static verifier for the generated Claude Code -> Codex adapter (D-10).
 *
 * This script never reads secret values and never mutates the working tree. It verifies the
 * checked-in mirror, Codex config parsing/prompt injection, translated permissions and exec
 * policies, shared hook behavior, read-only agent enforcement, and optional Context7 auth wiring.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const failures: string[] = [];
const warnings: string[] = [];

const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function run(command: string[], stdin?: string): RunResult {
  const result = Bun.spawnSync({
    cmd: command,
    cwd: ROOT,
    stdin: stdin === undefined ? undefined : Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function parseJsonOutput(result: RunResult, label: string): any {
  check(result.exitCode === 0, `${label} exited ${result.exitCode}: ${result.stderr.trim()}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    failures.push(`${label} did not return JSON`);
    return {};
  }
}

function verifyHook(path: string, input: unknown, expectedExit: number, label: string) {
  const result = run([join(ROOT, path)], JSON.stringify(input));
  check(
    result.exitCode === expectedExit,
    `${label}: expected exit ${expectedExit}, received ${result.exitCode}`,
  );
}

const sync = run(["bun", "scripts/sync-codex.ts", "--check"]);
check(
  sync.exitCode === 0,
  `generated mirror is stale: ${sync.stderr.trim() || sync.stdout.trim()}`,
);

const manifest = JSON.parse(read(".codex/parity.json")) as {
  supportedCodexVersion: string;
};
const codexVersion = run(["codex", "--version"]);
check(codexVersion.exitCode === 0, `codex --version failed: ${codexVersion.stderr.trim()}`);
const installedVersion = codexVersion.stdout.match(/(\d+\.\d+\.\d+)/)?.[1];
if (process.env.CODEX_PARITY_ALLOW_VERSION_DRIFT === "1") {
  if (installedVersion !== manifest.supportedCodexVersion)
    warnings.push(
      `Codex ${installedVersion ?? "unknown"} differs from pinned ${manifest.supportedCodexVersion}`,
    );
} else {
  check(
    installedVersion === manifest.supportedCodexVersion,
    `Codex ${installedVersion ?? "unknown"} does not match pinned ${manifest.supportedCodexVersion}`,
  );
}

const agentsMd = read("AGENTS.md");
check(
  agentsMd.includes("Harness changes are source-first"),
  "AGENTS.md is missing the source-first harness rule",
);
check(
  agentsMd.includes("Never hardcode prices, premiums, TVL"),
  "AGENTS.md is missing the innermost no-market-metrics rule",
);

const strictDoctor = run(["codex", "--strict-config", "doctor", "--json"]);
try {
  const doctorJson = JSON.parse(strictDoctor.stdout);
  check(
    doctorJson.checks?.["config.load"]?.status === "ok",
    "Codex strict config validation could not load config",
  );
} catch {
  failures.push("Codex strict config validation did not return parseable JSON");
}

const strictPrompt = run(["codex", "debug", "prompt-input"]);
check(strictPrompt.exitCode === 0, `Codex prompt rendering failed: ${strictPrompt.stderr.trim()}`);
check(
  strictPrompt.stdout.includes("Never hardcode market metrics"),
  "Codex prompt input does not contain the generated AGENTS.md rule",
);

const claudeSettings = JSON.parse(read(".claude/settings.json"));
const codexConfig = read(".codex/config.toml");
for (const rule of claudeSettings.permissions?.deny ?? []) {
  const glob = rule.match(/^Read\((.+)\)$/)?.[1];
  if (glob) check(codexConfig.includes(`${JSON.stringify(glob)} = "deny"`), `missing deny ${glob}`);
}
check(
  codexConfig.includes('env_http_headers = { "CONTEXT7_API_KEY" = "CONTEXT7_API_KEY" }'),
  "Context7 environment-header mapping is missing",
);
if (!process.env.CONTEXT7_API_KEY)
  warnings.push("CONTEXT7_API_KEY is not set; Context7 may use exhausted anonymous quota");

const securityAgent = read(".codex/agents/rob-security.toml");
check(
  securityAgent.includes('default_permissions = ":read-only"'),
  "rob-security is not sandbox-enforced read-only",
);

const rulesPath = join(ROOT, ".codex/rules/rob-mcp.rules");
const expectedPolicies: Array<[string[], string]> = [
  [["bun", "test"], "allow"],
  [["fly", "deploy"], "prompt"],
  [["npm", "publish"], "prompt"],
];
for (const [command, expectedDecision] of expectedPolicies) {
  const result = parseJsonOutput(
    run(["codex", "execpolicy", "check", "--rules", rulesPath, "--", ...command]),
    `exec policy ${command.join(" ")}`,
  );
  check(
    result.decision === expectedDecision,
    `${command.join(" ")} expected ${expectedDecision}, received ${result.decision ?? "none"}`,
  );
}

verifyHook(
  ".claude/hooks/protect-secrets.sh",
  { tool_name: "Bash", tool_input: { command: "cat .env" } },
  2,
  "Claude secret-read hook shape",
);
verifyHook(
  ".claude/hooks/protect-secrets.sh",
  { tool_name: "shell", tool_input: { command: ["bash", "-lc", "cat .env"] } },
  2,
  "legacy Codex secret-read hook shape",
);
verifyHook(
  ".claude/hooks/protect-secrets.sh",
  { tool_name: "Bash", tool_input: { command: "bun test" } },
  0,
  "benign shell hook input",
);
verifyHook(
  ".claude/hooks/protect-generated.sh",
  {
    tool_name: "apply_patch",
    tool_input: {
      command: "*** Begin Patch\n*** Update File: AGENTS.md\n@@\n-test\n+test2\n*** End Patch\n",
    },
  },
  2,
  "generated-file guard",
);
verifyHook(
  ".claude/hooks/protect-generated.sh",
  { tool_name: "Edit", tool_input: { file_path: ".claude/rules/spec-authority.md" } },
  0,
  "source harness edit",
);
verifyHook(
  ".claude/hooks/protect-generated.sh",
  { tool_name: "Edit", tool_input: { file_path: join(ROOT, "AGENTS.md") } },
  2,
  "absolute generated-file guard",
);

for (const path of [
  ".claude/hooks/protect-secrets.sh",
  ".claude/hooks/protect-generated.sh",
  ".claude/hooks/check-hard-rules.sh",
  ".claude/hooks/stop-typecheck.sh",
]) {
  check(existsSync(join(ROOT, path)), `missing shared hook ${path}`);
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  console.error(`codex parity: FAIL (${failures.length} check${failures.length === 1 ? "" : "s"})`);
  process.exit(1);
}

console.log(`codex parity: OK (Codex ${installedVersion}, ${warnings.length} warning(s))`);
