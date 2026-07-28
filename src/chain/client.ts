import { createPublicClient, defineChain, http, webSocket, type PublicClient } from "viem";
import type { ChainRpcConfig } from "../config";
import type { ChainConfig } from "../registry/chains";

export interface ChainIdReader {
  getChainId(): Promise<number>;
}

export type ReadOnlyChainClient = PublicClient;

export function createChainClient(chain: ChainConfig, rpc: ChainRpcConfig): ReadOnlyChainClient {
  const viemChain = defineChain({
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: {
      default: {
        http: rpc.url.startsWith("http") ? [rpc.url] : [],
        webSocket: rpc.url.startsWith("ws") ? [rpc.url] : undefined,
      },
    },
    blockExplorers: {
      default: chain.explorer,
    },
  });
  const transport = rpc.url.startsWith("ws") ? webSocket(rpc.url) : http(rpc.url);

  return createPublicClient({
    chain: viemChain,
    transport,
    batch: { multicall: true },
  });
}

export async function assertClientChainId(
  client: ChainIdReader,
  expectedChainId: number,
): Promise<void> {
  const actualChainId = await client.getChainId();
  if (actualChainId !== expectedChainId) {
    throw new Error(
      `RPC chain mismatch: expected chain ${expectedChainId}, received ${actualChainId}`,
    );
  }
}
