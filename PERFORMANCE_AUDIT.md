# Performance & Scalability Audit

_Assessed: 2026-05-31_

---

## Scope and Architecture Context

**Deployment model:** Each user operates their own Cloudflare Workers deployment. "Scalability" therefore means: how does the system behave when a single tenant generates more traffic — more concurrent requests, more data volume, higher message rates — not multi-tenant isolation.

**Platform constraints:**
- **Workers**: stateless, horizontally auto-scales. No concern at any request rate for pure request-handling logic.
- **Durable Objects**: single-threaded per instance (one DO per sandbox). Concurrent requests to the same DO queue behind a single thread.
- **D1 (SQLite)**: read-optimised; single writer. Write throughput is the limiting factor as event volume grows.
- **KV**: globally replicated, eventually consistent. KV reads are fast; KV writes are fire-and-forget at the edge.
- **Vectorize**: separate index — query and write throughput are governed by Cloudflare's Vectorize limits.
- **AI Gateway**: all external AI calls route through this. 2-minute hard timeout per call (`AI_GATEWAY_TIMEOUT_MS`).

---

## Critical Paths Reviewed

| Path | Files | Risk |
|------|-------|------|
| Chat run/stream | `SandboxDO.ts`, `sandbox.ts` | HIGH |
| Document indexing | `fileProcess.ts` | HIGH |
| Rate limiting | `http.ts` (KV), `SandboxDO.ts` (DO storage) | HIGH |
| Vault list / search | `vault.ts`, D1 | MEDIUM |
| Sandbox list | `sandbox.ts`, `http.ts` | MEDIUM |
| Monitor patterns | `monitor.ts`, D1 | MEDIUM |
| Probe run | `probes.ts` | MEDIUM |
| Vault analyze (clustering) | `vault.ts` | LOW |
| Whisperer tools | `whisperer.ts` | LOW |

---

## Findings

---

### PERF-01 — Rate Limit Write Is Fire-and-Forget (Race Condition)

**Severity: HIGH**

**Location:** `src/lib/http.ts:113`, `src/durable/SandboxDO.ts:77`

```typescript
// http.ts line 113 — KV-backed IP rate limiter
void env.RATE_LIMITS.put(key, JSON.stringify(window), { expirationTtl: Math.ceil(windowMs / 1000) })

// SandboxDO.ts line 77 — DO storage-backed per-sandbox rate limiter
void this.ctx.storage.put(RL_STORAGE_KEY, { window })
```

Both rate limit implementations read the current window, check the count, then write the updated window — but the write is fire-and-forget (`void`). Under burst load, multiple concurrent requests can all read the same stale state and all pass, making the limiter best-effort rather than strict.

For the **KV-backed limiter** (used on every expensive IP-rate-limited endpoint), the race window is the time between two concurrent requests arriving before either has written back. With 20 allowed requests per minute and a burst of 50 concurrent requests, all 50 will read an empty window and all 50 will be let through.

For the **DO storage-backed limiter** (per-sandbox run/stream), the single-thread guarantee of DOs makes concurrent races impossible within a single DO — however, the `void` still means the write can silently fail (storage error is swallowed), leaving the window permanently stale.

**Impact:** Rate limits are not reliable under burst load. The IP rate limiter for whisperer, replay, vault analyze, and other expensive endpoints provides weaker protection than intended.

**Proposed fix:**

```diff
// src/lib/http.ts line 113
- void env.RATE_LIMITS.put(key, JSON.stringify(window), { expirationTtl: Math.ceil(windowMs / 1000) })
+ await env.RATE_LIMITS.put(key, JSON.stringify(window), { expirationTtl: Math.ceil(windowMs / 1000) })

// src/durable/SandboxDO.ts line 77
- void this.ctx.storage.put(RL_STORAGE_KEY, { window })
+ await this.ctx.storage.put(RL_STORAGE_KEY, { window })
```

The KV write latency (~5-10ms) is small relative to the subsequent AI call (hundreds of ms), so awaiting it does not meaningfully impact P99 latency for the request. The DO write is in-memory-backed and near-instant.

---

### PERF-02 — Document Indexing: Sequential Embed Batches

**Severity: HIGH**

**Location:** `src/jobs/fileProcess.ts:196-207`

