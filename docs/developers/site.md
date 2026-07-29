# rob-mcp — marketing and documentation site

The public site is the discoverable, human-readable presentation of rob-mcp. It explains the
product, documents every capability that actually exists, and gives agents and developers
copy-paste paths into local MCP, hosted MCP, and the JSON API. It is a **derived presentation
layer**, not a third product surface or a second source of truth (D-23).

## Authority and derivation

Site copy must trace to the canonical repository source below. A page build fails rather than
publishing a conflicting fact.

| Site fact                                                 | Canonical source                                              |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| Product boundary, flows, phases, deployment, safety gates | `docs/developers/architecture.md`                             |
| Tool names, schemas, semantics, tiers, error behavior     | `src/tools/definitions.ts` + `docs/developers/tools.md`       |
| Exact per-call prices                                     | `src/pricing.ts`, verified against `docs/developers/tools.md` |
| Decisions, availability gates, unresolved constraints     | `docs/developers/design-decisions.md`                         |
| Chain, quote-asset, venue, and issuer facts               | `data/chains.json` + verified `data/tokens/<chainId>.json`    |
| Configuration names and documented defaults               | `.env.example` + `docs/developers/runbooks/env-inventory.md`  |
| Installation and repository-level commands                | root `package.json` + `README.md`                             |

The site build generates a temporary, ignored content manifest from those sources before Astro
renders pages. Handwritten Markdown may explain a fact but must not independently define tool
availability, schemas, prices, chain addresses, config defaults, or phase state. Tool reference
pages are generated from the implemented `toolDefinitions`; planned tools may appear only in a
clearly labeled roadmap section sourced from `tools.md` and the decisions log.

The generator must expose an explicit availability label such as `implemented`, `implemented but
live-gated`, or `planned`. In particular, D-13/O-8, O-5, and O-9 must prevent the site from implying
that Robinhood price-bearing calls, mainnet paid redistribution, or local trading execution are
ready when their gates remain open.

## Technology and repository shape

Use Astro's static output with build-time content collections. Keep `site/` in this repository,
with Astro and site-tooling dependencies pinned exactly in the root `package.json` and the single
root lockfile. Do not add a workspace or a second package manifest: D-1's one-package ruling is
unchanged. Prefer zero client JavaScript; use small islands only where progressive enhancement
materially helps, such as navigation, local search, and accessible copy buttons.

Astro static output, content loaders, canonical `site`/`base` configuration, and GitHub Pages
deployment assumptions were checked against the official Astro documentation on **2026-07-29**:

- <https://docs.astro.build/en/guides/deploy/github/>
- <https://docs.astro.build/en/reference/content-loader-reference/>
- <https://docs.astro.build/en/reference/configuration-reference/#site>

Re-verify the current Astro API through context7 before implementation and before a version bump;
if context7 is unavailable, use the official Astro documentation and record the as-of date.

The implementation adds root scripts with these responsibilities (names are reserved here; they
do not exist until Phase G implementation):

- `site:data` — generate the ignored manifest from canonical sources.
- `site:dev` — regenerate data, then run the local Astro development server.
- `site:build` — regenerate, validate derivation, and create static output.
- `site:check` — validate links, snippets, metadata, accessibility, structured data, pricing
  parity, and performance budgets without deploying.
- `site:lighthouse` — serve the built site in the controlled profile and enforce the representative
  performance, accessibility, best-practices, and SEO thresholds.

`bun run validate` runs `site:check` everywhere and `site:lighthouse` in CI.

## Information architecture

- `/` — concise value proposition; implemented-capability summary; local, hosted, and API paths;
  provenance and no-custody trust signals; primary quickstart calls to action.
- `/docs/` — documentation overview and concepts: one core/two surfaces, registries, provenance,
  liveness, free tier, and x402.
- `/docs/getting-started/local/` — copy-paste source-checkout + Bun stdio MCP setup until the npm
  package is published, required RPC configuration, client configuration examples, and a first
  `list_stock_tokens` call. Published-package commands may appear only after the package exists.
- `/docs/getting-started/hosted/` — hosted MCP and JSON API connection, free discovery, testnet
  x402 prerequisites, and a first paid call. Use `$ROB_MCP_URL`, never a fictitious production
  host.
