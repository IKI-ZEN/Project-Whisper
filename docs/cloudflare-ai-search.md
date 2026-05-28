# Cloudflare AI Search — Reference

Cloudflare AI Search is a managed search service that lets you index content and query it with natural language from a Workers binding, REST API, or MCP server. It handles vector indexing, embedding generation, and retrieval infrastructure automatically.

> **Availability**: All plans. Instances created after April 16, 2026 include managed storage, a vector index, and web crawling.

---

## Table of Contents

1. [What It Is](#1-what-it-is)
2. [Core Features](#2-core-features)
3. [Access Methods](#3-access-methods)
4. [How It Relates to Project Whisper](#4-how-it-relates-to-project-whisper)
5. [Pricing and Limits](#5-pricing-and-limits)
6. [Further Reading](#6-further-reading)

---

## 1. What It Is

AI Search provides a ready-made retrieval pipeline:

- **Create an instance** — allocates storage, a vector index, and an embedding pipeline.
- **Give it data** — upload documents directly, point it at a web URL for crawling, or push records via the REST API.
- **Query with natural language** — send a plain-text query; AI Search returns ranked results using hybrid semantic + keyword matching.

No custom embedding pipeline, no vector database configuration, no HNSW tuning.

---

## 2. Core Features

| Feature | Description |
|---------|-------------|
| **Managed storage** | Built-in document storage per instance (new instances only — April 16, 2026+). |
| **Automated indexing** | Continuous re-indexing from a configured data source keeps search results fresh without manual reprocessing. |
| **Hybrid search** | Combines semantic (vector) and keyword (BM25) matching in a single query for higher accuracy across diverse queries. |
| **Metadata filtering** | Define custom metadata fields (category, version, language, etc.) and filter search results by field value. |
| **Web crawling** | Point an instance at a URL; the crawler discovers and indexes linked pages automatically. |
| **MCP endpoint** | Every instance exposes a built-in Model Context Protocol endpoint so AI agents can use search as a tool without custom glue code. |
| **Embeddable UI snippets** | Pre-built search components that can be embedded in a web page. |

---

## 3. Access Methods

### Workers binding

```typescript
// wrangler.toml
// [[ai_search]]
// binding = "AI_SEARCH"
// instance_name = "my-instance"

// Worker code
const results = await env.AI_SEARCH.search({ query: "how to configure sandbox" })
```

### REST API

```bash
curl "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai-search/instances/{instance_id}/search" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "how to configure sandbox"}'
```

### MCP endpoint

Each instance exposes:
```
https://ai-search.cloudflare.com/v1/{instance_id}/mcp
```

An AI agent can add this as an MCP tool to query the index in natural language without any additional plumbing.

---

## 4. How It Relates to Project Whisper

Project Whisper already has a **vault** of prompt/response pairs collected from every analysis tool run, and an Atlas **prompt library**. Both are currently queryable only via SQL (exact text match or LIKE queries). AI Search would enable natural-language retrieval over these corpora.

### Potential integration points

| Use case | Current state | With AI Search |
|----------|--------------|---------------|
| Vault semantic search | SQL `LIKE` on prompt text | `POST /api/vault/search` → AI Search query over indexed prompts |
| Atlas library discovery | SQL full-text on title/tags | Natural-language search: "find prompts about JSON extraction" |
| Sandbox context injection | Full history replay | Retrieve the top-K most relevant past turns for a given prompt |
| Agent memory | Session-scoped memory only | Per-agent persistent memory searchable by semantic similarity |

### Integration approach (if added)

1. Add `AI_SEARCH` binding to `wrangler.toml` and `src/types/env.d.ts`.
2. On vault record creation (`src/routes/vault.ts`), fire-and-forget an index upsert alongside the D1 write.
3. Add `GET /api/vault/search?q=<query>` that calls `env.AI_SEARCH.search({ query })` and returns matching vault records.
4. For Atlas: similarly index prompt entries on create/update.

No new npm dependencies — the binding is a native Workers API.

### Relationship to existing `embed()` + `kMeansClusters()`

The existing vault cluster analysis endpoint (`POST /api/vault/analyze`) uses Workers AI embeddings + k-means. AI Search would complement this: clustering reveals structure in the corpus; AI Search answers point queries against it.

---

## 5. Pricing and Limits

See the official limits and pricing page:
`https://developers.cloudflare.com/ai-search/platform/limits-pricing/`

Key points:
- Available on all plans (Free, Pro, Business, Enterprise).
- Metered by number of indexed records and search requests.
- New instances (post April 16, 2026) include managed storage; older instances must bring external storage (R2 or similar).

---

## 6. Further Reading

- **Get started**: `https://developers.cloudflare.com/ai-search/get-started/`
- **Data sources & indexing**: `https://developers.cloudflare.com/ai-search/configuration/indexing/`
- **Metadata filtering**: `https://developers.cloudflare.com/ai-search/configuration/indexing/metadata/`
- **Hybrid search**: `https://developers.cloudflare.com/ai-search/configuration/indexing/hybrid-search/`
- **MCP endpoint**: `https://developers.cloudflare.com/ai-search/api/search/mcp/`
- **Related products**: Vectorize (custom vector DB), Workers AI (embedding models), AI Gateway (gateway + caching for AI calls)
