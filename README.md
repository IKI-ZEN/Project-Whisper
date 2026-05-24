# Project Aether-Lite

A zero-runtime-dependency AI harness on Cloudflare infrastructure. No npm packages are imported at runtime — all routing, streaming, and serialisation use native Web Platform APIs.

## What it does

- **Vibe Builder** — describe an AI app in plain English; the platform uses Workers AI to generate a complete sandbox config and spins it up instantly
- **Persistent sandboxes** — each sandbox is a Durable Object with conversation memory, configurable system prompt, model, temperature, and tool definitions
- **Multi-provider AI** — route to Workers AI, OpenAI, Anthropic, or Google via Cloudflare AI Gateway using a `provider:model-id` naming convention
- **vibeSDK** — a zero-dep browser ES module (`/vibe-sdk.js`) and `<vibe-chat>` web component for embedding any sandbox anywhere
- **Apps platform** — each sandbox gets a shareable `/app/:id` page, a stable short API at `/s/:id/run`, and appears in the `/apps` gallery

## API

```
GET  /                         health + endpoint map

POST /api/ai/complete          blocking text completion
POST /api/ai/stream            SSE token stream
POST /api/ai/embed             embeddings (bge-base-en-v1.5)
POST /api/ai/image             image generation (flux-1-schnell) → base64 PNG
POST /api/ai/transcribe        multipart audio → transcript (whisper)

GET  /api/vibes                starter templates
POST /api/vibes                describe app → live sandbox + appUrl + embedCode

GET  /api/sandbox              list all sandboxes
POST /api/sandbox              create sandbox
GET  /api/sandbox/:id          config (no memory)
PATCH /api/sandbox/:id         update config fields
POST /api/sandbox/:id/run      blocking turn (persists to memory)
POST /api/sandbox/:id/stream   SSE stream (preview, no memory write)
GET  /api/sandbox/:id/history  full conversation history
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
</script>

<!-- Drop-in chat widget (Shadow DOM) -->
<script type="module" src="/vibe-sdk.js"></script>
<vibe-chat sandbox-id="abc123"></vibe-chat>
<vibe-chat sandbox-id="xyz" theme="dark" placeholder="Ask me anything…"></vibe-chat>
```

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

Copy `.dev.vars.example` to `.dev.vars` and add API keys to use OpenAI, Anthropic, or Google models.

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
