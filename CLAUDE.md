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
                 ├→ /api/app/*            src/routes/appstate.ts
                 ├→ /app/:id, /apps       src/routes/pages.ts
                 ├→ /build/:id            src/routes/pages.ts (R2-served generated apps)
                 ├→ /s/:id/*              index.ts (short public API)
                 ├→ SandboxDO             src/durable/SandboxDO.ts
                 ├→ AppBuilderDO          src/durable/AppBuilderDO.ts
                 └→ AppStateDO            src/durable/AppStateDO.ts
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

**Build routes** (`/api/v2/build/*`): list (GET), create (POST), status (GET), file list (GET), file content (GET), delete (DELETE), thumbnail (GET), deploy (POST). WebSocket at `/api/v2/build/:id/ws` — bypasses router, dispatched directly to `AppBuilderDO`.

| Route | Handler | Purpose |
|-------|---------|---------|
| `GET /api/v2/build` | build.ts | List all builds (KV-backed metadata index) |
| `POST /api/v2/build` | build.ts | Create build, init DO, store KV metadata, return wsUrl |
| `GET /api/v2/build/:id` | build.ts | Build status + file list |
| `GET /api/v2/build/:id/files` | build.ts | List generated filenames |
| `GET /api/v2/build/:id/files/:filename` | build.ts | Serve a generated file from R2 |
| `DELETE /api/v2/build/:id` | build.ts | Delete build + R2 files |
| `GET /api/v2/build/:id/thumbnail` | build.ts | SVG metadata thumbnail (E3) |
| `POST /api/v2/build/:id/deploy` | build.ts | Deploy to Cloudflare Pages (E6) |

**App routes** (`/api/app/*`): per-app state KV, R2 image storage, and email sending for generated apps.

| Route | Handler | Purpose |
|-------|---------|---------|
| `GET /api/app/:id/state` | appstate.ts | List all KV entries (AppStateDO) |
| `GET /api/app/:id/state/:key` | appstate.ts | Get a KV entry |
| `PUT /api/app/:id/state/:key` | appstate.ts | Set a KV entry (protected) |
| `DELETE /api/app/:id/state/:key` | appstate.ts | Delete a KV entry (protected) |
| `DELETE /api/app/:id/state` | appstate.ts | Clear all KV entries (protected) |
| `POST /api/app/:id/images` | appstate.ts | Upload image to R2 (5 MB max, png/jpeg/gif/webp) |
| `GET /api/app/:id/images` | appstate.ts | List image metadata |
| `GET /api/app/:id/images/:imageId` | appstate.ts | Serve image (cached) |
| `DELETE /api/app/:id/images/:imageId` | appstate.ts | Delete image from R2 (protected) |
| `POST /api/app/:id/email` | appstate.ts | Send email via SEND_EMAIL binding (5/min per app) |

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
3. **Thumbnail** — after all files are written, an SVG metadata thumbnail is generated and stored at `apps/{buildId}/.thumbnail.svg` (E3).
4. **Complete** — state set to `'complete'`, `build_complete` event (includes `thumbnailUrl`) sent, WS closed.

R2 key format: `apps/{buildId}/{filename}`  
Served at: `GET /build/:id` (→ `index.html`) and `GET /build/:id/:filename`

DO storage key: `'state'` (stores `BuildState`). Always addressed by `idFromName(buildId)`.

**`__BUILD_ID__` injection** — `serveBuildFile()` in `pages.ts` replaces the literal `__BUILD_ID__` in served `.html` files with the actual build ID at request time. Generated apps use this to call the state/image/email APIs at the correct path.

**Tech stack options**: `vanilla`, `alpine`, `react`, `vue`, `svelte`, `worker`. The `worker` stack signals the blueprint to include a `worker.js` companion file (Cloudflare Worker format: `export default { async fetch(req, env) {...} }`) for server-side logic.

**Date/time guidance**: Generated apps use `Intl.DateTimeFormat` and `Intl.RelativeTimeFormat` — no CDN date libraries (`date-fns`, `dayjs`, `moment`) are ever imported.

Build constants in `src/lib/constants.ts`:
```
MAX_BUILD_DESCRIPTION_LEN = 2000
MAX_BUILD_FILES           = 6
MAX_FILE_BYTES            = 102_400  (100 KB per file)
```

CSP for served built apps (`BUILD_CSP` in `pages.ts`): permissive — allows `unsafe-inline`, `unsafe-eval`, and CDN origins (`esm.sh`, `unpkg.com`, `cdn.jsdelivr.net`) because AI-generated apps use CDN ESM and inline scripts.

### AppStateDO (`src/durable/AppStateDO.ts`)

Lightweight Durable Object exposing a string key-value store for generated apps. Always addressed by `idFromName(buildId)`.

Routes handled inside the DO (called via `doFetch`):
```
GET    /kv           → list all { key, value } pairs
GET    /kv/:key      → get one value (404 if missing)
PUT    /kv/:key      → store { value: string } (validates key length + chars, value ≤ 16 KB)
DELETE /kv/:key      → delete a key
DELETE /            → deleteAll()
```

Key constraints: `^[a-zA-Z0-9._\-/]+$`, max 512 chars. Value max 16 384 chars.

Route handlers in `appstate.ts` validate `id` is a UUID before calling the DO stub.

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

**CSV chunking (Z7)** — CSV files are parsed with a zero-dep RFC 4180 parser (`parseCsvRow()`) and chunked in groups of 15 rows in structured `Row N: col=val, ...` format rather than raw text. This preserves column context for RAG queries.

**PDF extraction (Z9)** — `extractPdfText()` uses `DecompressionStream('deflate-raw')` to inflate FlateDecode streams, then extracts text between `BT`/`ET` markers from `Tj`/`TJ` operators. Falls back to naive ASCII filter if no compressed streams are found. Inflated streams exceeding 50 MB are skipped to prevent zip-bomb OOM.

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

Each DO is always addressed by logical name (UUID or build ID), never by generated DO ID:

```typescript
// Correct — always use idFromName
env.SANDBOX.get(env.SANDBOX.idFromName(sandboxId))

// Shorthand exported from sandbox.ts
stub(env, sandboxId)

// Preferred way to call a DO endpoint (uses https://do/ — note protocol)
doFetch(stub(env, id), 'run', 'POST', { message })

// AppStateDO stub (appstate.ts)
env.APP_STATE.get(env.APP_STATE.idFromName(buildId))

// AppBuilderDO stub (build.ts)
env.APP_BUILDER.get(env.APP_BUILDER.idFromName(buildId))
```

DO overview:

| DO class | Binding | Addressed by | Stores |
|----------|---------|--------------|--------|
| `SandboxDO` | `SANDBOX` | sandbox UUID | `SandboxConfig` + sessions + RL state |
| `AppBuilderDO` | `APP_BUILDER` | build UUID | `BuildState` + generated file chunks |
| `AppStateDO` | `APP_STATE` | build UUID | string KV pairs (`kv/*` paths) |

`SandboxDO` stores a single `SandboxConfig` object (including the full `memory` array) under `DO_STORAGE_KEY = 'config'`. Memory is capped at `MAX_MESSAGES = 100` entries. Rate limit state is stored separately under `RL_STORAGE_KEY = 'rlState'` so it survives DO hibernation.

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
- `checkRateLimit(key, max, windowMs, env, message?)` — generic KV-backed sliding-window rate limiter. Used by `checkAiRateLimit` and the email rate limiter in `appstate.ts`.
- `Router` — zero-dep `URLPattern` router. Supports `get/post/put/delete/patch` shortcut methods. Automatically handles CORS preflight (`Access-Control-Allow-Methods` includes `PUT`) and adds origin-aware CORS headers to all responses (`corsHeaders(req, env)` reads `ALLOWED_ORIGINS`).
- `sseResponse(stream)` — wraps a `ReadableStream` in a proper `text/event-stream` response.

### Schema & validation (`src/lib/schema.ts`)

All request parsing happens here. Parser functions throw `Error` with a human-readable message on invalid input; `parseBody` converts these to 422 responses. Every JSON-body route handler uses `parseBody(req, parseFoo)` — never raw `req.json()`. Constants for all defaults and limits live in `src/lib/constants.ts`:

```
MAX_NAME_LEN = 128          MAX_DESCRIPTION_LEN = 512      MAX_SYSTEM_PROMPT_LEN = 16_384
MAX_VIBE_DESCRIPTION = 5000 MAX_EMBED_CHARS = 100_000      MAX_REQUEST_BODY = 1_048_576
MAX_AUDIO_BYTES = 26_214_400
RATE_LIMIT_WINDOW_MS = 60_000    RATE_LIMIT_MAX_REQUESTS = 20
MAX_BUILD_DESCRIPTION_LEN = 2000  MAX_BUILD_FILES = 6  MAX_FILE_BYTES = 102_400
IMAGE_MAX_BYTES = 5_242_880  ALLOWED_IMAGE_TYPES = [png,jpeg,gif,webp]
IMAGE_RATE_LIMIT_WINDOW_MS = 60_000  IMAGE_RATE_LIMIT_MAX = 20
EMAIL_RATE_LIMIT_WINDOW_MS = 60_000  EMAIL_RATE_LIMIT_MAX = 5
MAX_APP_STATE_KEY_LEN = 512  MAX_APP_STATE_VALUE_LEN = 16_384  APP_STATE_KEY_RE = /^[a-zA-Z0-9._\-/]+$/
BUILD_KEY_PREFIX = 'build:'  BUILD_TTL = 604800
MAX_PDF_INFLATED = 52_428_800
```

Key parsers: `parseCompleteRequest`, `parseCreateSandboxRequest`, `parseBuildRequest`, `parseVibeRequest`, `parseSensitivityRequest`, `parseClusterRequest`, `parseCotRequest`, `parseEntropyRequest`, `parseArchaeologyRequest`, `parsePipelineRequest`, `parseThinkRequest`, `parseAppStateValueRequest`, `parseEmailRequest`.

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

Three layers:
- *Per-sandbox* (`src/durable/SandboxDO.ts`): persistent sliding-window limiter under `RL_STORAGE_KEY` — 20 run/stream calls per 60 s. Returns 429 in `handleRun` and `handleStream`.
- *Per-IP on /api/ai/\** (`src/lib/http.ts`, `checkAiRateLimit()`): KV-backed sliding window, 30 calls/60 s, keyed by `CF-Connecting-IP` stored under `rl:ai:{ip}` in `SANDBOX_REGISTRY`. Checked in `Router.handle()` before dispatch.
- *Per-app email* (`src/routes/appstate.ts`): 5 emails/60 s per build ID, keyed `rl:email:{buildId}`. Uses shared `checkRateLimit()` from `http.ts`.

**Cloudflare Access (`src/lib/access.ts`)**

Zero Trust identity-aware proxy integration. When `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` are set, all state-mutation endpoints require a valid Cloudflare Access JWT:

- Protected: `POST /api/sandbox`, `POST /api/sandbox/import`, `PATCH /api/sandbox/:id`, `DELETE /api/sandbox/:id`, `POST /api/sandbox/:id/documents`, `DELETE /api/sandbox/:id/documents/:docId`, `POST /api/vibes`, `POST /api/v2/build`, `DELETE /api/v2/build/:id`, `PUT /api/app/:id/state/:key`, `DELETE /api/app/:id/state*`, `DELETE /api/app/:id/images/:imageId`, `POST /api/v2/build/:id/deploy`
- Public (no auth): all `GET` routes, `POST /api/sandbox/:id/run`, `POST /api/sandbox/:id/stream`, all `/api/ai/*` routes, all page routes, `/s/:id/run`, `/s/:id/stream`, `POST /api/app/:id/images`, `POST /api/app/:id/email`

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
- `vibe-sdk.js` — zero-dep browser SDK. Primary export: `AetherLiteClient` (with backwards-compat alias `VibeClient`). Classes: `AetherLiteClient`, `AiClient`, `SandboxClient`, `SandboxHandle`, `VibesClient`, `VibeBuilderResult` (alias: `VibeResult`), `AppBuilder`, `AppSession`, `AppHandle`, `AppStateHandle`. Registers `<aether-lite-chat>`, `<aether-chat>`, and `<vibe-chat>` Shadow DOM web components (latter two are backwards-compat aliases). The chat web component renders AI responses as Markdown (`_renderMd()` — zero-dep inline renderer).
- `vibe-sdk.d.ts` — TypeScript declarations for the SDK.
- `chart.js` (ES module) — zero-dep SVG chart generator: `chart(data, { type, width, height, label })`. Supports `'bar'`, `'line'`, `'pie'`. Data format: `Array<{label: string, value: number}>`. Returns SVG string for `innerHTML`.
- `markdown.ts` → `src/lib/markdown.ts` — zero-dep markdown → safe HTML renderer (`renderMarkdown(text)`). Escape-first approach; safe for `innerHTML`. Handles h1–h3, bold/italic, inline + fenced code, unordered/ordered lists, blockquotes, `https?://` links.

SDK rename summary:
| Old name | New name | Note |
|----------|----------|------|
| `VibeClient` | `AetherLiteClient` | `window.VibeClient` alias kept for one release |
| `VibeResult` | `VibeBuilderResult` | `export const VibeResult` alias kept |
| `<vibe-chat>` | `<aether-lite-chat>` | All three elements registered; `VibeChatElement` is base class; `<aether-chat>` kept as alias |
| (new) | `AppBuilder` | Multi-file app generation client (`session`, `get`, `list`, `delete`) |
| (new) | `AppSession` | WS-driven build session with fluent event handlers |
| (new) | `AppHandle` | Handle to a completed build (`getFile`, `deploy`, `delete`, `state`, `thumbnailUrl`) |
| (new) | `AppStateHandle` | Per-app persistent KV store (get/set/list/delete/clear) |

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
wrangler d1 execute aether-lite --file=./migrations/0002_request_id.sql
# Update wrangler.toml with the returned IDs

# APP_STATE (AppStateDO) needs no extra setup — the v3 migration runs automatically on first deploy.

# SEND_EMAIL (Cloudflare Email Routing) — configure at dash.cloudflare.com → Email → Email Routing
# then add the [[send_email]] binding in wrangler.toml with your verified from-address.
```

## Environment variables (`.dev.vars` for local dev)

```
CLOUDFLARE_ACCOUNT_ID=...   # required for AI Gateway models + Pages deploy
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

# Cloudflare Pages deploy (E6) — optional
CLOUDFLARE_API_TOKEN=...    # Bearer token with Pages:Edit permission
                            # generate at dash.cloudflare.com → My Profile → API Tokens
                            # Required for POST /api/v2/build/:id/deploy

# Email (E5) — configured via wrangler.toml [[send_email]] binding, not .dev.vars
# SEND_EMAIL binding is auto-available when [[send_email]] is set in wrangler.toml
# Requires Cloudflare Email Routing to be enabled on your domain
```

See `.dev.vars.example` for the full annotated list.
