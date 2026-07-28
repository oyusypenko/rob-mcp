export const PRICING = {
  stock_premium: "$0.005",
  stock_liquidity: "$0.01",
  stock_quote: "$0.005",
  whale_activity: "$0.01",
} as const;

export type PaidToolName = keyof typeof PRICING;

export function isPaidTool(name: string): name is PaidToolName {
  return Object.hasOwn(PRICING, name);
}

export function toolHttpPath(name: string): string {
  return `/api/v1/tools/${name}`;
}
