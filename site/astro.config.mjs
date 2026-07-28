import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Astro static/site/base, loaders, and Pages deployment APIs verified against official docs
// on 2026-07-29 after Context7 returned its quota error (spec-authority fallback).
const site = process.env.SITE_CANONICAL_URL ?? "https://oyusypenko.github.io";
const base = process.env.SITE_BASE ?? "/rob-mcp";

export default defineConfig({
  site,
  base,
  output: "static",
  outDir: "../dist",
  trailingSlash: "always",
  integrations: [sitemap()],
  vite: {
    build: {
      cssMinify: true,
    },
  },
});
