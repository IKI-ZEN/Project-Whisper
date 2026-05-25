# Project Aether-Lite

A zero-runtime-dependency AI harness on Cloudflare infrastructure. No npm packages are imported at runtime — all routing, streaming, and serialisation use native Web Platform APIs.

## What it does

- **Vibe Builder** — describe an AI app in plain English; the platform uses Workers AI to generate a complete sandbox config and spins it up instantly
- **Persistent sandboxes** — each sandbox is a Durable Object with conversation memory, configurable system prompt, model, temperature, and tool definitions
- **Multi-provider AI** — route to Workers AI, OpenAI, Anthropic, or Google via Cloudflare AI Gateway using a `provider:model-id` naming convention
- **vibeSDK** — a zero-dep browser ES module (`/vibe-sdk.js`) and `<vibe-chat>` web component for embedding any sandbox anywhere
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

GET  /api/vibes                starter templates
POST /api/vibes                describe app → live sandbox + appUrl + embedCode

GET  /api/sandbox              list all sandboxes
POST /api/sandbox/import       create sandbox from exported config (verifies HMAC signature)
POST /api/sandbox              create sandbox
GET  /api/sandbox/:id          config (no memory) + integrityHash + tampered flag
PATCH /api/sandbox/:id         update config fields (including guardMode)
POST /api/sandbox/:id/run      blocking turn (persists to memory)
POST /api/sandbox/:id/stream   SSE stream (preview, no memory write)
GET  /api/sandbox/:id/history  full conversation history
GET  /api/sandbox/:id/export   portable config JSON — includes HMAC signature if SIGNING_SECRET set
GET  /api/sandbox/:id/fingerprint  integrity check only (no config fields exposed)
DELETE /api/sandbox/:id        delete sandbox + KV entry

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

### CORS allowlist

Set `ALLOWED_ORIGINS=https://yourdomain.com,https://app.example.com` to restrict cross-origin access. Defaults to `*`.

### Rate limiting

Each sandbox allows 20 `run`/`stream` calls per 60-second sliding window. Excess requests return 429. The window persists across Durable Object hibernation cycles.

---

## vibeSDK

```html
<script type="module">
  import { VibeClient } from '/vibe-sdk.js'
  const client = new VibeClient()   // '' = same origin; pass URL for cross-origin

  // Create a vibe from a description
  const vibe = await client.vibes.create('A friendly cooking assistant')
  document.body.innerHTML = vibe.embedCode   // instant iframe embed

  // Or stream from it programmatically
  for await (const token of vibe.sandbox().stream('What should I cook tonight?')) {
    el.textContent += token
  }

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

<!-- Drop-in chat widget (Shadow DOM) -->
<script type="module" src="/vibe-sdk.js"></script>
<vibe-chat sandbox-id="abc123"></vibe-chat>
<vibe-chat sandbox-id="xyz" theme="dark" placeholder="Ask me anything…"></vibe-chat>
```

### SandboxHandle properties

`integrityHash`, `tampered`, `guardMode` are exposed on every `SandboxHandle` instance alongside the existing config fields.

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
| `SIGNING_SECRET` | Optional | HMAC-SHA256 key for export signing (`openssl rand -hex 32`) |
| `ALLOWED_ORIGINS` | Optional | Comma-separated CORS origins; defaults to `*` |

## Stack

| Layer | Technology |
|-------|-----------|
| Compute | Cloudflare Workers |
| Stateful AI agents | Durable Objects (one per sandbox) |
| Sandbox registry | Workers KV (with per-key metadata) |
| Audit / metrics | D1 (SQLite) |
| File uploads | R2 |
| Async jobs | Queues |
| RAG embeddings | Vectorize |
| AI inference | Workers AI + Cloudflare AI Gateway |
