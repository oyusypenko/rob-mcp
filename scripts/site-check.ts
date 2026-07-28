import { gzipSync } from "node:zlib";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const dist = resolve(root, "dist");
const base = (process.env.SITE_BASE ?? "/rob-mcp").replace(/\/$/, "");
const origin = process.env.SITE_CANONICAL_URL ?? "https://oyusypenko.github.io";
const expectedRoutes = [
  "/",
  "/docs/",
  "/docs/getting-started/local/",
  "/docs/getting-started/hosted/",
  "/docs/mcp/",
  "/docs/api/",
  "/docs/tools/",
  "/docs/x402/",
  "/docs/safety/",
  "/docs/troubleshooting/",
  "/pricing/",
  "/faq/",
];

const manifest = await Bun.file(resolve(root, "site/src/generated/manifest.json")).json();
for (const tool of manifest.tools) {
  expectedRoutes.push(`/docs/tools/${tool.name}/`);
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return nested.flat();
}

function routeFile(route: string): string {
  return route === "/" ? resolve(dist, "index.html") : resolve(dist, route.slice(1), "index.html");
}

for (const route of expectedRoutes) {
  await stat(routeFile(route)).catch(() => {
    throw new Error(`missing generated route ${route}`);
  });
}

const files = await walk(dist);
const htmlFiles = files.filter((file) => file.endsWith(".html"));
const cssFiles = files.filter((file) => file.endsWith(".css"));
const jsFiles = files.filter((file) => file.endsWith(".js"));
const titles = new Set<string>();
const descriptions = new Set<string>();

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const label = relative(dist, file);
  const count = (pattern: RegExp) => [...html.matchAll(pattern)].length;
  if (!/<html[^>]+lang="en"/.test(html)) throw new Error(`${label}: missing lang`);
  if (count(/<h1(?:\s|>)/g) !== 1) throw new Error(`${label}: expected one h1`);
  if (!/<main[^>]+id="main-content"/.test(html)) throw new Error(`${label}: missing main landmark`);
  if (!/class="skip-link"/.test(html)) throw new Error(`${label}: missing skip link`);
  if (!/<meta name="description" content="[^"]{40,180}"/.test(html))
    throw new Error(`${label}: invalid meta description`);
  if (!/<link rel="canonical" href="https?:\/\/[^"]+"/.test(html))
    throw new Error(`${label}: missing absolute canonical`);
  for (const name of ["og:title", "og:description", "og:image"]) {
    if (!html.includes(`property="${name}"`)) throw new Error(`${label}: missing ${name}`);
  }
  if (!html.includes('name="twitter:card"')) throw new Error(`${label}: missing Twitter metadata`);
  if (!html.includes('type="application/ld+json"')) throw new Error(`${label}: missing JSON-LD`);
  if (/0x[a-fA-F0-9]{64}/.test(html)) throw new Error(`${label}: possible private key in output`);
  if (html.includes("X-PAYMENT")) throw new Error(`${label}: legacy x402 v1 header name in output`);
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1];
  if (!title || titles.has(title)) throw new Error(`${label}: duplicate/missing title`);
  if (!description || descriptions.has(description))
    throw new Error(`${label}: duplicate/missing description`);
  titles.add(title);
  descriptions.add(description);

  for (const href of html.matchAll(/href="([^"#?]+)"/g)) {
    const target = href[1]!;
    if (!target.startsWith(base + "/") && !target.startsWith("http"))
      throw new Error(`${label}: internal link does not use SITE_BASE: ${target}`);
    if (target.startsWith(base + "/")) {
      const route = target.slice(base.length);
      const targetFile = routeFile(route);
      await stat(targetFile).catch(() => {
        if (!/\.[a-z]+$/i.test(route)) {
          throw new Error(`${label}: broken internal link ${target}`);
        }
      });
    }
  }
}

const x402Page = await readFile(routeFile("/docs/x402/"), "utf8");
for (const header of ["PAYMENT-REQUIRED", "PAYMENT-SIGNATURE", "PAYMENT-RESPONSE"]) {
  if (!x402Page.includes(header)) {
    throw new Error(`x402 guide is missing D-24 header ${header}`);
  }
}

for (const assetType of [
  { files: cssFiles, limit: 50 * 1024, label: "CSS" },
  { files: jsFiles, limit: 100 * 1024, label: "client JavaScript" },
]) {
  let compressed = 0;
  for (const file of assetType.files) {
    compressed += gzipSync(await Bun.file(file).arrayBuffer()).byteLength;
  }
  if (compressed > assetType.limit) {
    throw new Error(`${assetType.label} budget exceeded: ${compressed} > ${assetType.limit}`);
  }
  console.log(`${assetType.label}: ${compressed} compressed bytes`);
}

const sitemap = await readFile(resolve(dist, "sitemap-0.xml"), "utf8").catch(async () =>
  readFile(resolve(dist, "sitemap-index.xml"), "utf8"),
);
if (!sitemap.includes(origin)) throw new Error("sitemap is not absolute");
for (const required of ["robots.txt", "llms.txt", "404.html"]) {
  await stat(resolve(dist, required)).catch(() => {
    throw new Error(`missing ${required}`);
  });
}

console.log(
  `site:check validated ${htmlFiles.length} HTML pages, links, metadata, structured data, safety, and budgets`,
);