- `/docs/mcp/` — stdio and Streamable HTTP client setup, request lifecycle, structured output,
  and errors.
- `/docs/api/` — route convention, headers, JSON bodies, responses, error envelope, provenance,
  limits, and copy-paste `curl` examples.
- `/docs/tools/` — generated index of implemented tools and one generated page per implemented
  tool. Local-only trading tools are separated and visibly gated by Phase F/O-9.
- `/docs/x402/` — 402 challenge via `PAYMENT-REQUIRED`, EIP-3009 signature,
  `PAYMENT-SIGNATURE` retry, facilitator verify/settle, and `PAYMENT-RESPONSE` (D-24); Base
  Sepolia first and Base mainnet only when O-5 is resolved.
- `/docs/safety/` — no custody, no financial advice, oracle/liveness failure behavior, source
  provenance, local-only trading, bounded requests, and responsible use.
- `/docs/troubleshooting/` — configuration failures and typed runtime failures, including RPC
  chain mismatch, HTTP 402/413, free-tier exhaustion, `SEQUENCER_STATUS_UNAVAILABLE`,
  `NO_VERIFIED_POOL`, stale/paused oracles, and unavailable facilitators.
- `/pricing/` — canonical pricing and free-tier explanation defined below.
- `/faq/` — account, subscription, wallet, USDC, supported chains, availability, custody,
  provenance, and trading-boundary questions.

Documentation pages include visible breadcrumbs, previous/next navigation where useful, a
persistent table of contents for long pages, and an obvious path back to the repository and issue
tracker. Search is optional progressive enhancement; all navigation and content remain usable
without JavaScript.

## Capability and example contract

Every implemented definition in `src/tools/definitions.ts` gets exactly one reference page. The
page derives its title, description, surfaces, tier, and input/output schema, then supplements
those facts with canonical semantics from `tools.md`. Validation fails for an implemented tool
without a page, a page without an implemented tool unless explicitly marked planned, or a paid
tool without a matching pricing entry.

Examples must be runnable after substituting documented environment variables:

- shell blocks start from a clean install/run command and declare required variables;
- JSON API examples use `POST /api/v1/tools/<tool-name>`, `Content-Type: application/json`, and a
  schema-valid body;
- hosted examples distinguish an initial 402 response from an x402-aware retry;
- payment tutorials use Base Sepolia and a throwaway test wallet only; no private key, mnemonic,
  Robinhood credential, or personal connector URL appears in source or rendered output;
- sample responses use deterministic fixtures and unmistakably label them as examples. Static
  pages never present fixture prices, premiums, TVL, or volume as live market observations;
- source snippets and generated schemas are checked during `site:check`; integration examples run
  against fakes or the testnet smoke path where applicable.

Each tool page includes purpose, availability, tier/price, supported surfaces, inputs, output with
provenance, typed errors, limits, a minimal example, and a link to the relevant concept or
troubleshooting page.

## Pricing page

`/pricing/` is a dedicated decision page, not a duplicate pricing source. Its cards/table are
rendered from `src/pricing.ts`; `tools.md` supplies the documented tier and semantics. It must:

- show every implemented paid tool and its exact USDC per-call price;
- identify `/healthz` and `list_stock_tokens` as never paywalled and explain that paid routes get
  the deployment's `FREE_CALLS_PER_DAY` allowance before returning 402;
- label any documented free-call number as a configurable default, not a guaranteed universal
  deployment value;
- explain the complete x402 flow and the Base Sepolia/Base mainnet distinction;
- state plainly that rob-mcp requires no rob-mcp account, subscription, or API key; the payer
  supplies an x402-compatible client/wallet and USDC;
- state that mainnet payment availability remains gated by O-5 until that decision is resolved;
- include an FAQ and calls to action for free discovery, MCP setup, API examples, and source
  inspection.

The pricing drift check is a required validation stage. It compares implemented hosted paid tool
definitions with `PRICING`, verifies the exact values in the `tools.md` table, rejects prices on
free/local-only definitions, and builds the page only from the resulting validated manifest. A
price cannot be changed through site content; D-7 requires a recorded pricing decision.

## Search, sharing, and structured data

