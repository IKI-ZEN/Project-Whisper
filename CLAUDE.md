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

The DO stores a single `SandboxConfig` object (including the full `memory` array) under the key `DO_STORAGE_KEY = 'config'`. Memory is capped at `MAX_MESSAGES = 100` entries.

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
- `Router` — zero-dep `URLPattern` router. Automatically handles CORS preflight and adds CORS headers to all responses.
- `sseResponse(stream)` — wraps a `ReadableStream` in a proper `text/event-stream` response.

### Schema & validation (`src/lib/schema.ts`)

All request parsing happens here. Parser functions throw `Error` with a human-readable message on invalid input; `parseBody` converts these to 422 responses. Constants for all defaults live in `src/lib/constants.ts`.

### Public assets (`public/`)

Served as static assets via `[assets]` in `wrangler.toml`.

- `playground.html` — three-tab SPA (Vibe Builder / Sandbox Chat / AI Workbench). Uses `vibe-sdk.js` as an ES module.
- `vibe-sdk.js` — zero-dep browser SDK. Classes: `VibeClient`, `AiClient`, `SandboxClient`, `SandboxHandle`, `VibesClient`, `VibeResult`. Also registers `<vibe-chat>` Shadow DOM web component.
- `vibe-sdk.d.ts` — TypeScript declarations for the SDK.

### D1 database

Used only for audit logging (`sandbox_events`) and usage metrics (`usage_metrics`). Schema in `migrations/0001_init.sql`. R2, Queues, and Vectorize bindings are declared but not yet implemented.

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
```
