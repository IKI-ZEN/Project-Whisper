# Project Aether-Lite

A zero-runtime-dependency AI harness on Cloudflare infrastructure. No npm packages are imported at runtime — all routing, streaming, and serialisation use native Web Platform APIs.

## What it does

- **Vibe Builder** — describe an AI app in plain English; the platform uses Workers AI to generate a complete sandbox config and spins it up instantly
- **Persistent sandboxes** — each sandbox is a Durable Object with conversation memory, configurable system prompt, model, temperature, and tool definitions
- **Multi-provider AI** — route to Workers AI, OpenAI, Anthropic, or Google via Cloudflare AI Gateway using a `provider:model-id` naming convention
- **App Builder** — describe an app in English; get a full multi-file web app (HTML, JS, CSS) streamed in real time, served at `/build/:id`. Supports vanilla, Alpine, React, Vue, Svelte, and Worker tech stacks
- **Persistent app state** — every generated app gets a KV store backed by `AppStateDO`, accessible at `/api/app/:id/state` and `/api/app/:id/state/:key`
- **Image storage** — R2-backed image upload and serving at `/api/app/:id/images`
- **Email** — send email from generated apps via Cloudflare Email Routing (`POST /api/app/:id/email`, 5/min rate limit per app)
- **Pages deploy** — deploy any generated app to `{project}.pages.dev` via the Cloudflare Pages Direct Upload API (`POST /api/v2/build/:id/deploy`)
- **Aether-Lite SDK** — a zero-dep browser ES module (`/vibe-sdk.js`) and `<aether-lite-chat>` web component for embedding any sandbox anywhere (alias `VibeClient` kept for backwards compat)
- **Apps platform** — each sandbox gets a shareable `/app/:id` page, a stable short API at `/s/:id/run`, and appears in the `/apps` gallery
- **Prompt injection guard** — per-sandbox `guardMode` (`strict` / `audit` / `off`); pattern-based scanner with Unicode normalisation and base64 decode-and-rescan
- **Integrity verification** — SHA-256 fingerprint of every sandbox config stored in the Durable Object; `tampered: true` signals out-of-band modification
- **HMAC-signed exports** — optional `SIGNING_SECRET` enables cryptographic provenance on config export/import

## API

```
GET  /                         health + endpoint map

POST /api/ai/complete          blocking text completion
POST /api/ai/stream            SSE token stream
POST /api/ai/embed             embeddings (bge-base-en-v1.5)
POST /api/ai/image             image generation (flux-1-schnell) → base64 PNG
POST /api/ai/transcribe        multipart audio → transcript (whisper)
POST /api/ai/compare           parallel multi-model comparison with latency
POST /api/ai/sweep             temperature gradient sampling (attractor basin analysis)
POST /api/ai/sensitivity       prompt variant analysis — paraphrase + similarity matrix
POST /api/ai/cluster           k-means semantic clustering of text embeddings
POST /api/ai/cot               chain-of-thought probing (4 reasoning styles in parallel)
POST /api/ai/entropy           attractor stability — sample diversity + entropy measurement
POST /api/ai/archaeology       reverse-engineer candidate system prompts from a response
POST /api/ai/pipeline          declarative node-graph executor with per-node model routing
POST /api/ai/think             extended thinking — explicit reasoning trace before answer

GET  /api/vibes                starter templates
POST /api/vibes                describe app → live sandbox + appUrl + embedCode

GET  /api/sandbox              list all sandboxes
POST /api/sandbox/import       create sandbox from exported config (verifies HMAC signature)
POST /api/sandbox              create sandbox
GET  /api/sandbox/:id          config (no memory) + integrityHash + tampered flag
PATCH /api/sandbox/:id         update config fields (including guardMode)
POST /api/sandbox/:id/run      blocking turn (persists to memory); ?sessionId= for isolated threads
POST /api/sandbox/:id/stream   SSE stream (preview, no memory write); ?sessionId= supported
GET  /api/sandbox/:id/history  full conversation history; ?sessionId= for a specific thread
WS   /api/sandbox/:id/ws       bidirectional WebSocket with tool call support; ?sessionId= supported
GET  /api/sandbox/:id/export   portable config JSON — includes HMAC signature if SIGNING_SECRET set
GET  /api/sandbox/:id/fingerprint  integrity check only (no config fields exposed)
GET  /api/sandbox/:id/metrics  usage totals: runs, tokens in/out, avg latency, per-model breakdown
DELETE /api/sandbox/:id        delete sandbox + KV entry

POST /api/sandbox/:id/documents         upload file for RAG (text, PDF, markdown, CSV, JSON; max 10 MB)
GET  /api/sandbox/:id/documents         list uploaded documents
DELETE /api/sandbox/:id/documents/:docId  delete document + best-effort vector cleanup

POST /api/v2/build             create app build → { buildId, wsUrl, appUrl }
GET  /api/v2/build/:id         build status + blueprint + file list
GET  /api/v2/build/:id/files   list generated filenames
GET  /api/v2/build/:id/files/:filename  fetch generated file content
GET  /api/v2/build/:id/thumbnail        SVG metadata thumbnail
POST /api/v2/build/:id/deploy           deploy to Cloudflare Pages → { url }
WS   /api/v2/build/:id/ws      stream build progress events in real time
DELETE /api/v2/build/:id       delete build + R2 files

GET    /build/:id              serve generated app (index.html)
GET    /build/:id/:filename    serve any file from a generated app

GET    /api/app/:id/state              list all KV entries for a generated app
DELETE /api/app/:id/state              clear all keys for a generated app
GET    /api/app/:id/state/:key         get a single key → { key, value }
PUT    /api/app/:id/state/:key         set a single key (body: { value: string })
DELETE /api/app/:id/state/:key         delete a single key
POST   /api/app/:id/images             upload image (multipart, field: file)
GET    /api/app/:id/images             list uploaded images + metadata
GET    /api/app/:id/images/:imageId    serve image from R2
DELETE /api/app/:id/images/:imageId    delete image
POST   /api/app/:id/email              send email (body: { to, subject, text }); requires SEND_EMAIL binding

GET  /app/:id                  standalone chat UI
GET  /apps                     apps gallery
GET  /s/:id                    redirect → /app/:id
POST /s/:id/run                short stable run API
POST /s/:id/stream             short stable stream API
```

