# Contributing to Project Whisper

Whisper is a zero-runtime-dependency AI harness running entirely on Cloudflare infrastructure. Everything is native Web Platform APIs — no npm packages are imported at runtime.

---

## 1. Prerequisites

- **Node.js 20 or later** — required by Wrangler 4.
- **A Cloudflare account** — the free tier is sufficient for local development with Workers AI models.
- **Wrangler CLI** — available via `npx wrangler` without any install step. Run `npm install` only if you need type-check (`npm run type-check`) or tests (`npm test`).
- **No external API keys for basic local dev** — `@cf/…` Workers AI models run without any API key. OpenAI, Anthropic, and Google keys are only needed if you want to test AI Gateway routing.

---

## 2. Local setup

### First-time clone

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd project-whisper
   ```
   `npm install` is optional — only needed for type-check and tests. To run or deploy the Worker, `npx wrangler` is sufficient.

2. Copy the example env file and fill in values you need:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   For local dev with `@cf/…` Workers AI models, the file can stay mostly empty. See [Environment variables](#7-environment-variables) below.

3. Start the dev server:
   ```bash
   npx wrangler dev        # uses remote Workers AI — requires `npx wrangler login` first
   npx wrangler dev --local  # uses simulated local AI — no network calls, no login required
   ```
   Open `http://localhost:8787` for the chat UI. The Vibe Builder is at `/vibe.html`, AI Workbench at `/tools.html`, and Environments at `/environments`.

### One-time Cloudflare resource creation

These commands provision the cloud resources that bindings in `wrangler.toml` point to. Run each once per Cloudflare account, then update `wrangler.toml` with the returned IDs.

```bash
wrangler kv:namespace create SANDBOX_REGISTRY
wrangler kv:namespace create RATE_LIMITS
wrangler d1 create whisper
wrangler r2 bucket create whisper-files
wrangler queues create whisper-jobs
wrangler vectorize create whisper-vectors --dimensions=768 --metric=cosine

# Apply D1 schema migrations (run all in order)
wrangler d1 execute whisper --file=./migrations/0001_init.sql
wrangler d1 execute whisper --file=./migrations/0002_request_id.sql
wrangler d1 execute whisper --file=./migrations/0003_identity.sql
wrangler d1 execute whisper --file=./migrations/0004_probes.sql
wrangler d1 execute whisper --file=./migrations/0005_vault.sql
wrangler d1 execute whisper --file=./migrations/0006_assertions.sql
wrangler d1 execute whisper --file=./migrations/0007_atlas.sql
wrangler d1 execute whisper --file=./migrations/0008_sandbox_analysis.sql
wrangler d1 execute whisper --file=./migrations/0009_usage_cost.sql
wrangler d1 execute whisper --file=./migrations/0010_pipelines_webhooks.sql
wrangler d1 execute whisper --file=./migrations/0011_env_integration.sql
wrangler d1 execute whisper --file=./migrations/0012_assertions_atlas_env.sql
```

After running the above, paste the returned `id` / `preview_id` values into the placeholder entries in `wrangler.toml`.

The three Durable Object classes (`SandboxDO`, `AppBuilderDO`, `AppStateDO`) and `AppStateDO`'s v3 migration are handled automatically on first deploy — no extra steps needed.

Email sending requires Cloudflare Email Routing to be enabled on your domain and a verified `[[send_email]]` destination configured in `wrangler.toml`.

---

## 3. Development workflow

### Tests and type-check

Both must pass before every commit:

```bash
npm test             # runs all 184 unit tests (src/**/*.test.ts) via tsx
npm run type-check   # tsc --noEmit — must also exit 0
```

TypeScript `strict: true` is enabled — the compiler catches most logic and type errors. Run both after every non-trivial change.

### UI pages

The dev server serves several pages:

| URL | Page |
|-----|------|
| `http://localhost:8787/` | Chat |
| `http://localhost:8787/vibe.html` | Vibe Builder |
| `http://localhost:8787/tools.html` | AI Workbench (Whisperer, probes, vault, etc.) |
| `http://localhost:8787/environments` | Environments gallery |
| `http://localhost:8787/dashboard` | Dashboard |

No build step is needed — all pages are served as static assets or server-rendered by the Worker.

### Deploy

```bash
npm run deploy   # wrangler deploy
```

---

## 4. Coding standards

These are hard rules, not style preferences.

**Zero runtime npm dependencies.** Nothing may be imported from npm at runtime. All HTTP routing, streaming, serialisation, cryptography, and text processing use native Web Platform APIs (`URLPattern`, `ReadableStream`, `crypto.subtle`, `TextEncoder`, `DecompressionStream`, etc.).

