# Project Whisper — Frequently Asked Questions

---

## Core Concepts

### Q: What is a Sandbox?

A Sandbox is the fundamental unit of the platform — an isolated, stateful AI environment backed by a single Durable Object (`SandboxDO`). It holds a system prompt, conversation memory, model configuration, tool definitions, guard mode, and an optional RAG knowledge base. Every sandbox gets a shareable URL at `/app/:id`, a stable short API at `/s/:id/run` and `/s/:id/stream`, and a one-line embed snippet.

### Q: What is an App?

An App is a generated multi-file web application (HTML, CSS, JavaScript) produced by the App Builder from a plain-English description. It is served at `/build/:id` the moment generation completes — no deployment step is required. Generated apps have access to a built-in key-value store (`AppStateDO`), R2-backed image storage, and email sending, all accessible from browser JavaScript with no backend code.

### Q: What is an Environment?

An Environment is a specialised sandbox with a fixed operating mode (`envType`) that governs the AI-generated system prompt, default temperature, and which platform features activate. Environments are distinguished from ordinary sandboxes only by a `fromEnv: true` flag in KV metadata — they use the same `SandboxDO` and all sandbox routes work on them unchanged. The environment UI at `/env/:id` adds Compare mode, which fans a message out to up to 4 models simultaneously.

### Q: What is the difference between a Sandbox and an Environment?

Both are `SandboxDO` instances under the hood. An Environment has three extra fields: `envType` (the operating mode), `envModels` (1–4 models for Compare mode), and the `fromEnv: true` metadata flag. The platform generates the system prompt and temperature automatically from the `description` and `envType` when you create an environment. You manage environments through `/api/environments/*` and view them in the `/environments` gallery; all other operations (run, stream, fork, export, history) use the standard `/api/sandbox/*` routes.

### Q: Can multiple users share the same Sandbox?

Yes. A sandbox supports multiple named session threads via the optional `?sessionId=` parameter on `/run`, `/stream`, `/history`, and the WebSocket endpoint. Omitting `sessionId` uses a shared default session. Different users can maintain independent conversation threads within a single sandbox by supplying distinct session IDs.

### Q: How does conversation memory work?

Each sandbox keeps a rolling conversation history of up to 100 turns per session, stored in its Durable Object. The full history is injected into context on every `/run` or `/stream` call. The `/stream` endpoint is a preview — it does not write to memory. Only `/run` (and the WebSocket `message` event) persist turns. Retrieve the full history at `GET /api/sandbox/:id/history` (add `?sessionId=` for a specific thread).

---

## Getting Started

### Q: Do I need a paid Cloudflare plan?

Vectorize and Queues require a Cloudflare Workers **Paid plan** ($5/month). All other resources — Workers, Durable Objects, KV, D1, R2, and Workers AI for `@cf/` models — are available on the free tier.

### Q: Can I run this without any API keys?

Yes. Workers AI (`@cf/meta/llama-3.1-8b-instruct` and `@cf/meta/llama-3.3-70b-instruct-fp8-fast`) runs on-network with no third-party key. The minimum `.dev.vars` entry for local development is `ENVIRONMENT=development`. All `openai:`, `anthropic:`, `google:`, and other gateway-routed models require their respective API keys plus `CLOUDFLARE_ACCOUNT_ID` and `AI_GATEWAY_ID`.

### Q: What is the minimum setup to get something working?

Clone the repository, copy `.dev.vars.example` to `.dev.vars`, run the Cloudflare resource creation commands (`kv:namespace`, `d1 create`, `r2 bucket create`, `queues create`, `vectorize create`), paste the returned IDs into `wrangler.toml`, run all twelve D1 migrations, and then run `npx wrangler dev`. Full step-by-step instructions are in `SETUP.md`.

### Q: Do I need to run `npm install`?

No. The CLI track in `SETUP.md` uses `npx wrangler` throughout, which downloads Wrangler on demand without a local install. `npm install` is only needed if you want to run the type-checker (`npm run type-check`) or the unit test suite (`npm test`) — both require a local Node.js install but are not needed to run or deploy the Worker.

---

## Models and Providers

### Q: How do I switch AI models?