## Model naming

```
@cf/meta/llama-3.1-8b-instruct    Workers AI (default, no key needed)
@cf/meta/llama-3.3-70b-instruct-fp8-fast
openai:gpt-4o                     via Cloudflare AI Gateway
openai:gpt-4o-mini
anthropic:claude-sonnet-4-6
anthropic:claude-opus-4-7
google:gemini-2.0-flash
```

## Security

### Per-sandbox guard mode

Each sandbox has a `guardMode` field that controls how the prompt injection scanner behaves:

| Mode | Behaviour |
|------|-----------|
| `strict` (default) | Blocked patterns → 422; suspicious patterns → D1 audit log |
| `audit` | Never blocks; all detections logged to D1 |
| `off` | Guard disabled — for research sandboxes (AI whisperers) |

Set on creation or patch at any time: `PATCH /api/sandbox/:id` with `{ "guardMode": "off" }`.

### Integrity verification

Every `GET /api/sandbox/:id` returns `integrityHash` (SHA-256 of config + message count) and `tampered: true` if the stored hash doesn't match the live config. Use `GET /api/sandbox/:id/fingerprint` to check integrity without exposing config fields.

### HMAC-signed exports

Set `SIGNING_SECRET` in `.dev.vars` (or the production secret store) to enable cryptographic signing on config exports. `POST /api/sandbox/import` will verify and reject tampered configs with 422.

### Cloudflare Access (Zero Trust)

When `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` are set, all state-mutation endpoints require a valid Cloudflare Access JWT (RS256, validated with Web Crypto against JWKS). Read-only routes, all `/api/ai/*` routes, and all run/stream endpoints remain public.

Token resolution order: `Cf-Access-Jwt-Assertion` header (set automatically by the Access proxy) → `Authorization: Bearer <token>` (for programmatic clients).

### CORS allowlist

Set `ALLOWED_ORIGINS=https://yourdomain.com,https://app.example.com` to restrict cross-origin access. Defaults to `*`.

### Rate limiting

Three independent sliding-window layers:

| Layer | Limit | Applied at |
|-------|-------|-----------|
| Per-IP on `/api/ai/*` | 30 req / 60 s | Router, before dispatch, keyed by `CF-Connecting-IP` |
| Per-sandbox `run`/`stream` | 20 req / 60 s | `SandboxDO`, persists across hibernation |
| Per-app email (`/api/app/:id/email`) | 5 req / 60 s | `sendEmailHandler`, keyed by build ID |

Excess requests return 429.

### X-Request-ID

Every response from the router carries `X-Request-ID: <uuid>` for per-request traceability. The `request_id` column in `sandbox_events` enables correlation of HTTP logs with D1 audit rows.

---

## Aether-Lite SDK