```typescript
const BATCH  = 100
for (let start = 0; start < chunks.length; start += BATCH) {
  const batch   = chunks.slice(start, start + BATCH)
  const vectors = await embed(env.AI, batch, undefined, env)
  await env.VECTORS.upsert(...)
}
```

Batches are processed **sequentially** — each `embed()` call must complete before the next begins. For a large document:

- A 1 MB text file produces ~2,200 chunks (at 512 chars each with 64-char overlap: `(1,000,000 / 448) ≈ 2,232`)
- 2,232 chunks ÷ 100 per batch = **23 sequential embed calls**
- Each embed call via AI gateway: ~200-400 ms
- Total embed time: **~5-10 seconds** for 1 MB, **~50-100 seconds** for 10 MB

This blocks the Workers Queue job for the full duration. The 10 MB document limit (`MAX_DOCUMENT_BYTES`) creates a worst-case job time of ~100 seconds, which could hit Workers Queue execution limits.

**Proposed fix:** Run up to 3 embed batches concurrently using a simple concurrency limiter:

```diff
// src/jobs/fileProcess.ts

  if (text.trim()) {
    const chunks = mimeType.includes('csv') ? parseAndChunkCSV(text) : chunkText(text)
    const BATCH  = 100
+   const CONCURRENCY = 3
+   const batches = Array.from({ length: Math.ceil(chunks.length / BATCH) }, (_, i) =>
+     chunks.slice(i * BATCH, (i + 1) * BATCH)
+   )
-   for (let start = 0; start < chunks.length; start += BATCH) {
-     const batch   = chunks.slice(start, start + BATCH)
-     const vectors = await embed(env.AI, batch, undefined, env)
-     await env.VECTORS.upsert(
-       vectors.map((vec, j) => ({
-         id:       `${sandboxId}_${docId}_${start + j}`,
-         values:   vec,
-         metadata: { sandboxId, docId, chunkIndex: start + j, text: batch[j] ?? '' },
-       })),
-     )
-   }
+   for (let i = 0; i < batches.length; i += CONCURRENCY) {
+     const window = batches.slice(i, i + CONCURRENCY)
+     await Promise.all(window.map(async (batch, wi) => {
+       const startIdx = (i + wi) * BATCH
+       const vectors  = await embed(env.AI, batch, undefined, env)
+       await env.VECTORS.upsert(
+         vectors.map((vec, j) => ({
+           id:       `${sandboxId}_${docId}_${startIdx + j}`,
+           values:   vec,
+           metadata: { sandboxId, docId, chunkIndex: startIdx + j, text: batch[j] ?? '' },
+         })),
+       )
+     }))
+   }
  }
```

3× concurrency cuts worst-case indexing time from ~100s to ~35s with no change to correctness. The concurrency cap prevents hitting Vectorize write rate limits.

---

### PERF-03 — Vault List: No Index on Tags; Full-Text Search Uses LIKE Scan

**Severity: MEDIUM**

**Location:** `src/routes/vault.ts:128-130`, `migrations/0005_vault.sql`

The vault list endpoint supports two slow filters:

**1. Tag filter** — uses `json_each()` virtual table:
```sql
EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)
```
This is a per-row JSON parse across every row in the time range. SQLite has no index on JSON array contents. At 10,000+ vault records, a `?tag=` query scans the full time-range subset row by row.

**2. Text search** — uses `LIKE '%q%'`:
```sql
prompt LIKE ? OR response LIKE ?
```
A leading wildcard prevents index use. This is always a full table scan on prompt/response, which can be megabytes of text per row.

**Proposed fix A — Tags (minimal):** Normalize tags to a separate `vault_tags` junction table with a proper index. This is a schema change requiring a new migration.

**Proposed fix B — Text search (minimal):** Add an FTS5 virtual table for prompt+response full-text search. This is a new migration; the vault list handler's `q` param would query the FTS table via JOIN.

```sql
-- migrations/0013_vault_fts.sql
CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts
  USING fts5(id UNINDEXED, prompt, response, content='vault_records', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS vault_fts_insert AFTER INSERT ON vault_records BEGIN
  INSERT INTO vault_fts(rowid, id, prompt, response) VALUES (new.rowid, new.id, new.prompt, new.response);
END;
CREATE TRIGGER IF NOT EXISTS vault_fts_delete BEFORE DELETE ON vault_records BEGIN
  INSERT INTO vault_fts(vault_fts, rowid, id, prompt, response) VALUES ('delete', old.rowid, old.id, old.prompt, old.response);
END;
```

