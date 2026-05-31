# Code Quality & Maintainability Review — Project Whisper

**Review date:** 2026-05-31  
**Method:** Full static read of all 35 TypeScript source files  
**No changes have been made. All proposed diffs require explicit approval.**

---

## Overall Assessment

The codebase is architecturally sound and follows a consistent *intent* throughout — most of the patterns introduced in `CLAUDE.md` (parseBody, checkRateLimit, isUUID, newId, now) are respected in newer code. The main liabilities are:

1. **Scale without extraction** — the codebase grew fast; helpers were defined but not always used consistently everywhere, and some files grew to 2,292 lines (`pages.ts`) without being split.
2. **Duplicated boilerplate** — the same 3–10 line blocks are copy-pasted 5–13 times instead of being extracted once.
3. **Magic numbers scattered across route files** — values that should be in `constants.ts` appear inline in ~6 route files.
4. **Rule violations** — `Date.now()` instead of `now()`, `parseInt` instead of `parseQueryInt`, and `req.json()` instead of `parseBody` appear in older code that was not updated when the rules were introduced.

The code is readable and well-formatted. A new developer would not struggle to understand any individual file. The maintainability risk comes from the *size* of a few files and the scattered duplication that makes any change to the guarded logging or rate-limit pattern require edits in 5–13 places.

---

## Priority 1 — Rule Violations (Break `CLAUDE.md` Hard Rules)

These are the highest-priority fixes because they are rule violations that the project's own guidelines explicitly forbid.

### P1-A: `Date.now()` used directly instead of `now()`

**15 violations across 5 files.** The rule exists so that timestamp logic can be tested without mocking the system clock.

| File | Lines |
|------|-------|
| `src/durable/SandboxDO.ts` | 73, 76, 364, 367 |
| `src/durable/AppBuilderDO.ts` | 160, 280, 361, 423 |
| `src/jobs/fileProcess.ts` | 236 |
| `src/routes/probes.ts` | 244–245 |
| `src/index.ts` | 109 |

**Proposed diff (representative — same pattern for all):**

```diff
--- a/src/durable/SandboxDO.ts
+++ b/src/durable/SandboxDO.ts
@@ -71,8 +71,8 @@ export class SandboxDO extends DurableObject<Env> {
   private async checkRateLimit(): Promise<boolean> {
-    const stored = await this.ctx.storage.get<{ window: number[] }>(RL_STORAGE_KEY) ?? { window: [] }
-    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS
+    const ts = now()
+    const stored = await this.ctx.storage.get<{ window: number[] }>(RL_STORAGE_KEY) ?? { window: [] }
+    const cutoff = ts - RATE_LIMIT_WINDOW_MS
     const window = stored.window.filter(t => t > cutoff)
     if (window.length >= RATE_LIMIT_MAX_REQUESTS) return false
-    window.push(Date.now())
+    window.push(ts)
     void this.ctx.storage.put(RL_STORAGE_KEY, { window })
```

```diff
--- a/src/routes/probes.ts (runProbeTool sweep section)
+++ b/src/routes/probes.ts
@@ -242,8 +242,8 @@ async function runProbeTool(...) {
-      const start = Date.now()
+      const start = now()
       const responses = await Promise.all(...)
-      return { temperature, responses, latencyMs: Date.now() - start }
+      return { temperature, responses, latencyMs: now() - start }
```

---

### P1-B: `parseInt` / `isNaN` instead of `parseQueryInt()`

**Location:** `src/lib/schema.ts:888–893` in `parseUsageQuery`

```diff
--- a/src/lib/schema.ts
+++ b/src/lib/schema.ts
@@ -888,9 +888,8 @@ export function parseUsageQuery(params: URLSearchParams): UsageQuery {
-  const fromStr = params.get('from')
-  const toStr   = params.get('to')
-  const from    = fromStr !== null ? parseInt(fromStr, 10) : undefined
-  const to      = toStr   !== null ? parseInt(toStr,   10) : undefined
-  if (from !== undefined && isNaN(from)) throw new Error('from must be a number (unix ms)')
-  if (to   !== undefined && isNaN(to))   throw new Error('to must be a number (unix ms)')
+  const fromRaw = params.get('from')
+  const toRaw   = params.get('to')
+  const from    = fromRaw !== null ? parseQueryInt(params, 'from', 0) : undefined
+  const to      = toRaw   !== null ? parseQueryInt(params, 'to',   0) : undefined
```

