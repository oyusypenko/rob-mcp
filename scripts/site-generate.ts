import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { PRICING } from "../src/pricing";
import { toolDefinitions } from "../src/tools/definitions";

const root = resolve(import.meta.dir, "..");
const generatedDir = resolve(root, "site/src/generated");

type Availability = "implemented" | "implemented-but-live-gated";

const examples: Record<string, unknown> = {
  list_stock_tokens: { search: "AAPL", chain: 4663 },
  stock_premium: { ticker: "AAPL", venue: "best", chain: 4663 },
  stock_liquidity: { ticker: "AAPL", depthPct: 1, chain: 4663 },
  stock_quote: {
    ticker: "AAPL",
    side: "buy",
    amountUsd: 100,
    venue: "best",
    chain: 4663,
  },
  whale_activity: {
    ticker: "AAPL",
    sinceHours: 24,
    limit: 20,
    chain: 4663,
  },
};

function requiredDecisionOpen(decisions: string, id: string): boolean {
  const openItems = decisions.split("## Open items")[1] ?? "";
  return (
    new RegExp(`\\*\\*${id}\\*\\*`).test(openItems) &&
    !new RegExp(`\\*\\*${id}[^\\n]*RESOLVED`).test(openItems)
  );
}

function documentedPrices(toolsDoc: string): Map<string, string> {
  const prices = new Map<string, string>();
  for (const line of toolsDoc.split("\n")) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replaceAll("**", ""));
    const name = cells[0]?.match(/^`([^`]+)`$/)?.[1];
    const price = cells[1]?.match(/(\$\d+(?:\.\d+)?)/)?.[1];
    if (name && price) prices.set(name, price);
  }
  return prices;
}

function envEntries(example: string, inventory: string) {
  const inventoryNames = new Set(
    [...inventory.matchAll(/^\| `([^`]+)`/gm)].map((match) => match[1]!),
  );
  const entries = [
    ...example.matchAll(/^([A-Z][A-Z0-9_]*(?:_<chainId>)?)=([^\s#]*)(?:\s+#\s*(.*))?$/gm),
  ]
    .map(([, name = "", value = "", description = ""]) => ({
      name,
      defaultValue: value || null,
      description,
    }))
    .filter(({ name }) => name !== "SMOKE_TEST_PRIVATE_KEY");
  const normalizedExampleNames = new Set(
    entries.map(({ name }) =>
      name.match(/^RPC_URL_\d+(?:_ARCHIVE)?$/) ? name.replace(/\d+/, "<chainId>") : name,
    ),
  );
  for (const name of inventoryNames) {
    for (const expanded of name.split(" / ")) {
      if (expanded !== "SMOKE_TEST_PRIVATE_KEY" && !normalizedExampleNames.has(expanded)) {
        throw new Error(`env inventory entry ${expanded} is absent from .env.example`);
      }
    }
  }
  return entries;
}

async function main() {
  const [toolsDoc, decisions, envExample, envInventory, chainsFile, packageFile] =
    await Promise.all([
      readFile(resolve(root, "docs/developers/tools.md"), "utf8"),
      readFile(resolve(root, "docs/developers/design-decisions.md"), "utf8"),
      readFile(resolve(root, ".env.example"), "utf8"),
      readFile(resolve(root, "docs/developers/runbooks/env-inventory.md"), "utf8"),
      readFile(resolve(root, "data/chains.json"), "utf8"),
      readFile(resolve(root, "package.json"), "utf8"),
    ]);

  const docsPrices = documentedPrices(toolsDoc);
  const pricing = PRICING as Readonly<Record<string, string>>;
  const names = new Set(toolDefinitions.map(({ name }) => name));

  for (const definition of toolDefinitions) {
    const price = pricing[definition.name];
    if (definition.tier === "paid" && !price) {
      throw new Error(`paid tool ${definition.name} is missing from PRICING`);
    }
    if (definition.tier === "free" && price) {
      throw new Error(`free tool ${definition.name} must not have a price`);
    }
    if (price !== docsPrices.get(definition.name)) {
      throw new Error(
        `pricing drift for ${definition.name}: code=${price}, docs=${docsPrices.get(definition.name)}`,
      );
    }
  }
  for (const name of Object.keys(pricing)) {
    if (!names.has(name)) throw new Error(`PRICING contains unknown tool ${name}`);
  }

  const o5Open = requiredDecisionOpen(decisions, "O-5");
  const o8Open = requiredDecisionOpen(decisions, "O-8");
  const o9Open = requiredDecisionOpen(decisions, "O-9");
  if (!o5Open || !o8Open || !o9Open) {
    throw new Error("site availability rules need review because O-5, O-8, or O-9 changed");
  }

  const tools = toolDefinitions.map((definition) => {
    const inputSchema = z.toJSONSchema(definition.inputSchema);
    const outputSchema = z.toJSONSchema(definition.outputSchema);
    const exampleInput = examples[definition.name];
    const parsed = definition.inputSchema.safeParse(exampleInput);
    if (!parsed.success) {
      throw new Error(`invalid generated example for ${definition.name}`);
    }
    const priceBearing = JSON.stringify(outputSchema).includes("oracleSource");
    const availability: Availability =
      priceBearing && o8Open ? "implemented-but-live-gated" : "implemented";
    return {
      id: definition.name,
      name: definition.name,
      title: definition.title,
      description: definition.description,
      tier: definition.tier,
      price: pricing[definition.name] ?? null,
      surfaces: [...definition.surfaces],
      errorCodes: [...definition.errorCodes],
      availability,
      gates:
        availability === "implemented-but-live-gated"
          ? [
              "Robinhood Chain price-bearing reads fail closed until O-8 resolves the required sequencer-liveness source.",
              "Base mainnet paid redistribution remains unavailable until O-5 is resolved.",
            ]
          : [],
      inputSchema,
      outputSchema,
      exampleInput: parsed.data,
      route: `/api/v1/tools/${definition.name}`,
    };
  });

  const chains = JSON.parse(chainsFile) as {
    chains: Array<Record<string, unknown> & { id: number }>;
  };
  const packageJson = JSON.parse(packageFile) as {
    scripts: Record<string, string>;
    version: string;
  };
  for (const command of ["site:data", "site:dev", "site:build", "site:check", "site:lighthouse"]) {
    if (!packageJson.scripts[command]) {
      throw new Error(`root package.json is missing ${command}`);
    }
  }

  const manifest = {
    generatedFrom: [
      "src/tools/definitions.ts",
      "src/pricing.ts",
      "docs/developers/tools.md",
      "docs/developers/design-decisions.md",
      "data/chains.json",
      ".env.example",
      "docs/developers/runbooks/env-inventory.md",
      "package.json",
    ],
    product: {
      name: "rob-mcp",
      version: packageJson.version,
      repository: "https://github.com/oyusypenko/rob-mcp",
      freeCallsDefault: Number(
        envEntries(envExample, envInventory).find(({ name }) => name === "FREE_CALLS_PER_DAY")
          ?.defaultValue,
      ),
    },
    availability: {
      mainnetPayments: o5Open ? "gated-o5" : "available",
      robinhoodPriceReads: o8Open ? "gated-o8" : "available",
      localTrading: o9Open ? "planned-gated-o9" : "available",
    },
    pricing,
    config: envEntries(envExample, envInventory),
    chains: chains.chains,
    tools,
  };

  await mkdir(generatedDir, { recursive: true });
  await Promise.all([
    writeFile(resolve(generatedDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(resolve(generatedDir, "tools.json"), `${JSON.stringify(tools, null, 2)}\n`),
  ]);
  console.log(`site:data generated ${tools.length} tool entries from canonical sources`);
}

await main();