```html
<script type="module">
  import { AetherLiteClient } from '/vibe-sdk.js'
  // VibeClient is a backwards-compat alias for AetherLiteClient
  const client = new AetherLiteClient()   // '' = same origin; pass URL for cross-origin

  // Create a quick AI assistant from a description
  const vibe = await client.vibes.create('A friendly cooking assistant')
  document.body.innerHTML = vibe.embedCode   // instant iframe embed

  // Or stream from it programmatically
  for await (const token of vibe.sandbox().stream('What should I cook tonight?')) {
    el.textContent += token
  }

  // Build a full multi-file app
  const session = client.builder.session('A to-do list with local storage')
    .onBlueprintReady(bp => console.log('stack:', bp.techStack))
    .onComplete(r => {
      console.log('app url:', r.appUrl)
      console.log('thumbnail:', r.thumbnailUrl)
      window.open(r.appUrl)
    })
  await session.start()

  // Access and mutate persistent state from a generated app
  const app = await client.builder.get('your-build-id')
  const val = await app.state.get('counter')     // → string | null
  await app.state.set('counter', '42')
  const all = await app.state.list()             // → { key, value }[]
  await app.state.delete('counter')
  await app.state.clear()

  // Deploy a generated app to Cloudflare Pages
  const { url } = await app.deploy()             // → { url: 'https://...' }
  console.log('live at:', url)

  // Compare the same prompt across multiple models
  const { data } = await client.ai.compare(
    ['@cf/meta/llama-3.1-8b-instruct', 'openai:gpt-4o-mini', 'anthropic:claude-sonnet-4-6'],
    'Explain quantum entanglement in one sentence',
    { temperature: 0.7 }
  )
  data.results.forEach(r => console.log(r.model, r.latencyMs + 'ms', r.response))

  // Sweep temperatures to map attractor basin behaviour
  const sweep = await client.ai.sweep(
    'Generate a product name for a meditation app',
    [0, 0.5, 1.0, 1.5, 2.0],
    { model: '@cf/meta/llama-3.1-8b-instruct', samples: 3 }
  )
</script>

<!-- Drop-in chat widget (Shadow DOM) — three registered aliases -->
<script type="module" src="/vibe-sdk.js"></script>
<aether-lite-chat sandbox-id="abc123"></aether-lite-chat>
<aether-lite-chat sandbox-id="xyz" theme="dark" placeholder="Ask me anything…"></aether-lite-chat>
<!-- backwards-compat aliases also work: <aether-chat>, <vibe-chat> -->
```

### Chart helper (available in generated apps)

```js
import { chart } from '/chart.js'
// Zero-dep SVG bar, line, and pie charts — returns an SVG string
container.innerHTML = chart(
  [{ label: 'Jan', value: 42 }, { label: 'Feb', value: 67 }],
  { type: 'bar', title: 'Monthly signups' }
)
```

Generated apps reference `/chart.js` directly — no CDN, no bundler.

### SandboxHandle properties

`integrityHash`, `tampered`, and `guardMode` are exposed on every `SandboxHandle` instance alongside the existing config fields.

## Setup

```bash
npm install

# Create Cloudflare resources (one-time)
wrangler kv:namespace create SANDBOX_REGISTRY
wrangler d1 create aether-lite
wrangler r2 bucket create aether-lite-files
wrangler queues create aether-lite-jobs
wrangler vectorize create aether-lite-vectors --dimensions=768 --metric=cosine

# Update wrangler.toml with the returned IDs, then:
wrangler d1 execute aether-lite --file=./migrations/0001_init.sql
wrangler d1 execute aether-lite --file=./migrations/0002_request_id.sql

# Local dev (uses remote Workers AI)
npm run dev

# Deploy
npm run deploy
```

Copy `.dev.vars.example` to `.dev.vars` and fill in the values you need:

| Variable | Required | Purpose |
|----------|----------|---------|
| `CLOUDFLARE_ACCOUNT_ID` | For gateway models | Routes to AI Gateway |
| `AI_GATEWAY_ID` | For gateway models | Routes to AI Gateway |
| `OPENAI_API_KEY` | For `openai:` models | Passed to AI Gateway |
| `ANTHROPIC_API_KEY` | For `anthropic:` models | Passed to AI Gateway |
| `GOOGLE_AI_KEY` | For `google:` models | Passed to AI Gateway |
| `CLOUDFLARE_API_TOKEN` | For Pages deploy | Used by `POST /api/v2/build/:id/deploy` to call the Pages Direct Upload API |
| `SIGNING_SECRET` | Optional | HMAC-SHA256 key for export signing (`openssl rand -hex 32`) |
| `ALLOWED_ORIGINS` | Optional | Comma-separated CORS origins; defaults to `*` |
| `CF_ACCESS_AUD` | Optional | Cloudflare Access audience tag — enables Zero Trust auth on mutation endpoints |
| `CF_ACCESS_TEAM_DOMAIN` | Optional | e.g. `yourteam.cloudflareaccess.com` — required when `CF_ACCESS_AUD` is set |

`SEND_EMAIL` is a Cloudflare Email Routing binding (declared in `wrangler.toml`), not an environment variable. It is required only if you want generated apps to be able to send email.

## Stack

| Layer | Technology |
|-------|-----------|
| Compute | Cloudflare Workers |
| Stateful AI agents | Durable Objects — `SandboxDO` (one per sandbox) |
| App build pipeline | Durable Objects — `AppBuilderDO` (one per build) |
| Persistent app state | Durable Objects — `AppStateDO` (one per build) |
| Sandbox registry | Workers KV (with per-key metadata) |
| Audit / metrics | D1 (SQLite) |
| File uploads, app files, images | R2 |
| Async jobs | Queues |
| RAG embeddings | Vectorize |
| AI inference | Workers AI + Cloudflare AI Gateway |
| Time-series telemetry | Analytics Engine |
| Outbound email | Email Routing (`SEND_EMAIL` binding) |
| App hosting | Cloudflare Pages (deploy target via Direct Upload API) |
