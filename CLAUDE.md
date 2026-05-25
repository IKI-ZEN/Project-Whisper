# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev           # wrangler dev (remote Workers AI)
npm run dev:local     # wrangler dev --local (local AI simulation)
npm run deploy        # wrangler deploy
npm run type-check    # npx tsc --noEmit  ← run this after every change
```

There are no tests. `tsc --noEmit` is the primary correctness gate — it must exit 0 before every commit.

## Architecture

Project Aether-Lite is a **zero-runtime-dependency** AI harness running entirely on Cloudflare infrastructure. Nothing is imported from npm at runtime; all HTTP routing, streaming, and serialisation use native Web Platform APIs.

### Request flow

```
Request → src/index.ts (Worker entry)
            ├→ WebSocket upgrade bypass (before router)
            │    ├→ /api/sandbox/:id/ws    → SandboxDO
            │    └→ /api/v2/build/:id/ws  → AppBuilderDO
            └→ Router (src/lib/http.ts, URLPattern-based)
                 ├→ /api/ai/*             src/routes/ai.ts
                 ├→ /api/sandbox/*        src/routes/sandbox.ts
                 ├→ /api/vibes/*          src/routes/vibes.ts
                 ├→ /api/v2/build/*       src/routes/build.ts
                 ├→ /app/:id, /apps       src/routes/pages.ts
                 ├→ /build/:id            src/routes/pages.ts (R2-served generated apps)
                 ├→ /s/:id/*              index.ts (short public API)
                 ├→ SandboxDO             src/durable/SandboxDO.ts
                 └→ AppBuilderDO          src/durable/AppBuilderDO.ts
```

**AI routes** (`/api/ai/*`): `src/routes/ai.ts` (core) + `src/routes/whisperer.ts` (analysis suite)

| Route | Handler file | Purpose |
|-------|-------------|---------|
| `POST /api/ai/complete` | ai.ts | Blocking text completion |
| `POST /api/ai/stream` | ai.ts | SSE token stream |
| `POST /api/ai/embed` | ai.ts | Vector embeddings |
| `POST /api/ai/image` | ai.ts | Image generation |
| `POST /api/ai/transcribe` | ai.ts | Audio transcription |
| `POST /api/ai/compare` | ai.ts | Multi-model parallel comparison |
| `POST /api/ai/sweep` | ai.ts | Temperature gradient sampling |
| `POST /api/ai/sensitivity` | whisperer.ts | Prompt variant variance analysis |
| `POST /api/ai/cluster` | whisperer.ts | K-means semantic clustering |
| `POST /api/ai/cot` | whisperer.ts | Chain-of-thought probing (4 styles) |
| `POST /api/ai/entropy` | whisperer.ts | Attractor stability / response diversity |
| `POST /api/ai/archaeology` | whisperer.ts | Reverse-engineer candidate system prompts |
| `POST /api/ai/pipeline` | whisperer.ts | Declarative node-graph executor |
| `POST /api/ai/think` | whisperer.ts | Extended thinking with reasoning trace |

**Sandbox routes** (`/api/sandbox/*`): list, create, import, get (+ TTL refresh), patch, run, stream, history, export, fingerprint, metrics, delete

**Document routes** (`/api/sandbox/:id/documents`): upload (POST multipart), list (GET), delete (DELETE). See [Documents / RAG](#documents--rag) section.

**Build routes** (`/api/v2/build/*`): create (POST), status (GET), file list (GET), file content (GET), delete (DELETE). WebSocket at `/api/v2/build/:id/ws` — bypasses router, dispatched directly to `AppBuilderDO`.

**Inbound guard pipeline** (runs before every AI call in SandboxDO):
```
message/systemPrompt
  → stripInvisible()           remove zero-width + RTL-override Unicode
  → .normalize('NFKC')         catch homoglyph substitutions
  → matchPatterns(BLOCKED)     → 422 if guardMode === 'strict'
  → decodeBase64Chunks()       decode-and-rescan for encoded evasion
  → matchPatterns(SUSPICIOUS)  → D1 audit log, always continue
  → matchPatterns(SECRETS)     → D1 audit log, always continue
```

### App Builder (`AppBuilderDO` + `src/routes/build.ts`)

`AppBuilderDO` runs a phased, WebSocket-driven multi-file app generation pipeline:

1. **Blueprint phase** — single streaming AI call producing JSON `{name, techStack, cdnDependencies, files[]}`. Falls back to a minimal `index.html` vanilla app on parse failure.
2. **File generation phase** — streaming AI call per file, chunks relayed over WS as `file_chunk` events, written to R2 at `apps/{buildId}/{filename}`.
3. **Complete** — state set to `'complete'`, `build_complete` event sent, WS closed.

R2 key format: `apps/{buildId}/{filename}`  
Served at: `GET /build/:id` (→ `index.html`) and `GET /build/:id/:filename`

DO storage key: `'state'` (stores `BuildState`). Always addressed by `idFromName(buildId)`.

Build constants in `src/lib/constants.ts`:
```
MAX_BUILD_DESCRIPTION_LEN = 2000
MAX_BUILD_FILES           = 6
MAX_FILE_BYTES            = 102_400  (100 KB per file)
```

CSP for served built apps (`BUILD_CSP` in `pages.ts`): permissive — allows `unsafe-inline`, `unsafe-eval`, and CDN origins (`esm.sh`, `unpkg.com`, `cdn.jsdelivr.net`) because AI-generated apps use CDN ESM and inline scripts.

### Documents / RAG

Document upload is handled by `src/routes/documents.ts`. Files are stored in R2 and indexed into Vectorize for retrieval-augmented generation:

```
POST   /api/sandbox/:id/documents          multipart upload (10 MB max)
GET    /api/sandbox/:id/documents          list with metadata
DELETE /api/sandbox/:id/documents/:docId   delete + best-effort vector cleanup
```

R2 key: `sandboxes/{sandboxId}/documents/{docId}`

Upload pipeline:
1. Guard scan on extractable text (blocks adversarial content before storage)
2. R2 `.put()` with `status: 'processing'` in custom metadata
3. Enqueue `file_process` job → `src/jobs/fileProcess.ts`
4. Background: `processFile()` chunks text (512-char, 64-char overlap) → `embed()` in batches of 100 → `env.VECTORS.upsert()`
5. R2 metadata updated to `status: 'indexed'`

Supported MIME types: `text/plain`, `text/markdown`, `text/csv`, `text/html`, `application/json`, `application/pdf`, `application/x-markdown`

When `ragEnabled: true` on a sandbox, relevant document chunks are injected into the system prompt at inference time.

### Session-based memory

All sandbox inference endpoints accept an optional `sessionId` parameter:

```
POST /api/sandbox/:id/run?sessionId=alice
POST /api/sandbox/:id/stream?sessionId=bob
GET  /api/sandbox/:id/history?sessionId=alice
WS   /api/sandbox/:id/ws?sessionId=alice
```

Each session maintains an independent `Message[]` array in DO storage at key `session:{sessionId}`. Omitting `sessionId` defaults to the `'default'` shared thread. Constants: `MAX_SESSION_ID_LEN = 64`, `MAX_SESSIONS_PER_SANDBOX = 100`.

### SandboxDO WebSocket protocol

Connect to `GET /api/sandbox/:id/ws` (Upgrade: websocket). Bidirectional — supports tool call round-trips:

```
Client → Server:  plain UTF-8 message text
Server → Client:  token string (streaming)
                  JSON { type: 'tool_call', calls: [{ id, name, input }] }
                  JSON { type: 'done', reply: '...' }
                  JSON { type: 'error', message: '...' }
Client → Server:  AiClient.encodeToolResult(toolUseId, toolName, content)
                  (to submit tool results back for the next model turn)
```

`SandboxConnection` in `vibe-sdk.js` wraps this protocol with `onToken()`, `onToolCall()`, `onDone()`, `onError()` event handlers and a `submitToolResults()` helper.

### Durable Object pattern

Each sandbox is a `SandboxDO` instance. The DO is always addressed by logical name (the UUID sandbox ID), never by generated DO ID:

```typescript
// Correct — always use idFromName
env.SANDBOX.get(env.SANDBOX.idFromName(sandboxId))

// Shorthand exported from sandbox.ts
stub(env, sandboxId)

// Preferred way to call a DO endpoint
doFetch(stub(env, id), 'run', 'POST', { message })
```

The DO stores a single `SandboxConfig` object (including the full `memory` array) under the key `DO_STORAGE_KEY = 'config'`. Memory is capped at `MAX_MESSAGES = 100` entries. Rate limit state is stored separately under `RL_STORAGE_KEY = 'rlState'` so it survives DO hibernation.

### AI routing

`src/lib/ai.ts` routes inference based on the model string prefix:

| Prefix | Provider | Requires |
|--------|----------|---------|
| `@cf/…` | Workers AI (default) | — |
| `openai:…` | OpenAI via AI Gateway | `OPENAI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `AI_GATEWAY_ID` |
| `anthropic:…` | Anthropic via AI Gateway | `ANTHROPIC_API_KEY`, … |
| `google:…` | Google AI via AI Gateway | `GOOGLE_AI_KEY`, … |

Gateway URL: `https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{AI_GATEWAY_ID}/{provider}/…`

All streaming is normalised to the same SSE format (`data: {"response":"…"}\n\n`) regardless of provider, using `streamSSEFetch` + `toReadableStream` helpers.

### KV metadata pattern

Sandboxes are registered in KV with rich metadata on the key itself (not the value), so `list()` is a single call with no N+1 fetches:

```typescript
await env.SANDBOX_REGISTRY.put(`${SANDBOX_KEY_PREFIX}${id}`, id, {
  expirationTtl: SANDBOX_TTL,
  metadata: { id, name, description, model, createdAt, fromVibe },
})
```

### HTTP helpers (`src/lib/http.ts`)

- `parseBody<T>(req, parser)` — reads JSON, runs parser, returns `{ ok: true; data }` or `{ ok: false; response }`. Use this instead of the 3-try-block pattern in all JSON-body handlers.
- `Router` — zero-dep `URLPattern` router. Automatically handles CORS preflight and adds origin-aware CORS headers to all responses (`corsHeaders(req, env)` reads `ALLOWED_ORIGINS`).
- `sseResponse(stream)` — wraps a `ReadableStream` in a proper `text/event-stream` response.

### Schema & validation (`src/lib/schema.ts`)

All request parsing happens here. Parser functions throw `Error` with a human-readable message on invalid input; `parseBody` converts these to 422 responses. Every JSON-body route handler uses `parseBody(req, parseFoo)` — never raw `req.json()`. Constants for all defaults and limits live in `src/lib/constants.ts`:

```
MAX_NAME_LEN = 128          MAX_DESCRIPTION_LEN = 512      MAX_SYSTEM_PROMPT_LEN = 16_384
MAX_VIBE_DESCRIPTION = 5000 MAX_EMBED_CHARS = 100_000      MAX_REQUEST_BODY = 1_048_576
MAX_AUDIO_BYTES = 26_214_400
RATE_LIMIT_WINDOW_MS = 60_000    RATE_LIMIT_MAX_REQUESTS = 20
MAX_BUILD_DESCRIPTION_LEN = 2000  MAX_BUILD_FILES = 6  MAX_FILE_BYTES = 102_400
```

Key parsers: `parseCompleteRequest`, `parseCreateSandboxRequest`, `parseBuildRequest`, `parseVibeRequest`, `parseSensitivityRequest`, `parseClusterRequest`, `parseCotRequest`, `parseEntropyRequest`, `parseArchaeologyRequest`, `parsePipelineRequest`, `parseThinkRequest`.

### Security subsystem

**Guard (`src/lib/guard.ts`)**

`scan(text): ScanResult` — stateless, safe to call with any string (user messages, system prompts, transcribed audio, extracted file content).

Pattern tables:
- `BLOCKED` → 422 when `guardMode === 'strict'`: `ignore_instructions`, `new_instructions`, `jailbreak_dan`, `prompt_override`, `forget_training`
- `SUSPICIOUS` → D1 `guard_flag` audit log (never blocks): `role_switch`, `act_as`, `reveal_prompt`, `role_delimiter`, `llm_tag`, `jinja_template`, `prompt_leak`
- `SECRETS` → D1 `guard_flag` audit log: `openai_key`, `aws_key`, `github_token`, `anthropic_key`

Per-sandbox `guardMode` (patchable at any time):
- `'strict'` (default) — blocked patterns return 422
- `'audit'` — all detections logged; never returns 422
- `'off'` — guard disabled entirely; no scan, no log

Hook sites in `SandboxDO`: `handleInit`, `handlePatchConfig`, `handleRun` (inbound + outbound reply), `handleStream`.

**Integrity hashing (`src/lib/integrity.ts`)**

`computeConfigHash(config): Promise<string>` — SHA-256 over `id + name + systemPrompt + model + temperature + maxTokens + messageCount`. `messageCount` (= `memory.length`) is the thread-length salt so the hash changes on every turn. Called inside `save()` and recomputed on `handleGetConfig()`. If stored ≠ live, returns `tampered: true`.

**HMAC export signing (`src/routes/sandbox.ts`)**

When `SIGNING_SECRET` is set: `exportConfig` appends a `signature` field (hex HMAC-SHA256 over a canonical JSON string with a fixed field order). `importConfig` rejects with 422 if `SIGNING_SECRET` is set and the signature is absent or invalid. Canonical order: `version, name, description, systemPrompt, tools, model, temperature, maxTokens`.

**Rate limiting**

Two layers:
- *Per-sandbox* (`src/durable/SandboxDO.ts`): persistent sliding-window limiter under `RL_STORAGE_KEY` — 20 run/stream calls per 60 s. Returns 429 in `handleRun` and `handleStream`.
- *Per-IP on /api/ai/\** (`src/lib/http.ts`, `checkAiRateLimit()`): KV-backed sliding window, 30 calls/60 s, keyed by `CF-Connecting-IP` stored under `rl:ai:{ip}` in `SANDBOX_REGISTRY`. Checked in `Router.handle()` before dispatch.

**Cloudflare Access (`src/lib/access.ts`)**

Zero Trust identity-aware proxy integration. When `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` are set, all state-mutation endpoints require a valid Cloudflare Access JWT:

- Protected: `POST /api/sandbox`, `POST /api/sandbox/import`, `PATCH /api/sandbox/:id`, `DELETE /api/sandbox/:id`, `POST /api/sandbox/:id/documents`, `DELETE /api/sandbox/:id/documents/:docId`, `POST /api/vibes`, `POST /api/v2/build`, `DELETE /api/v2/build/:id`
- Public (no auth): all `GET` routes, `POST /api/sandbox/:id/run`, `POST /api/sandbox/:id/stream`, all `/api/ai/*` routes, all page routes, `/s/:id/run`, `/s/:id/stream`

Token resolution order: `Cf-Access-Jwt-Assertion` header (set automatically by Access proxy) → `Authorization: Bearer <token>` header (for programmatic clients).

`requireAccess(req, env)` fetches Cloudflare's JWKS from `https://{teamDomain}/cdn-cgi/access/certs`, validates RS256 signature, audience, and expiry using Web Crypto API. JWKS cached in module scope for 1 hour. Returns `null` (allow) or a 401 Response.

`isProtectedRequest(method, pathname)` — pure boolean, called in `Router.handle()` before dispatching.

**CSP + secure headers (`src/routes/pages.ts`)**

`genNonce()` generates a per-request base64 nonce. `htmlHeaders(nonce, allowFrame)` returns headers with `Content-Security-Policy: script-src 'nonce-${nonce}'` (no `unsafe-inline`), a matching `Content-Security-Policy-Report-Only` header pointing to `POST /api/csp-report`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin`. App embed pages pass `allowFrame=true` to omit `X-Frame-Options`.

CSP violations are written to D1 `sandbox_events` as event type `csp_violation` via `POST /api/csp-report` (`src/routes/security.ts`). No auth required on this endpoint.

**X-Request-ID traceability**

Every response from the Router carries an `X-Request-ID: <uuid>` header generated per request. Clients can include this in bug reports. The `migrations/0002_request_id.sql` migration adds a `request_id TEXT` column to `sandbox_events` for future correlation of HTTP logs with D1 audit rows.

### Public assets (`public/`)

Served as static assets via `[assets]` in `wrangler.toml`.

- `playground.html` — four-tab SPA (Vibe Builder / Sandbox Chat / AI Workbench / Whisperer). Uses `vibe-sdk.js` as an ES module. Vibe Builder tab has Quick Sandbox and App Builder modes.
- `vibe-sdk.js` — zero-dep browser SDK. Primary export: `AetherLiteClient` (with backwards-compat alias `VibeClient`). Classes: `AetherLiteClient`, `AiClient`, `SandboxClient`, `SandboxHandle`, `VibesClient`, `VibeBuilderResult` (alias: `VibeResult`), `AppBuilder`, `AppSession`, `AppHandle`. Registers `<aether-lite-chat>`, `<aether-chat>`, and `<vibe-chat>` Shadow DOM web components (latter two are backwards-compat aliases).
- `vibe-sdk.d.ts` — TypeScript declarations for the SDK.

SDK rename summary:
| Old name | New name | Note |
|----------|----------|------|
| `VibeClient` | `AetherLiteClient` | `window.VibeClient` alias kept for one release |
| `VibeResult` | `VibeBuilderResult` | `export const VibeResult` alias kept |
| `<vibe-chat>` | `<aether-lite-chat>` | All three elements registered; `VibeChatElement` is base class; `<aether-chat>` kept as alias |
| (new) | `AppBuilder` | Multi-file app generation client |
| (new) | `AppSession` | WS-driven build session with fluent event handlers |
| (new) | `AppHandle` | Handle to a completed build (file access, delete) |

### D1 database

Used for audit logging (`sandbox_events`) and usage metrics (`usage_metrics`). Schema in `migrations/0001_init.sql`.

Event types logged to `sandbox_events`: `guard_flag` (suspicious/blocked scan hit), `response_flag` (outbound jailbreak detection), `sandbox_deleted`, `vibe_created`.

`GET /api/sandbox/:id/metrics` returns aggregated usage: `{ totalRuns, totalTokensIn, totalTokensOut, avgLatencyMs, modelBreakdown[] }` from the `usage_metrics` table.

## One-time Cloudflare setup

```bash
wrangler kv:namespace create SANDBOX_REGISTRY
wrangler d1 create aether-lite
wrangler r2 bucket create aether-lite-files
wrangler queues create aether-lite-jobs
wrangler vectorize create aether-lite-vectors --dimensions=768 --metric=cosine
wrangler d1 execute aether-lite --file=./migrations/0001_init.sql
# Update wrangler.toml with the returned IDs
```

## Environment variables (`.dev.vars` for local dev)

```
CLOUDFLARE_ACCOUNT_ID=...   # required for AI Gateway models
AI_GATEWAY_ID=...           # required for AI Gateway models
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_AI_KEY=...
SIGNING_SECRET=...          # optional — HMAC-SHA256 key for export signing
                            # generate: openssl rand -hex 32
ALLOWED_ORIGINS=...         # optional — comma-separated allowed CORS origins
                            # omit or set to '' for wildcard '*' (default)
ENVIRONMENT=development     # set by wrangler.toml; 'production' in deployed builds

# Cloudflare Access (Zero Trust) — optional
CF_ACCESS_AUD=...           # Access application Audience tag (from dash.cloudflare.com → Access)
CF_ACCESS_TEAM_DOMAIN=...   # e.g. yourteam.cloudflareaccess.com
                            # When set: all mutation endpoints require a valid Access JWT.
                            # Read-only and run/stream endpoints remain public.
```

See `.dev.vars.example` for the full annotated list.
