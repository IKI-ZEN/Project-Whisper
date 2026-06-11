# Cloudflare AI Search — Reference

Cloudflare AI Search is a managed search service that lets you index content and query it with natural language from a Workers binding, REST API, or MCP server. It handles vector indexing, embedding generation, and retrieval infrastructure automatically.

> **Availability**: All plans. Instances created after April 16, 2026 include managed storage, a vector index, and web crawling.

> **API shape change (2026)**: The `search()` binding method signature changed from `{ query: string; limit?: number; filters?: ... }` to `{ messages: Array<{ role: string; content: string }> }`. The `env.d.ts` type in Project Whisper reflects the old shape. See [Pending Actions](#6-pending-actions) below.

---

## Table of Contents

1. [What It Is](#1-what-it-is)
2. [Core Features](#2-core-features)
3. [Access Methods](#3-access-methods)
4. [How It Relates to Project Whisper](#4-how-it-relates-to-project-whisper)
5. [Pricing and Limits](#5-pricing-and-limits)
6. [Pending Actions](#6-pending-actions)
7. [Further Reading](#7-further-reading)

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

// Worker code — new conversation-aware signature
const results = await env.AI_SEARCH.search({
  messages: [{ role: 'user', content: 'how to configure sandbox' }],
})
```

> **Old shape (no longer valid)**: `env.AI_SEARCH.search({ query: "...", limit: 10, filters: {} })`
> Project Whisper's `env.d.ts` still types `AI_SEARCH` with the old shape; call sites in `vault.ts` and `atlas.ts` need updating before the binding is upgraded.

**Namespace binding** (per-sandbox isolation):

```typescript
// wrangler.toml
// [[ai_search_namespaces]]
// binding = "AI_SEARCH_NS"

// Worker code — resolve an instance by sandbox ID
const instance = env.AI_SEARCH_NS.get(sandboxId)
const results  = await instance.search({ messages: [{ role: 'user', content: query }] })

// Lifecycle ops
await env.AI_SEARCH_NS.create({ name: sandboxId })
await env.AI_SEARCH_NS.delete(sandboxId)
const list = await env.AI_SEARCH_NS.list()
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

### Current implementation status

AI Search is **implemented** in Project Whisper for vault semantic search. The binding is declared in `wrangler.toml` (commented out until provisioned) and the search endpoint is live.

### What was built

**`GET /api/vault/search?q=&limit=&tool=`** — natural language search over vault records.

```bash
# Find vault records about JSON extraction (semantic match, not substring)
GET /api/vault/search?q=JSON+schema+extraction&limit=10

# Filter by tool
GET /api/vault/search?q=temperature+sensitivity&tool=entropy&limit=5
```

Returns ranked vault records. Returns `503 {"ok":false,"error":"AI Search not configured"}` when the `AI_SEARCH` binding is not provisioned.

**Automatic indexing on create** — every `POST /api/vault` call fires a non-blocking `AI_SEARCH.upsert()` with the prompt text and `{ tool, model }` metadata. The search index stays current without a separate sync step.

> **Note on `upsert()`**: The promoted pattern for new instances (post April 16, 2026) is **automated data source indexing** rather than manual `upsert()` calls. Whether D1 is a supported automated source is still to be confirmed. Until then, the manual `upsert()` path remains in place.

**Rate limit**: 20 requests / minute per IP.

### Activating the binding

1. Create an AI Search instance named `whisper-vault` in the Cloudflare dashboard.
2. Uncomment the `[[ai_search]]` block in `wrangler.toml`:
   ```toml
   [[ai_search]]
   binding      = "AI_SEARCH"
   instance_name = "whisper-vault"
   ```
3. Deploy — existing vault records will be indexed on their next create; backfill requires a one-off script calling `AI_SEARCH.upsert()` over all records.

### Relationship to existing search and clustering

| Method | Endpoint | What it does |
|--------|----------|-------------|
| SQL `LIKE` | `GET /api/vault?q=` | Substring match on prompt + response text |
| Semantic (AI Search) | `GET /api/vault/search?q=` | Hybrid vector + BM25 ranking |
| K-means clustering | `POST /api/vault/analyze` | Unsupervised grouping — surface themes across the corpus |

The three are complementary: `LIKE` for exact keyword lookup, semantic search for conceptual queries, clustering for exploratory analysis.

### Not yet implemented

Atlas (`/api/atlas/library`) still uses only SQL text search + local embedding cache. AI Search indexing for Atlas is the logical next step when the instance is active.

### Known gaps (as of 2026-06-11)

| Item | Current state | Impact |
|------|--------------|--------|
| `env.d.ts` `AI_SEARCH` type | Old `{ query, limit, filters }` shape | tsc validates against stale interface — runtime will break when binding upgrades |
| `vault.ts` search call | `AI_SEARCH.search({ query, limit, filters })` | Will throw at runtime against new binding |
| `atlas.ts` nearest call | Same old `search()` shape | Same |
| Namespace model | Not adopted — one flat shared index | No per-sandbox isolation; metadata filters are the only scoping mechanism |
| Hybrid search | Not configured | Available; would improve vault search quality over current flat query |
| MCP endpoint | Not connected | Each instance exposes an MCP endpoint at `https://ai-search.cloudflare.com/v1/{id}/mcp` — usable by pipeline nodes or external agents without custom glue |
| Automated indexing | Manual `upsert()` on every vault write | Automated source indexing (if D1 is supported) would remove the sync burden entirely |

### Architecture opportunity: namespace model for per-sandbox isolation

The `ai_search_namespaces` binding enables one AI Search instance per sandbox:

- True data isolation — a sandbox's RAG results cannot surface another sandbox's documents, regardless of metadata filters
- Lifecycle matches sandbox lifecycle: `create()` on sandbox creation, `delete()` on sandbox deletion
- The built-in MCP endpoint per instance is automatically scoped to that sandbox's data, making it safe to expose to agents inside the sandbox

This is a medium-term migration — existing flat-index data would need re-indexing per sandbox. A lazy migration (re-index on first search hit per sandbox) is viable.

---

## 5. Pricing and Limits

See the official limits and pricing page:
`https://developers.cloudflare.com/ai-search/platform/limits-pricing/`

Key points:
- Available on all plans (Free, Pro, Business, Enterprise).
- Metered by number of indexed records and search requests.
- New instances (post April 16, 2026) include managed storage; older instances must bring external storage (R2 or similar).

---

## 6. Pending Actions

These items are confirmed necessary based on API documentation review (2026-06-11). None are breaking today, but will become breaking as the CF binding version is updated.

### Immediate (no infrastructure change)

1. **Update `src/types/env.d.ts`** — retype `AI_SEARCH` to match the current `ai_search` direct-instance shape:
   - `search({ messages: Array<{ role: string; content: string }>, limit?: number }): Promise<{ results: [...] }>`
   - Add `chatCompletions()`, `info()`, `stats()` — exact signatures still to be confirmed from the instance methods reference doc
   - Assess whether `upsert()` / `delete()` remain on the instance or moved elsewhere
2. **Update `src/routes/vault.ts`** — change `AI_SEARCH.search({ query, limit, filters })` to `AI_SEARCH.search({ messages: [{ role: 'user', content: q }] })`
3. **Update `src/routes/atlas.ts`** — same search shape change

### Open questions (need instance methods reference doc)

- Does the new `ai_search` binding retain `upsert()` / `delete()`?
- What is the `chatCompletions()` signature? Does it accept a `system` field?
- What is `items` — a property or a method?
- Is D1 a supported automated indexing source (to replace manual `upsert()` calls)?
- What is the named `User-agent` string for the CF AI Search crawler (needed for `public/robots.txt`)

---

## 7. Further Reading

- **Get started**: `https://developers.cloudflare.com/ai-search/get-started/`
- **Data sources & indexing**: `https://developers.cloudflare.com/ai-search/configuration/indexing/`
- **Metadata filtering**: `https://developers.cloudflare.com/ai-search/configuration/indexing/metadata/`
- **Hybrid search**: `https://developers.cloudflare.com/ai-search/configuration/indexing/hybrid-search/`
- **MCP endpoint**: `https://developers.cloudflare.com/ai-search/api/search/mcp/`
- **Namespaces**: `https://developers.cloudflare.com/ai-search/api/namespaces/`
- **Related products**: Vectorize (custom vector DB), Workers AI (embedding models), AI Gateway (gateway + caching for AI calls)
