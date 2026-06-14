# Setup Guide

Two setup tracks are documented here. Choose the one that suits your workflow.

| Track | Tools needed | Best for |
|-------|-------------|---------|
| **[A — CLI](#track-a--cli)** | `git`, `node` (for `npx`) | Developers comfortable with a terminal |
| **[B — Dashboard](#track-b--cloudflare-dashboard)** | A browser + Cloudflare account | Operators who prefer point-and-click |

Both tracks end with the same running deployment. The CLI track is faster. The Dashboard track is useful if you want to understand every resource before creating it.

> **Note:** Vectorize and Queues require a Cloudflare Workers **Paid plan** ($5/month). All other resources are free-tier.

---

## Track A — CLI

No `npm install` required. All commands use `npx wrangler` which downloads Wrangler on demand.

### A1. Clone the repository

```bash
git clone https://github.com/iki-zen/project-whisper.git
cd project-whisper
```

### A2. Log in to Cloudflare

```bash
npx wrangler login
```

This opens a browser to authorise Wrangler. Run it once — credentials are cached locally.

### A3. Create Cloudflare resources

Run each command once and save the IDs it prints.

```bash
# KV namespaces (sandbox registry + rate limit counters)
npx wrangler kv:namespace create SANDBOX_REGISTRY
npx wrangler kv:namespace create RATE_LIMITS

# D1 database (SQLite — audit log, metrics, vault, probes, atlas, pipelines)
npx wrangler d1 create whisper

# R2 bucket (documents, generated app files, images)
npx wrangler r2 bucket create whisper-files

# Queue (background document processing — paid plan required)
npx wrangler queues create whisper-jobs

# Vectorize index (RAG embeddings — paid plan required)
# 768 dimensions matches @cf/baai/bge-base-en-v1.5. Change if you swap the embedding model.
npx wrangler vectorize create whisper-vectors --dimensions=768 --metric=cosine
```

### A4. Update wrangler.toml

Open `wrangler.toml` and replace the placeholder IDs with the real ones from A3.

**KV namespaces** — each command prints both an `id` and a `preview_id`:

```toml
[[kv_namespaces]]
binding = "SANDBOX_REGISTRY"
id = "<id from SANDBOX_REGISTRY create>"
preview_id = "<preview_id from SANDBOX_REGISTRY create>"

[[kv_namespaces]]
binding = "RATE_LIMITS"
id = "<id from RATE_LIMITS create>"
preview_id = "<preview_id from RATE_LIMITS create>"
```

**D1 database:**

```toml
[[d1_databases]]
binding = "DB"
database_name = "whisper"
database_id = "<database_id from d1 create whisper>"
```

R2, Queues, Vectorize, and Analytics Engine bindings use names directly — no ID changes needed.

### A5. Run database migrations

```bash
# Production database
./scripts/migrate.sh

# Local dev database (only needed if you run `npx wrangler dev --local`)
./scripts/migrate.sh --local
```

All migrations are idempotent — safe to re-run. New migrations added to `migrations/` are picked up automatically by filename sort order.

### A6. Configure environment variables

```bash
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` and fill in the values you need. See the [environment variables reference](#environment-variables) below.

**Cloudflare Access is required to boot.** `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` must both be set or the Worker returns `503` for every request — including locally. Set them before running `wrangler dev`:

```
CF_ACCESS_AUD=<your-aud-tag>
CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
```

See [Required: Cloudflare Access](#required-cloudflare-access-zero-trust) for how to obtain these. Once Access is configured, read-only pages and the run/stream endpoints are reachable; exercising mutation endpoints (create/update/delete) locally requires a valid Access token from your Access application.

For local dev using only Workers AI (`@cf/...` models), no provider API keys are needed beyond the Access variables — everything else is optional depending on which providers and features you use.

### A7. Run locally

```bash
# Uses remote Workers AI (requires wrangler login — recommended)
npx wrangler dev

# Fully local mode (Workers AI returns mock responses)
npx wrangler dev --local
```

The dev server starts at `http://localhost:8787`.

| URL | Page |
|-----|------|
| `http://localhost:8787/` | Chat |
| `http://localhost:8787/vibe.html` | Vibe Builder |
| `http://localhost:8787/tools.html` | AI Workbench |
| `http://localhost:8787/apps` | Apps Gallery |
| `http://localhost:8787/environments` | Environments Gallery |
| `http://localhost:8787/lab` | Labs Gallery (multi-model comparison) |
| `http://localhost:8787/builds` | Builds Gallery (generated apps) |
| `http://localhost:8787/dashboard` | Dashboard |
| `http://localhost:8787/api` | API health + endpoint map |

### A8. Deploy

```bash
npx wrangler deploy
```

#### First deploy checklist

- [ ] `wrangler.toml` has real KV and D1 IDs (not placeholder `000...` values)
- [ ] Remote D1 migrations have been run: `./scripts/migrate.sh`
- [ ] Production secrets added:
  ```bash
  npx wrangler secret put SIGNING_SECRET
  npx wrangler secret put OPENAI_API_KEY
  npx wrangler secret put ANTHROPIC_API_KEY
  # … any other keys your deployment uses
  ```

---

## Track B — Cloudflare Dashboard

All resources can be created through the Cloudflare web dashboard. You will still need `npx wrangler` at the end to run migrations and deploy — there is no browser-based deploy path for a TypeScript Worker.

### B1. Clone the repository

```bash
git clone https://github.com/iki-zen/project-whisper.git
cd project-whisper
```

### B2. Create resources in the dashboard

Log in at [dash.cloudflare.com](https://dash.cloudflare.com) and create each resource below. Each one gives you an ID — save them all for step B3.

#### KV Namespaces (×2)

**Workers & Pages → KV → Create a namespace**

Create two namespaces:
- Name: `SANDBOX_REGISTRY` → save the **Namespace ID**
- Name: `RATE_LIMITS` → save the **Namespace ID**

Preview IDs: go into each namespace → Settings → copy the **Preview Namespace ID** (used for local `wrangler dev`).

#### D1 Database

**Workers & Pages → D1 → Create database**

- Database name: `whisper`
- Save the **Database ID** shown after creation.

#### R2 Bucket

**R2 → Create bucket**

- Bucket name: `whisper-files`
- No ID to save — name is used directly in `wrangler.toml`.

#### Queue (Paid plan required)

**Workers & Pages → Queues → Create**

- Queue name: `whisper-jobs`
- No ID to save — name is used directly.

#### Vectorize Index (Paid plan required)

**Workers & Pages → Vectorize → Create index**

- Index name: `whisper-vectors`
- Dimensions: `768`
- Distance metric: `Cosine`
- No ID to save — name is used directly.

### B3. Update wrangler.toml

Open `wrangler.toml` and paste in the IDs saved in B2.

**KV namespaces:**

```toml
[[kv_namespaces]]
binding = "SANDBOX_REGISTRY"
id = "<SANDBOX_REGISTRY namespace ID>"
preview_id = "<SANDBOX_REGISTRY preview namespace ID>"

[[kv_namespaces]]
binding = "RATE_LIMITS"
id = "<RATE_LIMITS namespace ID>"
preview_id = "<RATE_LIMITS preview namespace ID>"
```

**D1 database:**

```toml
[[d1_databases]]
binding = "DB"
database_name = "whisper"
database_id = "<whisper database ID>"
```

### B4. Run database migrations

The dashboard has a SQL console for D1, but running each file one at a time is tedious. Use the migration runner script instead:

```bash
./scripts/migrate.sh
```

This applies every file in `migrations/` in order and is idempotent — safe to re-run.

Alternatively, if you prefer the dashboard SQL console: open **D1 → whisper → Console**, paste each migration file's contents in filename order, and run it.

### B5. Configure environment variables

```bash
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` and fill in the values you need. See the [environment variables reference](#environment-variables) below.

### B6. Deploy

```bash
npx wrangler deploy
```

Or via the dashboard: **Workers & Pages → Create → Upload a Worker** — however, this path does not support TypeScript or multi-file projects without a pre-built bundle. `npx wrangler deploy` is recommended.

#### Add production secrets via dashboard

**Workers & Pages → your Worker → Settings → Variables and Secrets → Add**

Add each secret (e.g. `OPENAI_API_KEY`, `SIGNING_SECRET`) as an **Encrypted** variable so it is not exposed in plain text.

---

## Environment Variables

These apply to both setup tracks.

| Variable | Required for | Notes |
|----------|-------------|-------|
| `CLOUDFLARE_ACCOUNT_ID` | AI Gateway models, Pages deploy | Find at dash.cloudflare.com → Account Home |
| `AI_GATEWAY_ID` | Any non-`@cf/` model prefix | Create at dash.cloudflare.com → AI → AI Gateway |
| `OPENAI_API_KEY` | `openai:*` models | From platform.openai.com |
| `ANTHROPIC_API_KEY` | `anthropic:*` models | From console.anthropic.com |
| `GOOGLE_AI_KEY` | `google:*` models | From aistudio.google.com |
| `GROQ_API_KEY` | `groq:*` models | From console.groq.com |
| `MISTRAL_API_KEY` | `mistral:*` models | From console.mistral.ai |
| `DEEPSEEK_API_KEY` | `deepseek:*` models | From platform.deepseek.com |
| `XAI_API_KEY` | `xai:*` models (Grok) | From console.x.ai |
| `PERPLEXITY_API_KEY` | `perplexity:*` (includes web search) | From perplexity.ai |
| `CEREBRAS_API_KEY` | `cerebras:*` (ultra-fast Llama) | From cloud.cerebras.ai |
| `OPENROUTER_API_KEY` | `openrouter:*` — 200+ models | From openrouter.ai |
| `COHERE_API_KEY` | `cohere:*` models | From dashboard.cohere.com |
| `HUGGINGFACE_API_KEY` | `huggingface:*` models | From huggingface.co |
| `REPLICATE_API_KEY` | `replicate:*` models | From replicate.com |
| `PARALLEL_API_KEY` | `parallel:*` — web research | From parallel.ai |
| `FAL_API_KEY` | `fal:*` — image generation | From fal.ai |
| `IDEOGRAM_API_KEY` | `ideogram:*` — image generation | From ideogram.ai |
| `ELEVENLABS_API_KEY` | TTS (`provider: "elevenlabs"`) | From elevenlabs.io |
| `CARTESIA_API_KEY` | TTS (`provider: "cartesia"`) | From cartesia.ai |
| `CF_AIG_TOKEN` | `bedrock:*` / `google-vertex-ai:*` BYOK | Cloudflare API token with AI Gateway permissions |
| `AZURE_OPENAI_API_KEY` | `azure:*` models | From portal.azure.com |
| `BASETEN_API_KEY` | `baseten:*` models | From baseten.co |
| `CLOUDFLARE_API_TOKEN` | `POST /api/v2/build/:id/deploy` | Needs Pages:Edit permission |
| `SIGNING_SECRET` | HMAC-signed exports + app tokens (optional) | `openssl rand -hex 32` |
| `ALLOWED_ORIGINS` | Restrict CORS (optional) | Comma-separated, e.g. `https://yourdomain.com` |
| `CF_ACCESS_AUD` | **Required** — Worker returns 503 without this | AUD tag from the Access app |
| `CF_ACCESS_TEAM_DOMAIN` | **Required** — Worker returns 503 without this | e.g. `yourteam.cloudflareaccess.com` |
| `EMAIL_FROM_ADDRESS` | `POST /api/app/:id/email` | Must match a verified Email Routing sender address |

> **Cloudflare Access is required.** The Worker returns `503` and refuses all requests if `CF_ACCESS_AUD` or `CF_ACCESS_TEAM_DOMAIN` are missing. Complete the [Cloudflare Access](#required-cloudflare-access-zero-trust) section below before deploying.

---

## Required: Cloudflare Access (Zero Trust)

The Worker will not serve any requests without this. `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` must be set or every HTTP request returns `503`. Once configured, all `POST`/`PATCH`/`DELETE` endpoints under `/api/` require a valid Access JWT — including the raw AI inference routes.

Sensitive `GET` endpoints are also fail-closed behind Access: `GET /api/sandbox/:id/export` (returns the plaintext system prompt), `GET /api/sandbox/:id/history` and `/export-session` (conversation data; a valid session token also satisfies the gate), `GET /api/vault`, `/api/vault/export.jsonl`, `/api/vault/search` (raw prompts/responses and versioned system prompts), and `GET /api/monitor/stream|audit|patterns` (audit trail and guard telemetry).

Explicitly public carve-outs: the remaining `GET` (read-only) routes, `/api/sandbox/:id/run|stream`, `/s/:id/run|stream`, `/api/app/:id/images|email`, and `/api/csp-report`.

### Via Dashboard

1. Go to **dash.cloudflare.com → Zero Trust → Access → Applications → Add an application**.
2. Choose **Self-hosted**.
3. Set the application domain to your Worker's URL.
4. Create a policy: **Action = Allow**, **Include = Email domain** (your domain).
5. Copy the **Application Audience (AUD)** tag from the application settings page.

### Add to your Worker

```
CF_ACCESS_AUD=<your-aud-tag>
CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
```

Add these to `.dev.vars` for local testing, or as Worker secrets for production.

Programmatic clients pass `Authorization: Bearer <access-token>` instead of the `Cf-Access-Jwt-Assertion` header that the Access proxy sets for browser users.

---

## Optional: Email Sending

Lets generated apps send email via `POST /api/app/:id/email`.

1. Enable Email Routing: **dash.cloudflare.com → Email → Email Routing**.
2. Add and verify a sender address.
3. Add to `wrangler.toml`:
   ```toml
   [[send_email]]
   name = "SEND_EMAIL"
   destination_address = "you@yourdomain.com"
   ```
4. Set `EMAIL_FROM_ADDRESS` in `.dev.vars` to the same verified address.

---

## Optional: Type Checking and Tests

These require a local Node.js install but are not needed to run or deploy the Worker.

```bash
npm install          # install dev deps (wrangler, typescript, tsx)
npm run type-check   # tsc --noEmit — must exit 0 before committing
npm test             # 470 unit tests via tsx
```

---

## Troubleshooting

**`D1_ERROR: no such table: sandbox_events`**
Run all twelve migrations (step A5 or B4). Both `--local` and `--remote` must be run separately if you use both modes.

**`npx wrangler dev` fails with "must be logged in"**
Run `npx wrangler login` first, or use `npx wrangler dev --local` to skip remote Workers AI.

**`@cf/...` models fail locally**
Workers AI only works in remote mode (`npx wrangler dev`). Use `--local` for development with mocked AI responses.

**`openai:`, `anthropic:`, or `google:` models return 502**
Check that `CLOUDFLARE_ACCOUNT_ID`, `AI_GATEWAY_ID`, and the relevant API key are all set in `.dev.vars`.

**Vectorize operations fail locally**
Vectorize has no local simulator. RAG document uploads and retrieval only work after deployment or in remote dev mode.

**Probes with `pipeline` tool return "Pipeline not found"**
Create a pipeline first via `POST /api/pipelines`, then reference its ID in the probe's `params.pipelineId`. The pipeline must exist before the probe runs.