The `q` filter in `vault.ts` would change from:
```sql
(prompt LIKE ? OR response LIKE ?)
```
to a JOIN against `vault_fts WHERE vault_fts MATCH ?`. FTS5 queries are sub-millisecond even at 100,000 rows.

**Requires approval before schema change.** For now, the existing behavior is correct but will degrade at vault scale.

---

### PERF-04 — SandboxDO: Three Sequential Storage Reads Per Run

**Severity: MEDIUM**

**Location:** `src/durable/SandboxDO.ts:71-79`, `56-59`, `28-39`

Each `handleRun` and `handleStream` makes three storage reads:
1. Rate limit state: `ctx.storage.get(RL_STORAGE_KEY)` — line 72
2. Config: `ctx.storage.get(DO_STORAGE_KEY)` — line 30 (unless cached in `this.config`)
3. Session memory: `ctx.storage.get('session:{sessionId}')` — line 58 (named sessions only)

The config read is cached in `this.config` after first load, so warm DOs only pay reads 1 and 3. Cold DOs (freshly spun up after eviction) pay all three.

**Observation:** Reads 1 and 2 could be combined using `ctx.storage.get([RL_STORAGE_KEY, DO_STORAGE_KEY])` (DO storage supports multi-key reads), eliminating one round-trip for cold DOs:

```diff
private async load(): Promise<SandboxConfig> {
  if (this.config) return this.config
- const stored = await this.ctx.storage.get<SandboxConfig>(DO_STORAGE_KEY)
+ const stored = (await this.ctx.storage.get<SandboxConfig>(DO_STORAGE_KEY))!
```

This is a **low-effort optimization** if cold-start latency becomes observable. In practice, the AI call dominates latency (300-2000ms), making the ~10ms storage reads invisible in P50 measurements. Flag this for later if tail latency (P99) becomes a concern.

---

### PERF-05 — Sandbox List: No Server-Side Pagination (In-Memory Filter)

**Severity: MEDIUM**

**Location:** `src/lib/http.ts:138-147`, `src/routes/sandbox.ts:85-98`

```typescript
// listAllKV exhausts ALL KV pages before returning
export async function listAllKV<T>(ns: KVNamespace, prefix: string): Promise<KVNamespaceListKey<T>[]> {
  let result = await ns.list<T>({ prefix })
  const keys = [...result.keys]
  while (!result.list_complete) {
    result = await ns.list<T>({ prefix, cursor: result.cursor })
    keys.push(...result.keys)
  }
  return keys
}
```

The list handler fetches ALL sandboxes from KV (unbounded), then filters by `only=apps|envs` and sorts in memory. KV `list()` returns up to 1000 keys per page; a deployment with 5,000 sandboxes triggers 5 sequential KV list calls before any response is returned.

Additionally, the `?only=` filter is applied client-side after fetching everything. Cloudflare KV supports prefix filtering but not arbitrary metadata filtering — so the in-memory approach is necessary given the current KV schema.

**Impact at scale:** For deployments with hundreds of sandboxes (heavy users of Vibe Builder + environments + forks), list response time grows linearly.