Set the `model` field when creating or patching a sandbox: `PATCH /api/sandbox/:id` with `{ "model": "anthropic:claude-sonnet-4-6" }`. For direct AI calls (`/api/ai/complete`, `/api/ai/stream`), pass `model` in the request body. The Vibe Builder picks a model automatically from your description; you can override it in the config before or after creation.

### Q: How do I add my own OpenAI / Anthropic / Google key?

Add the key to `.dev.vars` (for local dev) or as a Worker secret (for production via `npx wrangler secret put`). You also need `CLOUDFLARE_ACCOUNT_ID` and `AI_GATEWAY_ID` set, because all third-party keys are routed through Cloudflare AI Gateway. The full list of per-provider variable names is in the Environment Variables table in `SETUP.md`.

### Q: What is the `openai:`, `anthropic:` prefix syntax?

The `provider:model-id` string is the platform's model naming convention. The part before the colon identifies the provider; the platform uses it to route the request through AI Gateway with the correct API key. For example, `openai:gpt-4o-mini` calls the OpenAI API via AI Gateway using `OPENAI_API_KEY`. `@cf/meta/llama-3.1-8b-instruct` (no colon prefix) is a Workers AI model and needs no external key.

### Q: What is AI Gateway and why does the platform use it?

Cloudflare AI Gateway is a proxy layer that sits between the Worker and third-party AI providers (OpenAI, Anthropic, Google, Groq, and 20+ others). The platform routes all non-`@cf/` model calls through it. This means all inference traffic stays on Cloudflare's network, you get a single dashboard for request logs and cost visibility, and features like `zdr` (Zero Data Retention) and `byokAlias` (named credentials from Secrets Store) are available without changes to your API keys. You create a gateway at **dash.cloudflare.com → AI → AI Gateway** and paste the resulting ID into `AI_GATEWAY_ID`.

---

## Features

### Q: What is the Whisper SDK?

The Whisper SDK (`/vibe-sdk.js`) is a zero-dependency browser ES module that wraps the entire platform API in a fluent JavaScript interface. It exposes `WhisperClient` (with `VibeClient` as a backwards-compatible alias) and the `<whisper-chat>` web component for drop-in embedding. The SDK handles streaming, error handling, and authentication automatically. Load it directly from the platform — no npm package, no bundler required.

```html
<script type="module">
  import { WhisperClient } from '/vibe-sdk.js'
  const client = new WhisperClient()
  const vibe = await client.vibes.create('A customer support bot')
  document.body.innerHTML = vibe.embedCode
</script>
```

### Q: What is the difference between `/run` and `/stream`?

`POST /api/sandbox/:id/run` (and the short form `/s/:id/run`) is a blocking call that waits for the full response, writes the turn to conversation memory, and returns the complete text in a JSON envelope. `POST /api/sandbox/:id/stream` returns a Server-Sent Events stream of token chunks as the model generates them, but does **not** write to memory — it is a preview call. Use `/run` when you need the turn persisted; use `/stream` when you want real-time output without affecting history.

### Q: What is RAG and how do I enable it?

RAG (Retrieval-Augmented Generation) lets a sandbox answer questions using content from documents you upload. Upload files to `POST /api/sandbox/:id/documents` (supported types: `.txt`, `.md`, `.csv`, `.json`, `.pdf`, `.html`; max 10 MB each). Documents are chunked, embedded via `@cf/baai/bge-base-en-v1.5`, and stored in a Vectorize index. Enable retrieval by setting `ragEnabled: true` when creating the sandbox or by patching it: `PATCH /api/sandbox/:id` with `{ "ragEnabled": true }`. When enabled, relevant chunks are automatically injected into context before each reply. Vectorize requires the Workers Paid plan.

### Q: What is the prompt injection guard?

Each sandbox has a `guardMode` field that controls a pattern-based content scanner with Unicode normalisation and base64 decode-and-rescan. In `strict` mode (the default), prompts matching injection patterns are blocked with a 422 response and suspicious patterns are logged to D1. In `audit` mode the scanner never blocks — it only logs to the audit trail. In `off` mode the scanner is disabled entirely, which is appropriate for research sandboxes that need to study adversarial inputs. Change it at any time: `PATCH /api/sandbox/:id` with `{ "guardMode": "audit" }`.

### Q: What is an Environment's `envType`?

