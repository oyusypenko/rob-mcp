import { extname, join, normalize, resolve } from "node:path";

const dist = resolve(import.meta.dir, "../dist");
const base = (process.env.SITE_BASE ?? "/rob-mcp").replace(/\/$/, "");
const port = Number(process.env.SITE_LIGHTHOUSE_PORT ?? "4321");
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("SITE_LIGHTHOUSE_PORT must be a valid TCP port");
}

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${base}/`)) {
      return new Response("Not found", { status: 404 });
    }
    let requestPath = url.pathname.slice(base.length);
    if (requestPath.endsWith("/")) requestPath += "index.html";
    const safePath = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, "");
    const filePath = join(dist, safePath);
    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file, {
      headers: { "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream" },
    });
  },
});

console.log(`Lighthouse server ready at http://127.0.0.1:${port}${base}/`);
