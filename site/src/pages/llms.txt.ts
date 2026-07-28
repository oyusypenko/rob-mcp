import type { APIRoute } from "astro";
import { path, repository } from "../lib/site";

export const GET: APIRoute = ({ site }) =>
  new Response(
    `# rob-mcp\n\nVerified tokenized-equity data tools for agents.\n\n- Documentation: ${new URL(path("/docs/"), site)}\n- Tool reference: ${new URL(path("/docs/tools/"), site)}\n- Pricing: ${new URL(path("/pricing/"), site)}\n- Source: ${repository}\n\nCanonical tool schemas and prices live in the source repository. Availability labels include unresolved safety gates.\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