`envType` is the operating mode of an Environment. It controls the AI-generated system prompt, default temperature, and UI behaviour. The seven valid values are:

| `envType` | Effect |
|-----------|--------|
| `general` | Balanced general assistant |
| `coding` | Code review and implementation; monospace UI |
| `research` | RAG enabled by default; citation-aware |
| `structured` | Always returns valid JSON in a `<pre>` block |
| `creative` | High temperature; multiple voice variants |
| `agent` | Tool-oriented; step-by-step reasoning |
| `debate` | Models assigned opposing positions |

If omitted on creation, `general` is the default.

### Q: What is Compare mode?

Compare mode is the UI available at `/env/:id`. When an Environment has multiple models in its `envModels` array (up to 4), every message submitted in the environment chat fans out to all configured models simultaneously. Responses stream in parallel into side-by-side columns so you can see how models diverge on the same prompt. Compare mode is triggered automatically whenever `envModels.length > 1`.

---

## Security and Access

### Q: Is the API open to the public?

No. `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` are required — the Worker returns `503` and refuses all requests if either is missing. There is no unauthenticated mode.

### Q: How do I configure Cloudflare Access?

Create an Access application at **dash.cloudflare.com → Zero Trust → Access → Applications**, copy the AUD tag, and add `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` as Worker secrets. Once set, all state-mutation endpoints (create, update, delete sandbox; build; upload) require a valid Access JWT. Read-only routes and all `/api/ai/*`, `/run`, and `/stream` endpoints remain public. Programmatic clients pass `Authorization: Bearer <access-token>`; browser users are handled by the Access proxy automatically. See `SETUP.md` for step-by-step instructions.

You can also restrict cross-origin access by setting `ALLOWED_ORIGINS` to a comma-separated list of allowed domains (e.g. `https://yourdomain.com,https://app.example.com`). The default is `*`.

### Q: What is HMAC-signed export/import?

When `SIGNING_SECRET` is set (generate one with `openssl rand -hex 32`), `GET /api/sandbox/:id/export` and `GET /api/environments/:id/export` include an HMAC-SHA256 signature field in the returned JSON. On import (`POST /api/sandbox/import` or `POST /api/environments/import`), the platform verifies the signature and rejects any config that has been modified in transit with a 422. This provides cryptographic provenance guarantees when sharing sandbox or environment configurations between separate deployments.

---

## Operations

### Q: How do I roll back a deployment?

Cloudflare Workers supports instant rollback via the dashboard (**Workers & Pages → your Worker → Deployments → activate a previous version**) or via `npx wrangler rollback`. The Worker itself is stateless — all persistent data lives in Durable Objects, KV, D1, and R2, which are unaffected by a Worker rollback. If a D1 schema migration caused problems, you will need to apply a corrective migration manually, as D1 migrations are not automatically reversible.

### Q: How do I update environment variables in production?

For secrets, use `npx wrangler secret put VARIABLE_NAME` — you will be prompted to enter the value. For non-sensitive variables, add them to the `[vars]` section of `wrangler.toml` and redeploy with `npx wrangler deploy`. Via the dashboard: **Workers & Pages → your Worker → Settings → Variables and Secrets → Add**. Set sensitive values as **Encrypted** variables so they are not exposed in plain text. Changes take effect on the next request after the deployment propagates.

### Q: What are the rate limits?

All limits use a sliding-window algorithm and return HTTP 429 on excess. Key limits:

| Scope | Limit | Window |
|-------|-------|--------|
| All `/api/ai/*` routes | 30 req | per IP / 1 min |
| Sandbox run / stream | 20 req | per sandbox / 1 min |
| Vibe / App Builder create | 5 req | per IP / 1 min |
| Whisperer analysis tools | 15 req | per IP / 1 min |
| Sandbox create / import / fork | 10 req | per IP / 1 min |
| Vault cluster analysis | 3 req | per IP / 5 min |
| Vault semantic search | 20 req | per IP / 1 min |
| Pipeline execution | 20 req | per IP / 1 min |
| Replay | 10 req | per IP / 1 min |
| App email | 5 req | per app / 1 min |
| App image upload | 20 req | per app / 1 min |
| Document upload | 20 req | per IP / 1 min |
| Monitor stream / audit | 30 req | per IP / 1 min |
