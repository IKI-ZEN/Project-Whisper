# Cloudflare AI Crawl Control — Reference

Cloudflare AI Crawl Control (formerly AI Audit) is a dashboard product that gives visibility into AI crawler activity on your domain and lets you create allow/block rules per crawler. It works automatically on all Cloudflare plans with zero configuration once the domain is proxied through CF.

> **Availability**: All plans (activates automatically when domain is CF-proxied). Pay Per Crawl pricing is in private beta.

> **Not a Workers binding.** No `wrangler.toml` entries and no `env.d.ts` changes. This is a Cloudflare dashboard product.

---

## Table of Contents

1. [What It Does](#1-what-it-does)
2. [Current State in Project Whisper](#2-current-state-in-project-whisper)
3. [Why It Matters](#3-why-it-matters)
4. [Recommended Actions](#4-recommended-actions)
5. [Open Questions](#5-open-questions)
6. [Further Reading](#6-further-reading)

---

## 1. What It Does

- **Crawler visibility** — shows which AI crawlers (OpenAI, Anthropic, Google, Common Crawl, etc.) are hitting the domain, with request volume and crawled paths
- **Allow/block rules** — per-crawler rules applied globally across the domain
- **`robots.txt` compliance tracking** — shows which crawlers are violating `robots.txt` directives (only useful if a `robots.txt` exists)
- **Pay Per Crawl** (private beta) — charge AI crawlers per page crawled; compatible with `robots.txt`

---

## 2. Current State in Project Whisper

### No `robots.txt`

`public/` contains `chart.js`, `environments.html`, `vibe.html`, `tools.html`, and other static assets but no `robots.txt`. AI crawlers that honour `robots.txt` before fetching receive no signal about what is or is not indexable. The `robots.txt` compliance tracking feature in AI Crawl Control has nothing to report without this file.

The `[assets]` binding in `wrangler.toml` serves everything in `public/` statically — adding `public/robots.txt` requires no router changes and takes effect immediately on the next deploy.

### Partial `<meta name="robots" content="noindex"/>` coverage

Server-rendered pages that include the noindex meta tag:

| Page | File |
|------|------|
| App pages (`/app/:id`) | `src/routes/pages/appPage.ts:19` |
| Environment pages (`/env/:id`) | `src/routes/pages/envPage.ts:21` |

Pages **not** covered:

- `/` (main chat page) — `src/routes/pages/chatPage.ts`
- `/build/:id` (app builder page)
- `/vibe.html`, `/tools.html`, `/environments.html` (static files in `public/`)
- `GET /api/openapi.json` (OpenAPI spec — not crawlable in the traditional sense, but will be fetched by crawlers discovering the path)

The meta tag approach is also weaker than `robots.txt`: it requires the crawler to fetch and parse the full HTML page before seeing the directive. `robots.txt` prevents the fetch entirely for compliant crawlers.

---

## 3. Why It Matters

### Generated content is a crawl target

Whisper generates full HTML apps (via the app builder), vibes (CSS + layout components), environment configurations, and pipeline outputs. At a public domain, AI training crawlers will attempt to index this content. The vault stores raw prompts and model responses — if any surface in public-facing pages, they could be scraped and included in training data.

### `robots.txt` compliance tracking requires a `robots.txt`

Without a `robots.txt`, the compliance tracking feature in AI Crawl Control has no baseline to measure against. Adding the file is a prerequisite for meaningful crawler behaviour analysis.

### AI Search crawler vs. AI Crawl Control — coordination needed

The AI Search overview (see `docs/cloudflare-ai-search.md`) notes that AI Search instances can crawl web URLs for data ingestion. If a Whisper deployment uses AI Search to index its own documentation at the same domain, CF's own AI Search crawler needs to be on the explicit allow list. A blanket block rule in AI Crawl Control would break AI Search data source indexing. The `User-agent` string for the CF AI Search crawler is still to be confirmed (see Open Questions).

### OpenAPI spec as a crawl target

`GET /api/openapi.json` documents the full API surface. AI training services will discover and index it. It is not sensitive in itself (it describes a public API), but API Shield benefits from this spec staying authoritative — if crawlers index a stale copy, it could cause confusion. No action required beyond being intentional about what the spec says.

---

## 4. Recommended Actions

### Immediate (code — no dashboard required)

**1. Add `public/robots.txt`.**

Minimum content to match the existing `<meta noindex>` intent and leave room for CF AI Search crawler access:

```
User-agent: *
Disallow: /app/
Disallow: /build/
Disallow: /env/
Disallow: /api/

# CF AI Search crawler — allow docs indexing if configured as a data source
# User-agent: CF-AI-Search
# Allow: /
```

The `[assets]` binding in `wrangler.toml` serves `public/` statically. `robots.txt` at the root is served automatically with no router changes.

**2. Extend `<meta name="robots" content="noindex"/>` to remaining server-rendered pages.**

Files to update:
- `src/routes/pages/chatPage.ts` — add noindex meta to the `<head>`
- Build page handler (if server-rendered) — same

Static files in `public/` (`vibe.html`, `tools.html`, `environments.html`) are served directly and cannot have server-injected headers. For those, `robots.txt` `Disallow` is the only mechanism.

### Dashboard (operations — no code)

3. AI Crawl Control monitoring activates automatically once the domain is CF-proxied — nothing to install or enable.
4. After a week of monitoring, review the crawler list and create explicit allow/block rules based on observed traffic.
5. Register for Pay Per Crawl private beta if the generated app/vibe content is considered a content asset worth monetising.

---

## 5. Open Questions

- What is the named `User-agent` string for the Cloudflare AI Search crawler? Needed for an explicit `Allow` rule in `robots.txt` to prevent accidental blocking when AI Crawl Control blanket rules are tightened.
- Does Pay Per Crawl apply at the Worker level or the domain level? If domain-level, it would affect all traffic including legitimate API clients.
- Does the AI Crawl Control dashboard expose crawler activity via an API or Analytics Engine, or only in the UI? A `guard-rate`-style probe on crawler activity would be more actionable than a dashboard metric.

---

## 6. Further Reading

- **AI Crawl Control overview**: `https://developers.cloudflare.com/ai-crawl-control/`
- **robots.txt spec**: `https://www.robotstxt.org/robotstxt.html`
- **AI Search web crawling**: `docs/cloudflare-ai-search.md` — Web crawling feature
- **Related**: `docs/cloudflare-security-center.md` — Infrastructure inventory (surfaces public-facing assets)