---

### P1-C: `req.json()` / `readJson()` instead of `parseBody()` in route handlers

Three external-facing handlers use raw body reads instead of the mandatory `parseBody` pattern:

| File | Handler | Line |
|------|---------|------|
| `src/routes/sandbox.ts` | `patchConfig` | 166 |
| `src/routes/whisperer.ts` | `parseWithEnvelope` | 248 |
| `src/routes/environments.ts` | `importEnvironment` | 176 |

The `importConfig` and `importEnvironment` handlers have a legitimate reason to read raw first (HMAC signature verification before schema parsing), but the whisperer `parseWithEnvelope` and sandbox `patchConfig` do not. These are tracked under SEC-08 in `SECURITY_AUDIT.md` as well.

---

## Priority 2 — Duplication Hotspots

These blocks are copy-pasted so many times that a bug fix or policy change requires editing 5–13 places.

### P2-A: Guard-flag D1 insert — **6 copies in `SandboxDO.ts`**

The same `INSERT INTO sandbox_events ... guard_flag` statement appears at lines 241, 299, 330, 359, 380, and 417. It differs only in the `source` tag and whether `flaggedInput` is included.

**Proposed extraction:**

```diff
--- a/src/durable/SandboxDO.ts
+++ b/src/durable/SandboxDO.ts
+  private logGuardFlag(
+    sandboxId: string,
+    source: string,
+    guard: ScanResult,
+    identity: string | null,
+    flaggedInput?: string,
+  ): void {
+    const meta: Record<string, unknown> = { source, patterns: guard.patterns }
+    if (flaggedInput !== undefined) meta.flaggedInput = flaggedInput.slice(0, GUARD_FLAG_INPUT_PREVIEW_CHARS)
+    void this.env.DB.prepare(
+      'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
+    ).bind(sandboxId, 'guard_flag', JSON.stringify(meta), identity, now()).run()
+  }
+
   // Replace all 6 call sites, e.g. in handleRun:
-  void this.env.DB.prepare(
-    'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
-  ).bind(config.id, 'guard_flag', JSON.stringify({ source: 'run', patterns: guard.patterns, flaggedInput: message.slice(0, GUARD_FLAG_INPUT_PREVIEW_CHARS) }), identity, now()).run()
+  this.logGuardFlag(config.id, 'run', guard, identity, message)
```

---

### P2-B: Sandbox event D1 insert — **9 copies across `sandbox.ts` + `environments.ts`**

The `INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)` statement appears 5 times in `sandbox.ts` (lines 126, 252, 297, 364, 408) and 4 times in `environments.ts` (lines 80, 138, 238, 300). Currently any schema change (e.g. adding a `request_id` column) requires 9 edits.

**Proposed extraction into `src/lib/utils.ts` or a new `src/lib/events.ts`:**

```diff
--- a/src/lib/utils.ts
+++ b/src/lib/utils.ts
+import type { Env } from '../types/env'
+
+export function logEvent(
+  env: Env,
+  sandboxId: string,
+  eventType: string,
+  metadata: Record<string, unknown>,
+  identity: string | null,
+): void {
+  void env.DB.prepare(
+    'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
+  ).bind(sandboxId, eventType, JSON.stringify(metadata), identity, now()).run()
+}

--- a/src/routes/sandbox.ts (one of 5 call sites)
-  await env.DB.prepare(
-    'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
-  ).bind(id, 'created', JSON.stringify({ name: config.name }), identity, ts).run()
+  logEvent(env, id, 'created', { name: config.name }, identity)
```

---

### P2-C: Whisperer rate-limit boilerplate — **13 copies in `whisperer.ts`**

Every one of the 13 whisperer handlers starts with:
```typescript
const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
const rl = await checkRateLimit(`rl:whisperer:${ip}`, WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW, env)
if (rl) return rl
```
That is 39 lines of identical code across the file.

**Proposed extraction (local to `whisperer.ts`):**

