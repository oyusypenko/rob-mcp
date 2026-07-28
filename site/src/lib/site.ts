import manifest from "../generated/manifest.json";

export { manifest };

export const repository = manifest.product.repository;
export const base = import.meta.env.BASE_URL.replace(/\/$/, "");

export function path(value: string): string {
  return `${base}${value.startsWith("/") ? value : `/${value}`}`;
}

export const nav = [
  { href: "/docs/", label: "Docs" },
  { href: "/docs/tools/", label: "Tools" },
  { href: "/pricing/", label: "Pricing" },
  { href: "/docs/safety/", label: "Safety" },
  { href: "/faq/", label: "FAQ" },
];

export const docsNav = [
  ["/docs/", "Overview"],
  ["/docs/getting-started/local/", "Local quickstart"],
  ["/docs/getting-started/hosted/", "Hosted quickstart"],
  ["/docs/mcp/", "MCP"],
  ["/docs/api/", "JSON API"],
  ["/docs/tools/", "Tools"],
  ["/docs/x402/", "x402 payments"],
  ["/docs/safety/", "Safety"],
  ["/docs/troubleshooting/", "Troubleshooting"],
] as const;