Every indexable page has a unique descriptive `<title>`, meta description, one visible `h1`,
absolute canonical URL, Open Graph/Twitter metadata, social image, and stable human-readable URL.
The build generates `sitemap.xml`, `robots.txt`, `404.html`, and a short `llms.txt` that points
agents to the canonical documentation and source. Draft, fixture, search-result, and error pages
are `noindex`.

Use JSON-LD only when its visible content and canonical sources support it:

- `WebSite` globally;
- `SoftwareApplication`/`DeveloperApplication` on the product page;
- `TechArticle` on substantial documentation pages;
- `BreadcrumbList` where the same breadcrumb is visible;
- `FAQPage` only on pages that visibly contain the complete questions and answers.

Do not claim search-result eligibility or fabricate reviews, ratings, organization details, offers,
availability, or release dates. Validate structured data and canonical links in CI. Google Search
guidance for sitemaps, breadcrumbs, and software application data was reviewed on **2026-07-29**:

- <https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview>
- <https://developers.google.com/search/docs/appearance/structured-data/breadcrumb>
- <https://developers.google.com/search/docs/appearance/structured-data/software-app>

## Accessibility and performance

Target WCAG 2.2 AA: semantic landmarks and heading order, keyboard-complete interaction, skip link,
visible focus, sufficient contrast, accessible names/status announcements for copy buttons,
descriptive link text and alternative text, no color-only meaning, reduced-motion support,
responsive reflow, and appropriately sized touch targets. Automated accessibility checks cover
representative templates in CI; keyboard and screen-reader smoke checks remain part of release
review.

Static HTML is the performance strategy. Self-host/subset fonts, reserve media dimensions,
optimize responsive images, avoid third-party trackers by default, and hydrate only isolated
controls. Representative pages must score at least 95 for Lighthouse performance,
accessibility, best practices, and SEO in the controlled CI profile. Field goals follow the
Core Web Vitals guidance reviewed on **2026-07-29**: LCP at or below 2.5 seconds, INP at or below
200 ms, and CLS at or below 0.1 at the 75th percentile. Budgets are at most 100 KiB compressed
client JavaScript and 50 KiB compressed CSS per ordinary page; exceeding one requires a recorded
architecture amendment with evidence.

Reference: <https://web.dev/articles/vitals>

## Safety copy requirements

Safety language is prominent, plain, and consistent:

- rob-mcp is a data service, not financial advice or an execution venue;
- the hosted service never receives private keys, mnemonics, Robinhood credentials, personal
  Trading MCP URLs, or user funds;
- x402 payment is signed by the payer and facilitator-settled to the receive-only service address;
- the trading wrapper runs locally and is never hosted or exposed by the paid service;
- prices and market-derived values are live reads with source/time/pool provenance, never static
  promises; unsafe, stale, paused, or liveness-unverified reads fail closed;
- chain/token/venue support is the verified registry state, not marketing aspiration.

No site copy may embed hardcoded live prices, premiums, TVL, volume, or thresholds derived from
them. Product prices, protocol facts, verified addresses, and documented operator policy are
allowed only through their canonical derivation path.

## Deployment and ownership

`rob-surface` owns the Astro implementation, static build, GitHub Pages workflow, and production
deployment. `rob-architect` owns this design, source mapping, product-copy compliance, and review
of any behavior claim; `rob-security` reviews no-custody and payment-boundary copy when those
claims change.

Pull requests run generation and all site checks but do not deploy. A push to the protected main
branch deploys the exact validated static artifact through the official Astro GitHub Pages action.
Astro's `site` and `base` values must match the final public URL so canonical URLs, assets, and the
sitemap are correct. The API remains on Fly.io; the site does not proxy it, store secrets, or gain
runtime access to service credentials. The canonical hostname remains O-10 and blocks production
SEO deployment, not local implementation.

## Definition of done

- Every implemented tool has a generated, accurate reference page and schema-valid copy-paste
  examples.
- Pricing, tool, config, chain, and availability validation proves the site is derived.
- Home, documentation, x402, safety, troubleshooting, pricing, and FAQ routes are complete.
- Metadata, sitemap, robots, canonical URLs, structured data, internal links, accessibility, and
  performance checks pass.
- The root package/lockfile remain the only package authority; all dependency versions are exact.
- GitHub Pages publishes the validated main-branch artifact only after O-10 supplies the canonical
  URL; Fly/API deployment and the two runtime surfaces remain unchanged.
