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
            └→ Router (src/lib/http.ts, URLPattern-based)
                 ├→ /api/ai/*          src/routes/ai.ts
                 ├→ /api/sandbox/*     src/routes/sandbox.ts
                 ├→ /api/vibes/*       src/routes/vibes.ts
                 ├→ /app/:id, /apps    src/routes/pages.ts
                 ├→ /s/:id/*           index.ts (short public API)
                 └→ SandboxDO          src/durable/SandboxDO.ts
```

**AI routes** (`/api/ai/*`): complete, stream, embed, image, transcribe, compare, sweep

**Sandbox routes** (`/api/sandbox/*`): list, create, import, get (+ TTL refresh), patch, run, stream, history, export, fingerprint, delete

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

All request parsing happens here. Parser functions throw `Error` with a human-readable message on invalid input; `parseBody` converts these to 422 responses. Constants for all defaults and limits live in `src/lib/constants.ts`:

```
MAX_NAME_LEN = 128          MAX_DESCRIPTION_LEN = 512      MAX_SYSTEM_PROMPT_LEN = 16_384
MAX_VIBE_DESCRIPTION = 5000 MAX_EMBED_CHARS = 100_000      MAX_REQUEST_BODY = 1_048_576
MAX_AUDIO_BYTES = 26_214_400
RATE_LIMIT_WINDOW_MS = 60_000    RATE_LIMIT_MAX_REQUESTS = 20
```

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

**Rate limiting (`src/durable/SandboxDO.ts`)**

Persistent sliding-window limiter stored under `RL_STORAGE_KEY`. `checkRateLimit()` is async and fire-and-forgets the state write. Returns 429 in `handleRun` and `handleStream` when the window is full.

**CSP + secure headers (`src/routes/pages.ts`)**

`genNonce()` generates a per-request base64 nonce. `htmlHeaders(nonce, allowFrame)` returns headers with `Content-Security-Policy: script-src 'nonce-${nonce}'` (no `unsafe-inline`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin`. App embed pages pass `allowFrame=true` to omit `X-Frame-Options`.

### Public assets (`public/`)

Served as static assets via `[assets]` in `wrangler.toml`.

- `playground.html` — four-tab SPA (Vibe Builder / Sandbox Chat / AI Workbench / Whisperer). Uses `vibe-sdk.js` as an ES module.
- `vibe-sdk.js` — zero-dep browser SDK. Classes: `VibeClient`, `AiClient`, `SandboxClient`, `SandboxHandle`, `VibesClient`, `VibeResult`. Also registers `<vibe-chat>` Shadow DOM web component.
- `vibe-sdk.d.ts` — TypeScript declarations for the SDK.

### D1 database

Used for audit logging (`sandbox_events`) and usage metrics (`usage_metrics`). Schema in `migrations/0001_init.sql`. R2, Queues, and Vectorize bindings are declared but not yet implemented.

Event types logged to `sandbox_events`: `guard_flag` (suspicious/blocked scan hit), `response_flag` (outbound jailbreak detection), `sandbox_deleted`, `vibe_created`.

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
```

See `.dev.vars.example` for the full annotated list.