```diff
--- a/src/routes/whisperer.ts
+++ b/src/routes/whisperer.ts
+async function whispererRateLimit(req: Request, env: Env): Promise<Response | null> {
+  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
+  return checkRateLimit(`rl:whisperer:${ip}`, WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW, env)
+}

 // Replace all 13 call sites, e.g.:
-const compare: Handler = async (req: Request, env: Env) => {
-  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
-  const rl = await checkRateLimit(`rl:whisperer:${ip}`, WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW, env)
-  if (rl) return rl
+const compare: Handler = async (req: Request, env: Env) => {
+  const rl = await whispererRateLimit(req, env)
+  if (rl) return rl
```

---

### P2-D: Replay config resolution — **2 near-identical blocks in `replay.ts`**

`resolvedEnvConfigs` (lines 187–204) and `resolvedSandboxConfigs` (lines 207–225) are structurally identical — both call `doFetch(stub(env, id), 'config', 'GET')`, extract the same 4 fields, and filter null results.

**Proposed extraction:**

```diff
--- a/src/routes/replay.ts
+++ b/src/routes/replay.ts
+async function resolveConfigFromId(id: string, env: Env): Promise<ReplayConfig | null> {
+  if (!isUUID(id)) return null
+  try {
+    const res  = await doFetch(stub(env, id), 'config', 'GET')
+    const body = await res.json() as { ok: boolean; data?: ReplayConfig }
+    if (!body.ok || !body.data) return null
+    const { model, systemPrompt, temperature, maxTokens } = body.data
+    return { model, systemPrompt, temperature, maxTokens }
+  } catch { return null }
+}

-  if (batchEnvIds && batchEnvIds.length > 0) {
-    resolvedEnvConfigs = (await Promise.all(
-      batchEnvIds.map(async (envId) => {
-        if (!isUUID(envId)) return null
-        try { ... } catch { return null }
-      }),
-    )).filter(...)
-  }
-  if (batchSandboxIds && batchSandboxIds.length > 0) { ...identical... }
+  const resolvedEnvConfigs     = batchEnvIds     ? (await Promise.all(batchEnvIds.map(id => resolveConfigFromId(id, env)))).filter((c): c is ReplayConfig => c !== null) : []
+  const resolvedSandboxConfigs = batchSandboxIds ? (await Promise.all(batchSandboxIds.map(id => resolveConfigFromId(id, env)))).filter((c): c is ReplayConfig => c !== null) : []
```

---

### P2-E: HMAC import verification — **2 copies in `sandbox.ts` + `environments.ts`**

The block that parses `r.signature`, builds the canonical JSON payload, and calls `verifySignature` is duplicated verbatim in `importConfig` (`sandbox.ts:328–343`) and `importEnvironment` (`environments.ts:179–196`), with only the field list differing.

**Proposed extraction into `src/lib/vault.ts`:**

```diff
--- a/src/lib/vault.ts
+++ b/src/lib/vault.ts
+export async function verifyImportSignature(
+  raw: Record<string, unknown>,
+  canonicalFields: string[],
+  secret: string,
+): Promise<boolean> {
+  if (typeof raw.signature !== 'string') return false
+  const canon: Record<string, unknown> = {}
+  for (const f of canonicalFields) canon[f] = raw[f]
+  return verifySignature(JSON.stringify(canon), raw.signature, secret)
+}
```

---

### P2-F: Tags IIFE — **4 copies in `atlas.ts`**

```typescript
// Repeated at lines 196, 218, 302, 355
tags: (() => { try { return JSON.parse(p.tags) as string[] } catch { return [] } })()
```

**Proposed extraction (local to `atlas.ts`):**

```diff
+function parseTags(raw: string | null): string[] {
+  try { return JSON.parse(raw ?? '[]') as string[] } catch { return [] }
+}
// Then: tags: parseTags(row.tags)
```

---

## Priority 3 — Structural Complexity

### P3-A: `pages.ts` — 2,292 lines, three page generators as inline strings

`pages.ts` contains `appPageHtml()` (~280 lines), `chatPageHtml()` (~630 lines), `dashboardHtml()` (~1,095 lines), and the `envPageHtml()` function, all as TypeScript functions returning multi-kilobyte HTML+CSS+JS strings. This is the project's established pattern (no build step), and it works. The problem is that all four are in the same 2,292-line file.

**The `_renderMd` markdown function is duplicated verbatim inside both `appPageHtml` and `chatPageHtml`**, when `src/lib/markdown.ts` already exports the canonical `renderMarkdown()`. The inline copies should be removed.

