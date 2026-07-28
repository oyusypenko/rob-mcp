import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { x402Client } from "@x402/core/client";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
} from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import {
  ExactEvmScheme,
  getDefaultAsset,
  isEIP3009Payload,
  type ExactEvmPayloadV2,
} from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";
import { wrapMCPClientWithPayment } from "@x402/mcp";
import { privateKeyToAccount } from "viem/accounts";

import { PRICING, type PaidToolName, isPaidTool, toolHttpPath } from "../src/pricing.js";
import { toolDefinitionsByName } from "../src/tools/definitions.js";
import { BASE_SEPOLIA, TESTNET_FACILITATOR_URL } from "../src/http/x402.js";

// API assumptions re-verified on 2026-07-29. Context7 was quota-blocked, so the pinned
// @x402/fetch/@x402/mcp declarations and official Coinbase x402 v2 docs were used:
// HTTP uses PAYMENT-REQUIRED -> PAYMENT-SIGNATURE -> PAYMENT-RESPONSE, while MCP carries
// the equivalent challenge/payment/settlement in x402 metadata.

const BASE_SEPOLIA_USDC_DECIMALS = 6;
const DEFAULT_TOOL: PaidToolName = "stock_liquidity";
const DEFAULT_INPUT = { ticker: "AAPL", chain: 4663 };
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export type SmokeMode = "challenge" | "http" | "mcp";

export interface SmokeConfig {
  readonly mode: SmokeMode;
  readonly baseUrl: URL;
  readonly network: typeof BASE_SEPOLIA;
  readonly facilitatorUrl: typeof TESTNET_FACILITATOR_URL;
  readonly payTo: `0x${string}`;
  readonly freeCallsPerDay: number;
  readonly toolName: PaidToolName;
  readonly input: Record<string, unknown>;
  readonly privateKey?: `0x${string}`;
}

interface ChallengeObservation {
  readonly paymentRequired: PaymentRequired;
  readonly freeCallsObserved: number;
}

interface HttpTrace {
  readonly hadPaymentSignature: boolean;
  readonly hadLegacyPaymentHeader: boolean;
  readonly status: number;
  readonly paymentRequiredHeader: string | null;
  readonly paymentResponseHeader: string | null;
  readonly paymentSignatureHeader: string | null;
}

interface McpHttpTrace {
  readonly status: number;
  readonly requestBody?: unknown;
  readonly responseBody?: unknown;
}

type SmokeFetchInput = string | URL | Request;

export function parseSmokeConfig(
  args: readonly string[],
  env: Record<string, string | undefined>,
): SmokeConfig {
  const mode = args[0];
  if (mode !== "challenge" && mode !== "http" && mode !== "mcp") {
    throw new Error("Usage: bun scripts/x402-smoke.ts <challenge|http|mcp>");
  }
  if (args.length !== 1) {
    throw new Error("The x402 smoke runner accepts exactly one mode argument");
  }

  const network = requiredEnv(env, "X402_NETWORK");
  if (network !== BASE_SEPOLIA) {
    throw new Error(
      `Refusing x402 smoke on ${network}; only Base Sepolia (${BASE_SEPOLIA}) is allowed`,
    );
  }

  const configuredFacilitator = env.X402_FACILITATOR_URL?.trim() || TESTNET_FACILITATOR_URL;
  if (normalizeUrl(configuredFacilitator) !== normalizeUrl(TESTNET_FACILITATOR_URL)) {
    throw new Error(
      `Refusing non-canonical smoke facilitator; expected ${TESTNET_FACILITATOR_URL}`,
    );
  }
  if (env.CDP_API_KEY_ID?.trim() || env.CDP_API_KEY_SECRET?.trim()) {
    throw new Error("Refusing CDP credentials in the testnet-only x402 smoke runner");
  }

  const payTo = requiredEnv(env, "X402_PAY_TO");
  if (!ADDRESS_PATTERN.test(payTo)) {
    throw new Error("X402_PAY_TO must be a 20-byte 0x-prefixed EVM address");
  }

  const port = parsePositiveInteger(env.PORT?.trim() || "8402", "PORT");
  const baseUrl = parseBaseUrl(env.SMOKE_TEST_BASE_URL?.trim() || `http://127.0.0.1:${port}`);
  const freeCallsPerDay = parseNonnegativeInteger(
    env.FREE_CALLS_PER_DAY?.trim() || "20",
    "FREE_CALLS_PER_DAY",
  );

  const toolName = env.SMOKE_TEST_TOOL?.trim() || DEFAULT_TOOL;
  if (!isPaidTool(toolName)) {
    throw new Error(`SMOKE_TEST_TOOL must name a paid tool in PRICING; received ${toolName}`);
  }
  const definition = toolDefinitionsByName.get(toolName);
  if (!definition || definition.tier !== "paid" || !definition.surfaces.includes("hosted")) {
    throw new Error(`SMOKE_TEST_TOOL is not an implemented hosted paid tool: ${toolName}`);
  }

  const input = parseInput(env.SMOKE_TEST_INPUT_JSON, toolName);
  const privateKey =
    mode === "challenge" ? undefined : parsePrivateKey(requiredEnv(env, "SMOKE_TEST_PRIVATE_KEY"));

  return {
    mode,
    baseUrl,
    network: BASE_SEPOLIA,
    facilitatorUrl: TESTNET_FACILITATOR_URL,
    payTo: payTo as `0x${string}`,
    freeCallsPerDay,
    toolName,
    input,
    ...(privateKey ? { privateKey } : {}),
  };
}

function requiredEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

function parseBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("SMOKE_TEST_BASE_URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("SMOKE_TEST_BASE_URL must not contain credentials");
  }
  url.search = "";
  url.hash = "";
  return url;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function parseNonnegativeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a nonnegative safe integer`);
  }
  return parsed;
}

function parsePrivateKey(value: string): `0x${string}` {
  if (!PRIVATE_KEY_PATTERN.test(value)) {
    throw new Error("SMOKE_TEST_PRIVATE_KEY must be a 32-byte 0x-prefixed private key");
  }
  if (/^0x0{64}$/i.test(value)) {
    throw new Error("SMOKE_TEST_PRIVATE_KEY must not be the zero key");
  }
  return value as `0x${string}`;
}

function parseInput(value: string | undefined, toolName: PaidToolName): Record<string, unknown> {
  let candidate: unknown = DEFAULT_INPUT;
  if (value?.trim()) {
    try {
      candidate = JSON.parse(value);
    } catch {
      throw new Error("SMOKE_TEST_INPUT_JSON must be valid JSON");
    }
  }
  const definition = toolDefinitionsByName.get(toolName);
  assert(definition, `Missing tool definition for ${toolName}`);
  return definition.inputSchema.parse(candidate) as Record<string, unknown>;
}

export function priceToAtomicUsdc(price: string): string {
  const match = /^\$(\d+)(?:\.(\d{1,6}))?$/.exec(price);
  if (!match) throw new Error(`Unsupported USDC price format in PRICING: ${price}`);
  const units = BigInt(match[1]!) * 10n ** BigInt(BASE_SEPOLIA_USDC_DECIMALS);
  const fraction = BigInt((match[2] ?? "").padEnd(BASE_SEPOLIA_USDC_DECIMALS, "0") || "0");
  return (units + fraction).toString();
}

function expectedAmount(config: SmokeConfig): string {
  return priceToAtomicUsdc(PRICING[config.toolName]);
}

function assertRequirement(
  requirement: PaymentRequirements,
  config: SmokeConfig,
  label: string,
): void {
  assert.equal(requirement.scheme, "exact", `${label}: scheme`);
  assert.equal(requirement.network, BASE_SEPOLIA, `${label}: CAIP-2 network`);
  assert.equal(requirement.payTo.toLowerCase(), config.payTo.toLowerCase(), `${label}: payTo`);
  assert.equal(requirement.amount, expectedAmount(config), `${label}: atomic USDC amount`);
  assert.equal(
    requirement.asset.toLowerCase(),
    getDefaultAsset(BASE_SEPOLIA).address.toLowerCase(),
    `${label}: Base Sepolia USDC asset`,
  );
}

export function assertPaymentRequired(
  paymentRequired: PaymentRequired,
  config: SmokeConfig,
  label = "PAYMENT-REQUIRED",
): PaymentRequirements {
  assert.equal(paymentRequired.x402Version, 2, `${label}: x402Version`);
  assert.equal(paymentRequired.accepts.length, 1, `${label}: accepts length`);
  const requirement = paymentRequired.accepts[0];
  assert(requirement, `${label}: missing accepts entry`);
  assertRequirement(requirement, config, label);
  return requirement;
}

function assertPaymentPayload(
  paymentPayload: PaymentPayload,
  config: SmokeConfig,
  label: string,
): void {
  assert.equal(paymentPayload.x402Version, 2, `${label}: x402Version`);
  assertRequirement(paymentPayload.accepted, config, `${label}: accepted`);
  const evmPayload = paymentPayload.payload as ExactEvmPayloadV2;
  assert(
    isEIP3009Payload(evmPayload),
    `${label}: expected EIP-3009 transferWithAuthorization payload`,
  );
  assert.match(evmPayload.signature ?? "", /^0x[0-9a-fA-F]+$/, `${label}: signature`);
  assert.equal(
    evmPayload.authorization.to.toLowerCase(),
    config.payTo.toLowerCase(),
    `${label}: authorization recipient`,
  );
  assert.equal(
    evmPayload.authorization.value,
    expectedAmount(config),
    `${label}: authorization value`,
  );
}

function assertSettlement(settlement: SettleResponse, config: SmokeConfig, label: string): void {
  assert.equal(settlement.success, true, `${label}: settlement success`);
  assert.equal(settlement.network, BASE_SEPOLIA, `${label}: settlement network`);
  assert.match(settlement.transaction, /^0x[0-9a-fA-F]{64}$/, `${label}: transaction hash`);
  if (settlement.amount !== undefined) {
    assert.equal(settlement.amount, expectedAmount(config), `${label}: settlement amount`);
  }
}

function toolUrl(config: SmokeConfig): URL {
  return new URL(toolHttpPath(config.toolName), config.baseUrl);
}

function mcpUrl(config: SmokeConfig): URL {
  return new URL("/mcp", config.baseUrl);
}

async function checkHealth(config: SmokeConfig): Promise<void> {
  const response = await fetch(new URL("/healthz", config.baseUrl), {
    headers: { accept: "application/json" },
  });
  const body = await readJson(response, "health response");
  assert.equal(response.status, 200, `Expected /healthz 200, received ${response.status}`);
  assert.equal(
    (body as { facilitator?: { reachable?: unknown } }).facilitator?.reachable,
    true,
    "health response must report facilitator.reachable=true",
  );
}

async function checkAlwaysFreeTool(config: SmokeConfig): Promise<void> {
  const definition = toolDefinitionsByName.get("list_stock_tokens");
  assert(definition, "Missing list_stock_tokens definition");
  const response = await fetch(new URL(toolHttpPath("list_stock_tokens"), config.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: "{}",
  });
  const body = await readJson(response, "list_stock_tokens response");
  assert.equal(response.status, 200, "list_stock_tokens must remain free");
  definition.outputSchema.parse(body);
  assert.equal(
    response.headers.get("payment-required"),
    null,
    "free tool must not emit PAYMENT-REQUIRED",
  );
}

async function observeChallenge(
  config: SmokeConfig,
  options: { exactFreshBoundary: boolean },
): Promise<ChallengeObservation> {
  const definition = toolDefinitionsByName.get(config.toolName);
  assert(definition, `Missing tool definition for ${config.toolName}`);
  let freeCallsObserved = 0;

  for (let requestIndex = 0; requestIndex <= config.freeCallsPerDay; requestIndex += 1) {
    const response = await fetch(toolUrl(config), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(config.input),
    });

    if (response.status === 200) {
      const output = await readJson(response, `${config.toolName} free-tier response`);
      definition.outputSchema.parse(output);
      assert.equal(
        response.headers.get("payment-response"),
        null,
        "free-tier response must not claim a settlement",
      );
      freeCallsObserved += 1;
      continue;
    }

    if (response.status !== 402) {
      const body = await response.text();
      throw new Error(
        `${config.toolName} returned ${response.status} before payment challenge: ${body}`,
      );
    }

    const header = response.headers.get("payment-required");
    assert(header, "402 response is missing PAYMENT-REQUIRED");
    assert.equal(
      response.headers.get("x-payment-required"),
      null,
      "v2 challenge must not use a legacy X-PAYMENT-REQUIRED header",
    );
    const paymentRequired = decodePaymentRequiredHeader(header);
    assertPaymentRequired(paymentRequired, config);
    if (options.exactFreshBoundary) {
      assert.equal(
        freeCallsObserved,
        config.freeCallsPerDay,
        "fresh-IP free tier did not end exactly at FREE_CALLS_PER_DAY",
      );
    }
    return { paymentRequired, freeCallsObserved };
  }

  throw new Error(
    `Paid route remained free beyond FREE_CALLS_PER_DAY=${config.freeCallsPerDay}; paywall hole`,
  );
}

async function runChallenge(config: SmokeConfig): Promise<void> {
  await checkHealth(config);
  await checkAlwaysFreeTool(config);
  const observed = await observeChallenge(config, { exactFreshBoundary: true });
  console.log(
    JSON.stringify({
      ok: true,
      mode: config.mode,
      network: config.network,
      facilitator: config.facilitatorUrl,
      tool: config.toolName,
      price: PRICING[config.toolName],
      freeCallsObserved: observed.freeCallsObserved,
      challenge: "PAYMENT-REQUIRED",
      spending: false,
    }),
  );
}

async function runHttp(config: SmokeConfig): Promise<void> {
  assert(config.privateKey, "SMOKE_TEST_PRIVATE_KEY is required for HTTP payment smoke");
  await checkHealth(config);
  const challenge = await observeChallenge(config, { exactFreshBoundary: false });
  const traces: HttpTrace[] = [];

  const tracedFetch = async (input: SmokeFetchInput, init?: RequestInit): Promise<Response> => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(input.toString(), init);
    const paymentSignatureHeader = request.headers.get("payment-signature");
    const hadLegacyPaymentHeader = request.headers.has("x-payment");
    const response = await fetch(request);
    traces.push({
      hadPaymentSignature: paymentSignatureHeader !== null,
      hadLegacyPaymentHeader,
      status: response.status,
      paymentRequiredHeader: response.headers.get("payment-required"),
      paymentResponseHeader: response.headers.get("payment-response"),
      paymentSignatureHeader,
    });
    return response;
  };

  const account = privateKeyToAccount(config.privateKey);
  const client = new x402Client().register(BASE_SEPOLIA, new ExactEvmScheme(account));
  const fetchWithPayment = wrapFetchWithPayment(tracedFetch as typeof globalThis.fetch, client);
  const response = await fetchWithPayment(toolUrl(config), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(config.input),
  });
  const body = await readJson(response, `${config.toolName} paid HTTP response`);

  assert.equal(response.status, 200, `Paid HTTP retry returned ${response.status}`);
  const definition = toolDefinitionsByName.get(config.toolName);
  assert(definition, `Missing tool definition for ${config.toolName}`);
  definition.outputSchema.parse(body);

  const initial = traces.find((trace) => trace.status === 402 && !trace.hadPaymentSignature);
  assert(initial?.paymentRequiredHeader, "wrapped fetch did not observe PAYMENT-REQUIRED");
  assertPaymentRequired(
    decodePaymentRequiredHeader(initial.paymentRequiredHeader),
    config,
    "HTTP PAYMENT-REQUIRED",
  );
  assert.deepEqual(
    decodePaymentRequiredHeader(initial.paymentRequiredHeader),
    challenge.paymentRequired,
    "wrapped fetch challenge drifted from the preflight challenge",
  );

  const signed = traces.find((trace) => trace.hadPaymentSignature);
  assert(signed?.paymentSignatureHeader, "wrapped fetch did not send PAYMENT-SIGNATURE");
  assert.equal(signed.hadLegacyPaymentHeader, false, "wrapped fetch sent legacy X-PAYMENT");
  assertPaymentPayload(
    decodePaymentSignatureHeader(signed.paymentSignatureHeader),
    config,
    "HTTP PAYMENT-SIGNATURE",
  );
  assert.equal(signed.status, 200, "PAYMENT-SIGNATURE retry did not return 200");
  assert(signed.paymentResponseHeader, "paid HTTP response is missing PAYMENT-RESPONSE");
  const settlement = decodePaymentResponseHeader(signed.paymentResponseHeader);
  assertSettlement(settlement, config, "HTTP PAYMENT-RESPONSE");

  console.log(
    JSON.stringify({
      ok: true,
      mode: config.mode,
      network: config.network,
      facilitator: config.facilitatorUrl,
      tool: config.toolName,
      price: PRICING[config.toolName],
      payer: account.address,
      transaction: settlement.transaction,
      flow: ["PAYMENT-REQUIRED", "PAYMENT-SIGNATURE", "PAYMENT-RESPONSE"],
    }),
  );
}

async function runMcp(config: SmokeConfig): Promise<void> {
  assert(config.privateKey, "SMOKE_TEST_PRIVATE_KEY is required for MCP payment smoke");
  await checkHealth(config);
  await observeChallenge(config, { exactFreshBoundary: false });

  const traces: McpHttpTrace[] = [];
  const tracedFetch = async (input: SmokeFetchInput, init?: RequestInit): Promise<Response> => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(input.toString(), init);
    const requestBody = await parseOptionalJson(request.clone());
    const response = await fetch(request);
    const responseBody = await parseOptionalJson(response.clone());
    traces.push({
      status: response.status,
      ...(requestBody === undefined ? {} : { requestBody }),
      ...(responseBody === undefined ? {} : { responseBody }),
    });
    return response;
  };

  const account = privateKeyToAccount(config.privateKey);
  const baseClient = new Client({ name: "rob-mcp-x402-smoke", version: "0.0.1" });
  const paymentClient = new x402Client().register(BASE_SEPOLIA, new ExactEvmScheme(account));
  let requested: PaymentRequired | undefined;
  let submittedPayload: PaymentPayload | undefined;
  let hookSettlement: SettleResponse | null | undefined;
  const client = wrapMCPClientWithPayment(baseClient, paymentClient, {
    autoPayment: true,
    onPaymentRequested: ({ paymentRequired }) => {
      assertPaymentRequired(paymentRequired, config, "MCP payment challenge");
      requested = paymentRequired;
      return true;
    },
  });
  client.onAfterPayment(({ paymentPayload, settleResponse }) => {
    assertPaymentPayload(paymentPayload, config, "MCP x402/payment");
    submittedPayload = paymentPayload;
    hookSettlement = settleResponse;
  });

  const transport = new StreamableHTTPClientTransport(mcpUrl(config), {
    fetch: tracedFetch as never,
  });
  try {
    await client.connect(transport);
    const result = await client.callTool(config.toolName, config.input, { timeout: 120_000 });
    assert(requested, "MCP client did not observe a payment challenge");
    assert(submittedPayload, "MCP client did not submit x402/payment metadata");
    assert.equal(result.paymentMade, true, "MCP tool call did not report paymentMade");
    assert.notEqual(result.isError, true, "MCP paid tool returned isError");
    assert(result.paymentResponse, "MCP result is missing x402/payment-response");
    assertSettlement(result.paymentResponse, config, "MCP x402/payment-response");
    assert(hookSettlement, "MCP after-payment hook did not receive settlement metadata");
    assertSettlement(hookSettlement, config, "MCP after-payment settlement");

    const output = parseMcpOutput(result.content);
    const definition = toolDefinitionsByName.get(config.toolName);
    assert(definition, `Missing tool definition for ${config.toolName}`);
    definition.outputSchema.parse(output);
    assertMcpWireMetadata(traces, config.toolName);

    console.log(
      JSON.stringify({
        ok: true,
        mode: config.mode,
        network: config.network,
        facilitator: config.facilitatorUrl,
        tool: config.toolName,
        price: PRICING[config.toolName],
        payer: account.address,
        transaction: result.paymentResponse.transaction,
        flow: ["x402 challenge", "x402/payment", "x402/payment-response"],
      }),
    );
  } finally {
    await client.close();
  }
}

function parseMcpOutput(content: readonly { type: string; [key: string]: unknown }[]): unknown {
  for (const item of content) {
    if (item.type !== "text" || typeof item.text !== "string") continue;
    try {
      return JSON.parse(item.text);
    } catch {
      // Keep looking for the canonical JSON text result.
    }
  }
  throw new Error("MCP paid result did not contain a JSON text payload");
}

function assertMcpWireMetadata(traces: readonly McpHttpTrace[], toolName: string): void {
  const calls = traces
    .flatMap((trace) => jsonRpcMessages(trace.requestBody))
    .filter(
      (message) =>
        message.method === "tools/call" &&
        isRecord(message.params) &&
        message.params.name === toolName,
    );
  assert(calls.length >= 2, "MCP transport did not make challenge and paid tool calls");
  assert.equal(hasNestedKey(calls[0], "x402/payment"), false, "initial MCP call carried payment");
  assert(
    calls.slice(1).some((call) => hasNestedKey(call, "x402/payment")),
    "MCP retry is missing x402/payment metadata",
  );
  assert(
    traces.some((trace) => hasNestedKey(trace.responseBody, "x402/payment-response")),
    "MCP response is missing x402/payment-response metadata on the wire",
  );
}

function jsonRpcMessages(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNestedKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasNestedKey(item, key));
  if (!isRecord(value)) return false;
  if (Object.hasOwn(value, key)) return true;
  return Object.values(value).some((item) => hasNestedKey(item, key));
}

async function parseOptionalJson(requestOrResponse: {
  text(): Promise<string>;
  headers: { get(name: string): string | null };
}): Promise<unknown> {
  const text = await requestOrResponse.text();
  if (!text.trim()) return undefined;
  const contentType = requestOrResponse.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function readJson(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} was not JSON (HTTP ${response.status}): ${text}`);
  }
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const config = parseSmokeConfig(args, env);
  if (config.mode === "challenge") return runChallenge(config);
  if (config.mode === "http") return runHttp(config);
  return runMcp(config);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "unknown x402 smoke failure",
      }),
    );
    process.exitCode = 1;
  });
}