**All JSON-body parsing goes through `parseBody` + a parser in `src/lib/schema.ts`.** Never call `req.json()` directly in a route handler. The pattern is:
```typescript
const parsed = await parseBody(req, parseFooRequest);
if (!parsed.ok) return parsed.response;
const { data } = parsed;
```
Parser functions live in `src/lib/schema.ts` and throw `Error` with a human-readable message on invalid input. `parseBody` converts that throw to a 422 response automatically. For routes where the JSON body is genuinely optional, use `parseBodyOptional(req, parser, fallback)` from `src/lib/http.ts` — it returns the fallback value instead of a 400 when the body is absent.

Whisperer tools that need `sandboxId`/`autoVault` envelope support use `parseWithEnvelope(req, parser)` instead of `parseBody`.

**Magic numbers belong in `src/lib/constants.ts`.** Length limits, TTLs, rate limit windows, and other numeric thresholds must be named constants — not inline literals.

**Durable Objects are always addressed by `idFromName()`, never by generated DO ID.** Generated IDs are non-deterministic and cannot be reconstructed from a logical name. Always use the logical name (sandbox UUID or build UUID) as the stable address:
```typescript
// Correct
env.SANDBOX.get(env.SANDBOX.idFromName(sandboxId))

// Wrong
env.SANDBOX.get(env.SANDBOX.newUniqueId())
```

**DO calls use `doFetch()` with the `https://do/` pseudo-protocol.** `doFetch` is exported from `src/routes/sandbox.ts`. Do not construct raw `Request` objects against DO stubs manually.

**Use `newId()` from `src/lib/utils.ts` for ID generation** — not `crypto.randomUUID()` directly. This keeps ID generation in one place.

**Validate user-supplied `:id` parameters as UUIDs before use.** Any path segment that feeds into an R2 key, DO stub, or KV key must be validated as a UUID before use:
```typescript
const id = params.id ?? ''
if (!isUUID(id)) return json(err('Invalid id'), 422)
```

**Use `parseQueryInt()` from `src/lib/http.ts` for integer query parameters.** Never use inline `parseInt`/`isNaN`/`Math.min/max` patterns:
```typescript
const limit = parseQueryInt(url.searchParams, 'limit', LIST_LIMIT_DEFAULT, 1, LIST_LIMIT_MAX)
```

**Use `now()` from `src/lib/utils.ts` for timestamps** — not `Date.now()` directly.

**Use the `bool()` helper inside schema parsers** for boolean body fields — not `=== true` or `typeof x === 'boolean'` inline. (`bool` is private to `src/lib/schema.ts`; use it only inside parser functions there.)

**TypeScript `strict: true` — no `any` casts without justification.** If you need to escape the type system, add an inline comment explaining why.

---

## 5. Adding a new route

1. **Add the handler** in the relevant route file (`src/routes/ai.ts`, `sandbox.ts`, `build.ts`, `appstate.ts`, `pipelines.ts`, etc.). If it is a genuinely new area, create a new file under `src/routes/`.

2. **Add a parser** in `src/lib/schema.ts` if the route accepts a JSON body. Follow the existing `parseFooRequest(raw: unknown): FooRequest` pattern.

3. **Add constants** to `src/lib/constants.ts` for any new length limits, counts, or timing thresholds.

4. **Wire up the route** in the route table array of the relevant file. Routes use the `Router` from `src/lib/http.ts` — call `router.get(pattern, handler)` / `router.post(...)` etc.

5. **Register the route file** in `src/index.ts` if you created a new file (import it and call `router.mount()` or equivalent, following the existing pattern).

6. **Run `npm run type-check`** and fix all errors before committing.

---

## 6. Pull request process

### Branch naming

Use a short, descriptive kebab-case name prefixed with the kind of change:

```
feat/stream-cancellation
fix/guard-base64-decode
refactor/schema-parsers
docs/contributing
```

### Commit message style

Imperative mood, present tense, concise. No period at the end of the subject line.

```
Add chain-of-thought pipeline node type
Fix base64 decode loop off-by-one in guard scan
Refactor parseBody to accept async parsers
```

One subject line is enough for most commits. Add a blank line and a body only when the why is not obvious from the diff.

### PR checklist

Before opening a PR, confirm all of the following:

- [ ] `npm test` exits 0 — all unit tests pass.
- [ ] `npm run type-check` exits 0 — no TypeScript errors.
- [ ] New routes that accept a JSON body use `parseBody(req, parseFoo)` — no raw `req.json()`.
- [ ] New routes with a user-supplied `:id` in the path validate it as a UUID before use in R2, KV, or DO stubs.
- [ ] New numeric limits or thresholds are named constants in `src/lib/constants.ts`, not inline literals.
- [ ] New Durable Object accesses use `idFromName()`, not generated IDs.
- [ ] Integer query params use `parseQueryInt()` from `src/lib/http.ts` — no inline `parseInt`/`isNaN`/`Math.min/max`.
- [ ] Boolean body fields in schema parsers use `bool()` — no inline `=== true` coercions.
- [ ] Timestamps use `now()` from `src/lib/utils.ts` — not `Date.now()` directly.
- [ ] New expensive routes (DO creation, multi-step AI chains) have `checkRateLimit` applied.
- [ ] No npm packages added to `dependencies` in `package.json` (dev dependencies are fine).
- [ ] `CLAUDE.md` updated if you changed routing patterns, added a new binding, or altered a behaviour described there.
- [ ] New pipelines or probes with `webhookUrl` fields: ensure webhook URL is validated as `https://` prefix.

---

## 7. Environment variables

`.dev.vars.example` contains the full annotated list. Copy it to `.dev.vars` for local development — Wrangler reads `.dev.vars` automatically and never commits it.

For basic local development with `@cf/…` Workers AI models, most variables can be left blank. The variables that unlock additional functionality are:

| Variable | When needed |
|----------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` + `AI_GATEWAY_ID` | Route any non-`@cf/` model prefix through AI Gateway |
| `OPENAI_API_KEY` | `openai:*` models |
| `ANTHROPIC_API_KEY` | `anthropic:*` models |
| `GOOGLE_AI_KEY` | `google:*` models |
| `GROQ_API_KEY` | `groq:*` models |
| `MISTRAL_API_KEY` | `mistral:*` models |
| `DEEPSEEK_API_KEY` | `deepseek:*` models |
| `XAI_API_KEY` | `xai:*` models (Grok) |
| `PERPLEXITY_API_KEY` | `perplexity:*` models (includes web search) |
| `CEREBRAS_API_KEY` | `cerebras:*` models (ultra-fast inference) |
| `OPENROUTER_API_KEY` | `openrouter:*` — 200+ models via one key |
| `COHERE_API_KEY` | `cohere:*` models |
| `HUGGINGFACE_API_KEY` | `huggingface:*` models |
| `REPLICATE_API_KEY` | `replicate:*` models |
| `PARALLEL_API_KEY` | `parallel:*` — web research and extraction |
| `FAL_API_KEY` | `fal:*` — image generation (returns URL) |
| `IDEOGRAM_API_KEY` | `ideogram:*` — image generation (returns URL) |
| `CARTESIA_API_KEY` | TTS via `POST /api/ai/tts` with `provider: "cartesia"` |
| `ELEVENLABS_API_KEY` | TTS via `POST /api/ai/tts` with `provider: "elevenlabs"` |
| `CF_AIG_TOKEN` | Amazon Bedrock (`bedrock:*`) and Google Vertex AI (`google-vertex-ai:*`) via BYOK |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI (`azure:*`) models |
| `BASETEN_API_KEY` | Baseten (`baseten:*`) models |
| `SIGNING_SECRET` | HMAC-SHA256 signing of sandbox export payloads and app tokens |
| `ALLOWED_ORIGINS` | Restrict CORS to specific origins (default: wildcard `*`) |
| `CF_ACCESS_AUD` + `CF_ACCESS_TEAM_DOMAIN` | Cloudflare Zero Trust JWT validation on mutation endpoints |
| `CLOUDFLARE_API_TOKEN` | `POST /api/v2/build/:id/deploy` — deploy generated apps to Cloudflare Pages |
| `EMAIL_FROM_ADDRESS` | Verified sender address for `POST /api/app/:id/email` |

The `ENVIRONMENT` variable is set to `"development"` automatically by `wrangler.toml` and does not need to be in `.dev.vars`.

---

## 8. Deployment and rollback

```bash
npm run deploy              # wrangler deploy — deploys to production

# Roll back to the previous deployment
wrangler rollback

# See full deployment history
wrangler deployments list
```

**Important:** `wrangler rollback` reverts Worker code to the previous deployment instantly. D1 schema migrations are not automatically reversed — if a migration caused the problem, roll back the code first, then assess whether a manual SQL fix is needed. Migration files contain comments with the reverse SQL where applicable.