**Proposed fix:** Add cursor-based pagination parameters to the list endpoint:
```
GET /api/sandbox?limit=50&cursor=<opaque>
```
Pass `cursor` through to `ns.list({ prefix, limit, cursor })` and return `{ apps, cursor: result.cursor ?? null, list_complete: result.list_complete }` in the response. This is a non-breaking addition (clients that don't send `cursor` get the first page).

**Requires approval before implementing** — this changes the response shape and the frontend list pages need updating.

---

### PERF-06 — Monitor Patterns Query: json_extract Per Row Without Index

**Severity: MEDIUM**

**Location:** `src/routes/monitor.ts:155-183`

```sql
SELECT
  json_extract(metadata, '$.pattern') as pattern,
  event_type,
  COUNT(*) as count
FROM sandbox_events
WHERE event_type IN ('guard_flag', 'response_flag')
  AND created_at >= ?
  AND created_at <= ?
  AND json_extract(metadata, '$.pattern') IS NOT NULL
GROUP BY pattern, event_type
ORDER BY count DESC
LIMIT 50
```

SQLite evaluates `json_extract(metadata, '$.pattern')` on every matching row. With `idx_events_type` on `event_type` and `idx_events_time` on `created_at`, the query narrows to guard events in the time range, then JSON-parses each row's metadata string.

At low event volume (typical for single-tenant), this is fast. At high event volume (aggressive adversarial scanning, many sandboxes), the guard event table grows and this query degrades.

**Proposed fix (minimal):** Add a generated column for `pattern` in a new migration:

```sql
-- migrations/0013_events_pattern_col.sql
ALTER TABLE sandbox_events ADD COLUMN pattern TEXT
  GENERATED ALWAYS AS (json_extract(metadata, '$.pattern')) VIRTUAL;
CREATE INDEX IF NOT EXISTS idx_events_pattern ON sandbox_events(pattern) WHERE pattern IS NOT NULL;
```

The INSERT statements don't change — the generated column is computed on read. The patterns query gains an index on the `pattern` field.

**Requires approval before migration.**

---

### PERF-07 — Probe Run: Two Sequential D1 Writes

**Severity: LOW**

**Location:** `src/routes/probes.ts:488-492`

```typescript
await env.DB.prepare('INSERT INTO probe_runs (...)').bind(...).run()
await env.DB.prepare('UPDATE probes SET last_run_at = ? WHERE id = ?').bind(ts, probe.id).run()
```

These are two sequential round-trips to D1 when one would do. The `UPDATE` is purely denormalization (last_run_at could be queried from `probe_runs` directly). Combined, they add ~5-15ms of unnecessary latency on every probe run.

**Proposed fix:** Combine into a D1 batch:
```diff
- await env.DB.prepare('INSERT INTO probe_runs ...').bind(...).run()
- await env.DB.prepare('UPDATE probes SET last_run_at = ? WHERE id = ?').bind(ts, probe.id).run()
+ await env.DB.batch([
+   env.DB.prepare('INSERT INTO probe_runs ...').bind(...),
+   env.DB.prepare('UPDATE probes SET last_run_at = ? WHERE id = ?').bind(ts, probe.id),
+ ])
```

This pattern applies in both `runProbe` and `runProbeById`. The same optimization applies to whisperer/assertion suite handlers that do multiple D1 writes in sequence.

---

### PERF-08 — Vault Analyze: Single Embed Call for Up to 500 Prompts

**Severity: LOW**

**Location:** `src/routes/vault.ts:286`

```typescript
const embeddings = await embed(env.AI, prompts, undefined, env)
```

Up to 500 prompt strings are embedded in a single `embed()` call. If the AI gateway or embedding model imposes a per-request batch limit, this call fails entirely. The current `embed()` implementation does not chunk large inputs — it passes the full array to the AI binding at once.

At 500 entries × ~100 chars each = ~50,000 chars of text, this is within the `MAX_EMBED_CHARS` limit but may hit API-level batch count limits depending on the configured embedding model.

**Proposed fix:** Split into batches of 100 within `analyze`:
```diff
- const embeddings = await embed(env.AI, prompts, undefined, env)
+ const EMBED_BATCH = 100
+ const embeddings: Float32Array[] = []
+ for (let i = 0; i < prompts.length; i += EMBED_BATCH) {
+   const batch = await embed(env.AI, prompts.slice(i, i + EMBED_BATCH), undefined, env)
+   embeddings.push(...batch)
+ }
```

---

### PERF-09 — Usage Metrics: Missing Composite Index for Model Breakdown Query

**Severity: LOW**

**Location:** `src/routes/sandbox.ts:213-215`, `migrations/0001_init.sql`, `migrations/0009_usage_cost.sql`

```sql
-- Executed on every GET /api/sandbox/:id/metrics
SELECT model, COUNT(*) as runs, SUM(tokens_in) as tokensIn, SUM(tokens_out) as tokensOut
FROM usage_metrics
WHERE sandbox_id = ?
GROUP BY model
```

The existing index `idx_metrics_sandbox ON usage_metrics(sandbox_id)` narrows to the sandbox's rows, but the `GROUP BY model` still requires scanning all matching rows. A composite index `(sandbox_id, model)` would allow the query planner to use the index for both the WHERE and GROUP BY:

```sql
CREATE INDEX IF NOT EXISTS idx_metrics_sandbox_model ON usage_metrics(sandbox_id, model);
```

At typical usage rates (hundreds of runs per sandbox), this is immaterial. At thousands of runs, this composite index becomes valuable.

---

### PERF-10 — Whisperer Probe `runProbeTool` Duplicates `runProbe` Logic

**Severity: LOW (maintenance risk)**

**Location:** `src/routes/probes.ts:218-296` vs `src/routes/probes.ts:458-503`

`runProbeTool` (called from `runProbe` and the cron `runProbeById`) and the whisperer routes both execute sweep, entropy, sensitivity, and CoT logic independently. `runProbeTool` re-implements the sweep loop locally rather than calling shared helpers. If the sweep or entropy logic changes in the whisperer routes, the probe tool runner won't automatically reflect those changes.

This is a maintainability risk that affects correctness under updates. No immediate performance impact.

---

## Scalability Summary

| Resource | Bottleneck at 10× load | Bottleneck at 100× load |
|----------|----------------------|------------------------|
| Workers (stateless handlers) | None — auto-scales | None |
| SandboxDO per sandbox | Single-thread: queue builds above ~10 msg/s to same sandbox | Unbounded queue at high sustained rate |
| D1 (event/metric writes) | Write throughput: ~100-200 sequential writes/s before latency rises | D1 write contention on sandbox_events; fire-and-forget writes may start failing |
| D1 (vault list/search) | LIKE scans degrade at >10,000 rows | LIKE unusable; FTS5 or AI Search required |
| KV (rate limiter) | Race window under burst; still functional | Rate limiter ineffective under sustained burst |
| KV (sandbox list) | `listAllKV` slow above 500 entries | `listAllKV` slow above 5,000 entries (5+ round-trips) |
| R2 + Vectorize (document indexing) | Sequential embed batches hit 10s+ for large docs | Sequential embed batches hit 100s for max-size docs |

**Key insight:** Because this is a single-tenant deployment, "100× more users" does not mean a shared database under contention — each user's instance is independent. The real scaling concern is a single power-user generating high traffic within their own instance. The bottlenecks above are per-deployment, not cross-tenant.

---

## Proposed Changes (Awaiting Approval)

| ID | File(s) | Change | Effort | Impact |
|----|---------|--------|--------|--------|
| PERF-01 | `src/lib/http.ts:113`, `src/durable/SandboxDO.ts:77` | `await` both rate limit writes | 2 lines | HIGH — correctness fix |
| PERF-02 | `src/jobs/fileProcess.ts:196-207` | Parallelize embed batches (3× concurrency) | ~15 lines | HIGH — 3× faster indexing |
| PERF-03B | `migrations/0013_vault_fts.sql`, `src/routes/vault.ts` | FTS5 for vault text search | 1 migration + ~10 line change | MEDIUM — O(log n) vs O(n) |
| PERF-05 | `src/routes/sandbox.ts`, frontend list pages | Cursor pagination for sandbox list | ~30 lines | MEDIUM — needed at 500+ sandboxes |
| PERF-06 | `migrations/0013_events_pattern_col.sql`, `src/routes/monitor.ts` | Generated column + index for guard pattern | 1 migration, no handler change | MEDIUM — needed at high event volume |
| PERF-07 | `src/routes/probes.ts` | Batch the INSERT+UPDATE into `env.DB.batch()` | 6 lines | LOW — reduces probe run latency ~10ms |
| PERF-08 | `src/routes/vault.ts` | Chunk embed input in `analyze` | ~8 lines | LOW — prevents batch-limit errors at scale |
| PERF-09 | New migration | Composite index `(sandbox_id, model)` on usage_metrics | 1 line | LOW — helps metrics query at high run count |

---

## Non-Issues (Investigated, No Action Needed)

- **Vault list dual query parallelism** — `Promise.all([data, count])` is already parallel. Good.
- **Replay batch mode** — all configs run via `Promise.all`, correctly parallel.
- **Whisperer sensitivity** — variants complete in parallel, followed by one embed call. Correct.
- **Monitor audit query** — data+count also parallel. Good.
- **Vault JSONL export streaming** — uses `TransformStream` + writer, streams correctly. The batch loop is sequential by necessity (can't reorder JSONL rows); acceptable.
- **DO config caching** — `this.config` memoizes the decrypted config in-memory, so warm DOs only pay one storage read for config. AES-GCM decrypt only happens on cold starts.

---

_All proposed changes in the table above require explicit approval before implementation._
