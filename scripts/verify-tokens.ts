import { loadConfig } from "../src/config";
import { aggregatorV3Abi, erc20Abi, erc8056Abi } from "../src/chain/abi";
import { createDeps } from "../src/deps";
import { getAddress } from "viem";

async function verify(): Promise<void> {
  const config = loadConfig(process.env, "stdio");
  const deps = await createDeps(config);
  const failures: string[] = [];
  let verifiedTokens = 0;
  let verifiedFeeds = 0;

  for (const chainId of config.enabledChains) {
    const chain = deps.chainRegistry.get(chainId);
    const client = deps.clients.get(chainId);
    if (!client) {
      failures.push(`chain ${chainId}: client unavailable`);
      continue;
    }

    for (const token of deps.tokenRegistry.entries(chainId)) {
      try {
        const tokenAddress = getAddress(token.address);
        const [symbol, decimals] = await Promise.all([
          client.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "symbol",
          }),
          client.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "decimals",
          }),
        ]);
        if (symbol.toUpperCase() !== token.ticker.toUpperCase()) {
          failures.push(`${chainId}:${token.ticker}: on-chain symbol is ${symbol}`);
        }
        if (decimals !== token.decimals) {
          failures.push(
            `${chainId}:${token.ticker}: expected ${token.decimals} decimals, received ${decimals}`,
          );
        }

        if (chain.issuerProfile.multiplier.kind === "erc8056-ui-multiplier") {
          const multiplier = await client.readContract({
            address: tokenAddress,
            abi: erc8056Abi,
            functionName: "uiMultiplier",
          });
          if (multiplier <= 0n) {
            failures.push(`${chainId}:${token.ticker}: uiMultiplier is not positive`);
          }
        }

        if (token.feed) {
          const feedAddress = getAddress(token.feed);
          const [feedDecimals, round] = await Promise.all([
            client.readContract({
              address: feedAddress,
              abi: aggregatorV3Abi,
              functionName: "decimals",
            }),
            client.readContract({
              address: feedAddress,
              abi: aggregatorV3Abi,
              functionName: "latestRoundData",
            }),
          ]);
          const [roundId, answer, , updatedAt, answeredInRound] = round;
          if (feedDecimals <= 0 || answer <= 0n || updatedAt <= 0n) {
            failures.push(
              `${chainId}:${token.ticker}: feed returned invalid decimals, answer, or timestamp`,
            );
          }
          if (answeredInRound < roundId) {
            failures.push(`${chainId}:${token.ticker}: feed answeredInRound precedes roundId`);
          }
          verifiedFeeds += 1;
        }
        verifiedTokens += 1;
      } catch (error) {
        failures.push(
          `${chainId}:${token.ticker}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`token verification failed (${failures.length}):\n${failures.join("\n")}`);
  }
  console.log(
    JSON.stringify({
      enabledChains: config.enabledChains,
      verifiedTokens,
      verifiedFeeds,
    }),
  );
}

await verify();