**Recommended:** Split into `src/routes/pages-app.ts`, `src/routes/pages-chat.ts`, `src/routes/pages-dashboard.ts`, `src/routes/pages-env.ts` with a thin `pages.ts` that imports and re-exports the route arrays. No change to public behaviour.

This is a medium-effort refactor. Not pre-launch blocking, but the file is already at the edge of what's navigable.

---

### P3-B: `ai.ts` — 1,818 lines, all providers + all tools in one file

`ai.ts` contains the provider registry (23 entries), all format-specific request builders (`buildOpenAIRequest`, `buildAnthropicRequest`, etc.), streaming/non-streaming dispatch, RAG context injection, and higher-order analysis functions (`estimateEntropy`, `generatePromptVariants`, etc.). These responsibilities are distinct.

**Most impactful split (minimal):** Move the provider registry and per-format builders to `src/lib/ai-providers.ts`. The dispatch functions (`complete`, `completeStream`, `embed`, etc.) stay in `ai.ts`. This reduces `ai.ts` to ~600 lines and makes adding a new provider a one-file change.

Not pre-launch blocking, but the file is a merge-conflict magnet.

---

### P3-C: `AppBuilderDO.runBuild` — ~199-line method

`runBuild` (lines 245–444) is the longest single method in the codebase. It sequentially:
1. Loads state and starts WebSocket stream
2. Calls `completeStream` for the blueprint (AI phase 1)
3. Parses the blueprint JSON with fallback regex
4. Iterates over files and calls `completeStream` for each (AI phase 2)
5. Generates a thumbnail
6. Persists all state and files to R2

**Recommended split:**
```
runBuild()
  → buildBlueprint(description, model, env): Promise<Blueprint>
  → generateFile(blueprint, fileSpec, model, env): Promise<string>
  → [persist + stream events inline]
```

Also: `AppBuilderDO` uses the old `constructor(state, env)` pattern while `SandboxDO` extends `DurableObject<Env>`. They should be consistent.

---

## Priority 4 — Magic Numbers to Move to `constants.ts`

The following inline literals appear in route/durable files and should be named constants. None are blocking issues, but they make the meaning of the numbers opaque.

| Value | Current location | Proposed constant name |
|-------|-----------------|----------------------|
| `60_000` | `monitor.ts:17` | `MONITOR_STREAM_DEFAULT_LOOKBACK_MS` |
| `7 * 24 * 60 * 60 * 1000` | `monitor.ts:147` | `MONITOR_PATTERNS_DEFAULT_LOOKBACK_MS` |
| `50` (SQL LIMIT) | `monitor.ts:167,180` | `MONITOR_PATTERNS_LIMIT` |
| `10` (max tool loops) | `SandboxDO.ts:14` | `MAX_TOOL_LOOPS` |
| `500` (vector chunk IDs) | `SandboxDO.ts:442` | already `MAX_VECTOR_CHUNKS` in constants — use it |
| `15` (CSV rows per chunk) | `fileProcess.ts:45` | `CSV_ROWS_PER_CHUNK` |
| `512, 64` (chunk size/overlap) | `fileProcess.ts:152` | `FILE_CHUNK_SIZE`, `FILE_CHUNK_OVERLAP` |
| `8192` (guard scan limit) | `fileProcess.ts:183` | `GUARD_SCAN_TEXT_LIMIT` |
| `100` (vector upsert batch) | `fileProcess.ts:196` | `VECTOR_UPSERT_BATCH_SIZE` |
| `0.7, 512` (replay defaults) | `replay.ts:133,135` | `DEFAULT_TEMPERATURE` (already exists), `REPLAY_DEFAULT_MAX_TOKENS` |
| `0.7` (analysis.ts:79) | `analysis.ts:79` | `DEFAULT_TEMPERATURE` (already exists — use it) |

---

## Priority 5 — Naming and Consistency Issues

