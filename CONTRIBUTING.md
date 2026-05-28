# Contributing to Project Aether-Lite

Aether-Lite is a zero-runtime-dependency AI harness running entirely on Cloudflare infrastructure. Everything is native Web Platform APIs — no npm packages are imported at runtime.

---

## 1. Prerequisites

- **Node.js 20 or later** — required by Wrangler 4.
- **A Cloudflare account** — the free tier is sufficient for local development with Workers AI models.
- **Wrangler CLI** — installed as a dev dependency; `npm install` is all you need. No global install required.
- **No external API keys for basic local dev** — `@cf/…` Workers AI models run without any API key. OpenAI, Anthropic, and Google keys are only needed if you want to test AI Gateway routing.

---

## 2. Local setup

### First-time clone

1. Clone the repository and install dev dependencies:
   ```bash
   git clone <repo-url>
   cd project-aether-lite
   npm install
   ```

2. Copy the example env file and fill in values you need:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   For local dev with `@cf/…` Workers AI models, the file can stay mostly empty. See [Environment variables](#7-environment-variables) below.

3. Start the dev server:
   ```bash
   npm run dev        # uses remote Workers AI — requires `wrangler login` first
   npm run dev:local  # uses simulated local AI — no network calls, no login required
   ```
   Open `http://localhost:8787` for the playground UI (`public/playground.html`).

### One-time Cloudflare resource creation

These commands provision the cloud resources that bindings in `wrangler.toml` point to. Run each once per Cloudflare account, then update `wrangler.toml` with the returned IDs.

```bash
wrangler kv:namespace create SANDBOX_REGISTRY
wrangler d1 create aether-lite
wrangler r2 bucket create aether-lite-files
wrangler queues create aether-lite-jobs
wrangler vectorize create aether-lite-vectors --dimensions=768 --metric=cosine

# Apply D1 schema migrations
wrangler d1 execute aether-lite --file=./migrations/0001_init.sql
wrangler d1 execute aether-lite --file=./migrations/0002_request_id.sql
```

After running the above, paste the returned `id` / `preview_id` values into the placeholder entries in `wrangler.toml`.

The three Durable Object classes (`SandboxDO`, `AppBuilderDO`, `AppStateDO`) and `AppStateDO`'s v3 migration are handled automatically on first deploy — no extra steps needed.

Email sending requires Cloudflare Email Routing to be enabled on your domain and a verified `[[send_email]]` destination configured in `wrangler.toml`.

---

## 3. Development workflow

### Type-check

There are no automated tests. `tsc --noEmit` is the primary correctness gate and **must pass before every commit**:

```bash
npm run type-check
```

Run it after every non-trivial change. TypeScript `strict: true` is enabled — the compiler will catch most logic and type errors.

### Playground UI

`public/playground.html` is a four-tab SPA (Vibe Builder / Sandbox Chat / AI Workbench / Whisperer). It loads automatically at `http://localhost:8787` when the dev server is running. No build step is needed — it is served as a static asset.

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
Parser functions live in `src/lib/schema.ts` and throw `Error` with a human-readable message on invalid input. `parseBody` converts that throw to a 422 response automatically.

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

**Validate user-supplied `:id` parameters as UUIDs before use.** Any path segment that feeds into an R2 key, DO stub, or KV key must be validated as a UUID before use. See `appstate.ts` for the existing pattern.

**TypeScript `strict: true` — no `any` casts without justification.** If you need to escape the type system, add an inline comment explaining why.

---

## 5. Adding a new route

1. **Add the handler** in the relevant route file (`src/routes/ai.ts`, `sandbox.ts`, `build.ts`, `appstate.ts`, etc.). If it is a genuinely new area, create a new file under `src/routes/`.

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

- [ ] `npm run type-check` exits 0 — no TypeScript errors.
- [ ] New routes that accept a JSON body use `parseBody(req, parseFoo)` — no raw `req.json()`.
- [ ] New routes with a user-supplied `:id` in the path validate it as a UUID before use in R2, KV, or DO stubs.
- [ ] New numeric limits or thresholds are named constants in `src/lib/constants.ts`, not inline literals.
- [ ] New Durable Object accesses use `idFromName()`, not generated IDs.
- [ ] No npm packages added to `dependencies` in `package.json` (dev dependencies are fine).
- [ ] `CLAUDE.md` updated if you changed routing patterns, added a new binding, or altered a behaviour described there.

---

## 7. Environment variables

`.dev.vars.example` contains the full annotated list. Copy it to `.dev.vars` for local development — Wrangler reads `.dev.vars` automatically and never commits it.

For basic local development with `@cf/…` Workers AI models, most variables can be left blank. The variables that unlock additional functionality are:

| Variable | When needed |
|----------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` + `AI_GATEWAY_ID` | To route `openai:`, `anthropic:`, or `google:` model prefixes through AI Gateway |
| `OPENAI_API_KEY` | OpenAI models via AI Gateway |
| `ANTHROPIC_API_KEY` | Anthropic models via AI Gateway |
| `GOOGLE_AI_KEY` | Google AI models via AI Gateway |
| `SIGNING_SECRET` | HMAC-SHA256 signing of sandbox export payloads |
| `ALLOWED_ORIGINS` | Restrict CORS to specific origins (default: wildcard `*`) |
| `CF_ACCESS_AUD` + `CF_ACCESS_TEAM_DOMAIN` | Cloudflare Zero Trust JWT validation on mutation endpoints |
| `CLOUDFLARE_API_TOKEN` | `POST /api/v2/build/:id/deploy` — deploy generated apps to Cloudflare Pages |

The `ENVIRONMENT` variable is set to `"development"` automatically by `wrangler.toml` and does not need to be in `.dev.vars`.
