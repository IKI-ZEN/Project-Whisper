# Setup Guide

This guide walks through everything required to run Project Aether-Lite locally and deploy it to Cloudflare Workers.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20 or later | [nodejs.org](https://nodejs.org) |
| Wrangler CLI | included in devDeps | `npm install` |
| Cloudflare account | free tier works | [cloudflare.com](https://cloudflare.com) |

All infrastructure is Cloudflare-native. No Docker, no database server, nothing to run locally beyond Wrangler.

---

## 1. Clone and install

```bash
git clone https://github.com/iki-zen/project-aether-lite.git
cd project-aether-lite
npm install
```

---

## 2. One-time Cloudflare resource creation

Run each command once. Copy the IDs printed to stdout — you will paste them into `wrangler.toml` in step 3.

```bash
# KV namespaces
wrangler kv:namespace create SANDBOX_REGISTRY
wrangler kv:namespace create RATE_LIMITS

# D1 database (SQLite)
wrangler d1 create aether-lite

# R2 bucket (file storage)
wrangler r2 bucket create aether-lite-files

# Queues (background jobs)
wrangler queues create aether-lite-jobs

# Vectorize index (RAG embeddings — 768-dim cosine, matched to @cf/baai/bge-base-en-v1.5)
# If you swap the embedding model, update --dimensions to match its output size.
wrangler vectorize create aether-lite-vectors --dimensions=768 --metric=cosine
```

> **Note:** Vectorize and Queues require a Cloudflare Workers Paid plan ($5/month). All other resources are free.

---

## 3. Update wrangler.toml

Open `wrangler.toml` and replace the placeholder IDs with the real ones from step 2.

### KV namespaces

```toml
[[kv_namespaces]]
binding = "SANDBOX_REGISTRY"
id = "<id from: wrangler kv:namespace create SANDBOX_REGISTRY>"
preview_id = "<preview_id from the same output>"

[[kv_namespaces]]
binding = "RATE_LIMITS"
id = "<id from: wrangler kv:namespace create RATE_LIMITS>"
preview_id = "<preview_id from the same output>"
```

### D1 database

```toml
[[d1_databases]]
binding = "DB"
database_name = "aether-lite"
database_id = "<database_id from: wrangler d1 create aether-lite>"
```

No changes are needed for R2, Queues, Vectorize, or Analytics Engine — their names are used as-is.

---

## 4. Run database migrations

```bash
# Remote (production) database
wrangler d1 execute aether-lite --remote --file=./migrations/0001_init.sql
wrangler d1 execute aether-lite --remote --file=./migrations/0002_request_id.sql
wrangler d1 execute aether-lite --remote --file=./migrations/0003_identity.sql
wrangler d1 execute aether-lite --remote --file=./migrations/0004_probes.sql
wrangler d1 execute aether-lite --remote --file=./migrations/0005_vault.sql
wrangler d1 execute aether-lite --remote --file=./migrations/0006_assertions.sql
wrangler d1 execute aether-lite --remote --file=./migrations/0007_atlas.sql

# Local dev database (for `npm run dev:local`)
wrangler d1 execute aether-lite --local --file=./migrations/0001_init.sql
wrangler d1 execute aether-lite --local --file=./migrations/0002_request_id.sql
wrangler d1 execute aether-lite --local --file=./migrations/0003_identity.sql
wrangler d1 execute aether-lite --local --file=./migrations/0004_probes.sql
wrangler d1 execute aether-lite --local --file=./migrations/0005_vault.sql
wrangler d1 execute aether-lite --local --file=./migrations/0006_assertions.sql
wrangler d1 execute aether-lite --local --file=./migrations/0007_atlas.sql
```

Run all seven migrations in order. They are idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE` with `IF NOT EXISTS` equivalents).

---

## 5. Configure environment variables

```bash
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` and fill in the values you need. The table below lists what each variable enables:

| Variable | Required for | Notes |
|----------|-------------|-------|
| `CLOUDFLARE_ACCOUNT_ID` | AI Gateway models, Pages deploy | Find at dash.cloudflare.com → Account Home |
| `AI_GATEWAY_ID` | `openai:`, `anthropic:`, `google:` models | Create at dash.cloudflare.com → AI → AI Gateway |
| `OPENAI_API_KEY` | `openai:gpt-4o` and variants | From platform.openai.com |
| `ANTHROPIC_API_KEY` | `anthropic:claude-*` models | From console.anthropic.com |
| `GOOGLE_AI_KEY` | `google:gemini-*` models | From aistudio.google.com |
| `CLOUDFLARE_API_TOKEN` | `POST /api/v2/build/:id/deploy` | Needs Pages:Edit permission |
| `SIGNING_SECRET` | HMAC-signed exports (optional) | `openssl rand -hex 32` |
| `ALLOWED_ORIGINS` | Restrict CORS (optional) | Comma-separated, e.g. `https://yourdomain.com` |
| `CF_ACCESS_AUD` | Cloudflare Access Zero Trust (optional) | AUD tag from the Access app |
| `CF_ACCESS_TEAM_DOMAIN` | Cloudflare Access Zero Trust (optional) | e.g. `yourteam.cloudflareaccess.com` |

**Minimum viable setup** — for local dev using only Workers AI models (`@cf/...`) you only need:

```
ENVIRONMENT=development
```

Everything else is optional.

> **Warning — open AI proxy without Cloudflare Access.** Without `CF_ACCESS_AUD` set, every API endpoint (including all AI inference routes) is publicly accessible to anyone who can reach the Worker URL. This means your Workers AI quota and any third-party API keys are exposed. Before deploying to a public URL, either set `CF_ACCESS_AUD` / `CF_ACCESS_TEAM_DOMAIN` (see [Optional: Cloudflare Access](#optional-cloudflare-access-zero-trust) below) or restrict access at the network level.

---

## 6. Local development

```bash
# Remote Workers AI (requires Cloudflare login: wrangler login)
npm run dev

# Fully local (Workers AI returns mock responses)
npm run dev:local
```

The dev server starts at `http://localhost:8787`.

| URL | What you see |
|-----|-------------|
| `http://localhost:8787/` | Chat page |
| `http://localhost:8787/vibe.html` | Vibe Builder |
| `http://localhost:8787/apps` | Apps gallery |
| `http://localhost:8787/tools.html` | AI Workbench |
| `http://localhost:8787/dashboard` | Dashboard |
| `http://localhost:8787/api` | API health + endpoint map |

### Type checking

```bash
npm run type-check   # npx tsc --noEmit
```

This is the primary correctness gate — there are no automated behavioural tests. The type-checker catches type and logic errors; feature correctness is verified manually. Run it before every commit.

---

## 7. Deploy to production

```bash
npm run deploy   # wrangler deploy
```

Wrangler bundles `src/index.ts` and uploads it to Cloudflare Workers. Static files in `public/` are deployed as Workers Assets.

### First deploy checklist

- [ ] `wrangler.toml` has real KV and D1 IDs (not the placeholder `000...` values)
- [ ] Remote D1 migrations have been run (step 4)
- [ ] `.dev.vars` values that need to be in production are added as Worker secrets:
  ```bash
  wrangler secret put SIGNING_SECRET
  wrangler secret put OPENAI_API_KEY
  wrangler secret put ANTHROPIC_API_KEY
  # etc.
  ```

---

## Optional: Email sending

Cloudflare Email Routing lets generated apps send email via `POST /api/app/:id/email`.

1. Enable Email Routing on your domain at **dash.cloudflare.com → Email → Email Routing**.
2. Add and verify a sender address.
3. Update `wrangler.toml` to reference that address:
   ```toml
   [[send_email]]
   name = "SEND_EMAIL"
   destination_address = "you@yourdomain.com"
   ```
4. Set `EMAIL_FROM_ADDRESS` in `.dev.vars` to the same verified address.

---

## Optional: Cloudflare Access (Zero Trust)

Restricts all state-mutation API endpoints (create/update/delete sandbox, build, upload) to authenticated users while keeping read-only and run/stream endpoints public.

1. Create an Access application at **dash.cloudflare.com → Access → Applications**.
   - Application type: **Self-hosted**
   - Application domain: your Worker's production URL
2. Copy the **Application Audience (AUD)** tag from the application settings.
3. Add to `.dev.vars` (or Worker secrets for production):
   ```
   CF_ACCESS_AUD=<your-aud-tag>
   CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
   ```

Programmatic clients can authenticate by passing `Authorization: Bearer <access-token>` instead of the `Cf-Access-Jwt-Assertion` header that the Access proxy sets automatically.

---

## Troubleshooting

**`D1_ERROR: no such table: sandbox_events`**
Run the migrations (step 4). Both `--local` and `--remote` flags must be run separately.

**`wrangler dev` fails with "must be logged in"**
Run `wrangler login` or use `npm run dev:local` to skip remote AI.

**Workers AI models return errors locally**
`@cf/...` models only work in remote mode (`npm run dev`). Use `npm run dev:local` for purely local dev with mocked AI, or accept that AI calls will fail.

**`openai:`, `anthropic:`, or `google:` models return 502**
Check that `CLOUDFLARE_ACCOUNT_ID`, `AI_GATEWAY_ID`, and the relevant API key are all set in `.dev.vars`.

**Vectorize operations fail locally**
Vectorize has no local simulator. RAG uploads and retrieval will not work in `dev:local` mode; they work normally after `npm run deploy`.