| Issue | Location | Fix |
|-------|----------|-----|
| Delete handler named `remove` | `vault.ts:156` | Rename to `del` (matches `appstate.ts`, `documents.ts`) |
| PATCH handler named `patch` | `pipelines.ts:90` | Rename to `patchPipeline` |
| `isUUID` missing in `createSuite` | `assertions.ts` | Add UUID check on `sandboxId` from body |
| Status 400 for UUID fail in `issueSession` | `sandbox.ts:419` | Change to 422 (matches all other UUID checks) |
| Status 400 for UUID fail in `upload` and `list` | `documents.ts:38,108` | Change to 422 |
| `PREVIEW_LEN = 500` in `guard.ts` | `guard.ts:92` | Rename `GUARD_SCAN_PREVIEW_LEN` or move to constants |
| Local constants re-declared in `probes.ts` | `probes.ts:18–19` | Remove; import from constants |
| Local constants in `atlas.ts` | `atlas.ts:13–24` | Move to constants |
| Local constants in `vault.ts` | `vault.ts:16–19` | Move to constants |
| Non-null assertion `updated!` | `probes.ts:439` | Add a null guard or 404 return |
| `importHmacKey` exported but only used internally | `vault.ts:13` | Unexport |
| Inline `'an Whisper AI sandbox'` typo | `AppBuilderDO.ts:277,334` | `'a Whisper AI sandbox'` |
| `AppBuilderDO` uses old DO constructor pattern | `AppBuilderDO.ts:132` | Extend `DurableObject<Env>` like `SandboxDO` |

---

## Priority 6 — Dead / Commented-out Code

| Item | Location | Disposition |
|------|----------|-------------|
| `AI_SEARCH` binding commented out | `wrangler.toml` | Restore or remove the `/api/vault/search` route |
| `importHmacKey` possibly dead export | `vault.ts:13` | Verify no external consumers; unexport if none |
| `TODO: route _e to structured logging` | Proposed in `SECURITY_AUDIT.md` | Track as post-launch debt |

No significant commented-out code blocks were found. The codebase is clean of `// TODO` comments aside from the ones in test fixtures.

---

## Readability Assessment

**Easy to understand:**
- Any individual route handler — they follow a clear, consistent shape
- The guard pipeline (`guard.ts`) — well-documented with clear layer names
- The vault/HMAC utilities (`vault.ts`) — clean, short, commented
- All test files — direct and readable

**Harder to understand:**
- `ai.ts` — the sheer volume (1,818 lines) means navigating to a specific provider's request builder requires scrolling past hundreds of lines of unrelated code
- `pages.ts` — a 2,292-line file where HTML, CSS, and JavaScript are all embedded as template literals inside TypeScript; any CSS change requires searching through JS strings
- `SandboxDO.runWithToolLoop` + `handleWebSocket` — the tool-call flow requires understanding that `pendingResolve` is set in a `addEventListener` callback and resolved from a separate await, which is non-obvious

**Conclusion:** The codebase would be straightforward for a second developer to work in on individual features. Changing a cross-cutting concern (e.g. adding a field to all audit events, or changing the rate-limit key format) currently requires 5–13 manual edits across copies. That is the primary maintainability risk.

---

## Recommended Fix Order

| Priority | Effort | Files changed | Recommendation |
|----------|--------|--------------|----------------|
| P1-A | Small | 5 files | Fix all 15 `Date.now()` → `now()` violations |
| P1-B | Tiny | 1 file | Fix `parseInt`/`isNaN` in `parseUsageQuery` |
| P2-C | Small | 1 file | Extract `whispererRateLimit()` in `whisperer.ts` |
| P2-A | Small | 1 file | Extract `logGuardFlag()` in `SandboxDO.ts` |
| P2-B | Small | 3 files | Extract `logEvent()` in `sandbox.ts`, `environments.ts` |
| P2-D | Tiny | 1 file | Extract `resolveConfigFromId()` in `replay.ts` |
| P2-F | Tiny | 1 file | Extract `parseTags()` in `atlas.ts` |
| P4 | Small | ~8 files | Move magic numbers to `constants.ts` |
| P5 | Small | ~6 files | Fix naming inconsistencies, status codes |
| P3-A | Medium | ~5 files | Split `pages.ts` into per-page modules |
| P3-B | Medium | 2 files | Split `ai.ts` provider registry into `ai-providers.ts` |
| P3-C | Medium | 1 file | Split `AppBuilderDO.runBuild` into sub-methods |

**Pre-launch blocking:** None of these are functionally broken. The P1 rule violations are the only items that might mask real bugs (e.g. a test that mocks `now()` would not catch a `Date.now()` call).

---

*No changes have been made. All diffs above are proposed only — awaiting approval.*
