# Pre-Launch Audit — Project Whisper

**Audit date:** 2026-05-31  
**Auditor:** Senior Production Engineering Review  
**Status:** ALL PHASES COMPLETE — see `PRELAUNCH_REPORT.md` for final verdict

---

## Final Status

**Verdict: CONDITIONAL GO ✅**

All six audits are complete. The platform is launch-ready provided 11 pre-conditions are met (5 config changes, 2 documentation updates, 4 code fixes). See `PRELAUNCH_REPORT.md` for the complete synthesis, ranked recommendation list, and rationale.

**Audits completed:**

| Document | Scope | Key finding |
|----------|-------|-------------|
| `SECURITY_AUDIT.md` | Full codebase | 15 findings; 4 code fixes required before go-live |
| `CODE_QUALITY.md` | All 35 TS files | No blocking issues; rule violations in older code |
| `TESTING_ASSESSMENT.md` | Test coverage | 184 tests passing; 2 critical gaps identified |
| `PERFORMANCE_AUDIT.md` | Critical paths | No immediate blockers; rate limit race is the top fix |
| `PRODUCTION_READINESS.md` | Deployment config | 3 hard blockers (all config/docs, not code) |
| `UI_UX_REVIEW.md` | All pages | No blocking issues; alert() calls are top UX fix |

---

---

## 1. Project Summary

Project Whisper is a **single-tenant AI workbench** deployed on Cloudflare Workers. It provides:

- **Chat sandboxes** — ephemeral AI chat sessions with streaming, RAG, and tool execution
- **Vibe Builder / App Builder** — AI-generated static HTML applications with WebSocket collaboration
- **Chat Environments** — persistent multi-model compare workspaces with typed operating modes (coding, research, structured, creative, agent, debate)
- **Analysis tools** — Vault (semantic memory), Atlas (prompt library), Probes (scheduled eval), Assertions (pass/fail test suites), Replay engine (regression testing), Whisperer (13 research tools)
- **Pipeline engine** — directed-acyclic-graph prompt pipelines with 6 node types
- **Admin dashboard** — monitoring, audit log, pattern analysis, cost tracking

**Tech stack:**

| Layer | Technology |
|-------|-----------|
| Runtime | Cloudflare Workers (TypeScript, `workerd`) |
| Persistence | D1 (SQLite), KV (metadata/rate limits), R2 (objects), Vectorize (embeddings) |
| Stateful compute | Durable Objects — `SandboxDO`, `AppBuilderDO`, `AppStateDO` |
| AI | Cloudflare AI Gateway — 23+ provider registry |
| Auth | Cloudflare Access (Zero Trust) — optional RS256 JWT validation |
| Frontend | Server-rendered HTML + vanilla JS (no framework, no build step) |
| Dependencies | **Zero** runtime npm dependencies |

**Scale indicators:** ~3,500 lines of application code across 19 route/library files, 12 D1 migrations, 17 rate limit tiers.

---

## 2. High-Level Architecture

```
Internet → CF Access (optional Zero Trust JWT)
              ↓
         Cloudflare Workers (src/index.ts)
              ↓
    ┌─────────────────────────────────────┐
    │  isProtectedRequest()               │
    │  POST/PATCH/DELETE/PUT on /api/*    │
    │  Exclusions:                        │
    │    /s/*  (static)                   │
    │    /api/csp-report                  │
    │    /api/sandbox/:id/(run|stream)    │
    │    /api/app/:id/(images|email)  ←── │── PUBLIC (no auth)
    └─────────────────────────────────────┘
              ↓
         URLPattern Router
              ↓
    ┌──────── Route Handlers ─────────────┐
    │  AI:           ai.ts, whisperer.ts  │
    │  Sandboxes:    sandbox.ts           │
    │  Documents:    documents.ts         │
    │  Environments: environments.ts      │
    │  Vibes/Build:  vibes.ts, build.ts   │
    │  Storage:      vault.ts, atlas.ts   │
    │  Testing:      probes.ts, assert.ts │
    │  Replay:       replay.ts            │
    │  Pipelines:    pipelines.ts         │
    │  Monitor:      monitor.ts           │
    │  Pages:        pages.ts             │
    └─────────────────────────────────────┘
              ↓
    ┌──────── Cloudflare Services ─────────┐
    │  SANDBOX_REGISTRY  KV (metadata)     │
    │  RATE_LIMITS       KV (counters)     │
    │  DB                D1 (12 tables)    │
    │  BUCKET            R2 (objects)      │
    │  VECTORIZE_INDEX   Vectorize (RAG)   │
    │  SANDBOX           DO namespace      │
    │  APP_BUILDER       DO namespace      │
    │  APP_STATE         DO namespace      │
    │  AI                Workers AI        │
    │  AI_SEARCH         AI Search (⚠️)    │
    └──────────────────────────────────────┘
```

**Data flow for AI requests:** Client → Worker → `parseBody` → `checkRateLimit` → `parseGateway()` model validation → AI Gateway → provider → SSE stream back to client.

**Data flow for RAG:** Prompt → `embed()` → Vectorize nearest-neighbour → D1 chunk lookup → injected context → AI Gateway.

---

## 3. Risk Areas — Initial Inventory

### CRITICAL

**R-01 — CF Access is fully optional**  
`CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` are not set by default. If these env vars are absent, `isProtectedRequest()` still gates by HTTP method, but no identity is verified — any unauthenticated caller can invoke AI endpoints, exhaust Workers AI quota, and write to all storage layers. The application has no fallback auth (no API keys, no session cookies).  
*File:* `src/lib/access.ts`

**R-02 — Arbitrary JavaScript execution in SandboxDO**  
`executeCode()` in `SandboxDO` accepts user-supplied code strings and runs them via `new Function()` (which is `eval`-equivalent). This is sandboxed to the DO V8 isolate with a 5-second timeout, but it is still arbitrary code execution with access to DO storage. If the DO is compromised, an attacker can read all messages in that sandbox's storage.  
*File:* `src/durable/SandboxDO.ts`

**R-03 — wrangler.toml uses placeholder resource IDs**  
All KV namespace IDs, D1 database IDs, and Vectorize index IDs are `"00000000000000000000000000000000"` placeholders. If deployed without replacement, bindings resolve to nothing — the worker silently fails or routes to wrong resources.  
*File:* `wrangler.toml`

### HIGH

**R-04 — Webhook SSRF — private IP ranges not blocked**  
`parseWebhookUrl()` blocks exact hostnames (`localhost`, `127.0.0.1`, `0.0.0.0`, `::1`, `[::1]`) and suffixes (`.internal`, `.local`, `.localhost`), but does **not** block private IP ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (link-local), or IPv4-mapped IPv6 addresses. An attacker can supply a probe/webhook URL pointing to internal Cloudflare infrastructure or other tenant Workers.  
*File:* `src/lib/schema.ts` — `BLOCKED_WEBHOOK_HOSTNAMES`

**R-05 — Rate limit counters are fire-and-forget**  
`checkRateLimit()` calls `void RATE_LIMITS.put(key, ...)` — the KV write is not awaited. If the KV write fails (network error, KV overload), the counter is not incremented and the request passes through as if under the limit. Under high concurrency, race conditions can allow burst traffic well above the declared limits.  
*File:* `src/lib/http.ts` — `checkRateLimit`

**R-06 — Single SIGNING_SECRET covers three security domains**  
`SIGNING_SECRET` is used for: (1) sandbox config export HMAC, (2) system prompt sealing in DO storage, and (3) short-lived app tokens. Compromise of this secret grants the ability to forge all three. Rotation invalidates all exported configs and active app tokens simultaneously.  
*File:* `src/lib/utils.ts`, `src/durable/SandboxDO.ts`, `src/routes/environments.ts`

**R-07 — CORS defaults to wildcard**  
`getAllowedOrigins()` returns `['*']` when `ALLOWED_ORIGINS` is not configured. In production this means any web origin can call the API — including from attacker-controlled pages where a logged-in CF Access user visits.  
*File:* `src/lib/http.ts`

### MEDIUM

**R-08 — AI_SEARCH binding commented out**  
Vault semantic search (`POST /api/vault/search`) depends on the `AI_SEARCH` binding. It is commented out in `wrangler.toml`. Calls return 503 silently rather than a clear "feature not available" error. Users see a failure with no explanation.  
*File:* `wrangler.toml`

**R-09 — Email endpoint is publicly accessible (intentional but undocumented)**  
`POST /api/app/:id/email` is explicitly excluded from CF Access protection to allow generated apps to send email without auth tokens. This means anyone who knows an app ID can trigger email sends via that app. The app_token mechanism exists but its enforcement on this endpoint should be verified.  
*File:* `src/lib/access.ts`, `src/routes/appstate.ts`

**R-10 — Sandbox expiry gap: KV TTL vs DO storage**  
KV metadata for sandboxes has a 7-day TTL. After expiry, the entry disappears from `SANDBOX_REGISTRY` but the `SandboxDO` instance and its storage (messages, code, config) are not cleaned up. DO storage has no TTL mechanism. This creates orphaned data that is no longer reachable via the API but not deleted.  
*File:* `src/routes/sandbox.ts`, `wrangler.toml`

**R-11 — No input length limits on certain fields**  
Schema parsers enforce length limits on `prompt` and `systemPrompt`, but multi-message `messages[]` arrays have no limit on array length (only individual message content length). A request with 10,000 messages passes schema validation and reaches the AI provider.  
*File:* `src/lib/schema.ts`

**R-12 — Guard pipeline bypass via model selection**  
The guard node in the pipeline engine evaluates user content but the `model` field in the guard node config accepts any gateway-formatted model string. If the guard model is an attacker-supplied string that routes to a permissive provider, guard effectiveness is provider-dependent. Guard patterns (regex) run before the model call and cannot be bypassed this way, but the LLM-based guard decision can be.  
*File:* `src/routes/pipelines.ts`

### LOW / INFORMATIONAL

**R-13 — Eval in SandboxDO lacks resource-use limits beyond time**  
The 5-second timeout prevents infinite loops, but there are no memory limits on the `new Function()` execution. A tight loop allocating large arrays could cause memory pressure on the DO isolate before the timeout fires.

**R-14 — Atlas nearest/cluster call embed() — no rate limit on embed itself**  
`GET /api/atlas/nearest` and `/cluster` call `embed()` which makes a Workers AI call. These endpoints use the whisperer rate limit key but the limit is shared — a burst on these endpoints consumes whisperer budget.

**R-15 — OpenAPI spec accuracy**  
The spec at `GET /api/openapi.json` was recently updated but may still lag behind the actual routes. External integrations relying on the spec could encounter undocumented parameters or missing endpoints.

**R-16 — No structured logging for security events**  
Auth failures, rate limit hits, and guard flags write to `sandbox_events` D1 table, but there is no alerting, no log drain, and no aggregated security dashboard. Incidents may go unnoticed until database queries are run manually.

---

## 4. Audit Scope and Plan

### Phase 2 — Detailed Security Audit (proposed)

| Area | Key questions |
|------|--------------|
| **Auth hardening (R-01)** | What happens with no CF Access vars? Can we make auth non-optional? Fail-closed behavior? |
| **Webhook SSRF (R-04)** | Add private IP range blocking. Test IPv4-mapped IPv6, decimal-encoded IPs, DNS rebinding path. |
| **Rate limits (R-05)** | Await the KV write. Assess race window. Consider atomic KV increment pattern. |
| **CORS (R-07)** | Require explicit `ALLOWED_ORIGINS` in production. Document in SETUP.md. |
| **Email endpoint (R-09)** | Verify app_token enforcement. Document intended trust model. |
| **Input limits (R-11)** | Add `messages[]` array length cap in schema parser. |
| **Secret rotation (R-06)** | Document rotation procedure and blast radius. Consider domain-separated secrets. |

### Phase 3 — Dependency and Supply Chain Review

- Verify zero runtime npm dependencies (lockfile audit)
- Review `devDependencies` for any packages with known CVEs
- Verify `wrangler` version is current and no known vulnerabilities

### Phase 4 — Operational Readiness

- Replace all placeholder IDs in `wrangler.toml`
- Set `ALLOWED_ORIGINS` to explicit production domain
- Configure `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN`
- Set `SIGNING_SECRET` to a strong random value
- Enable `AI_SEARCH` binding or document its absence
- Review all `.dev.vars.example` secrets — confirm none are defaults
- Test KV/D1/R2 bindings against production resource IDs

### Phase 5 — Functional Regression

- Run full `npm test` suite (currently 184 tests, all passing)
- Manual smoke test: create sandbox → send message → stream response
- Manual smoke test: create environment → compare mode → 2 model columns
- Manual smoke test: create probe → run → check results in dashboard
- Verify `GET /api/openapi.json` returns complete and accurate spec

---

## 5. Deployment Checklist (Pre-Go-Live)

- [ ] Replace all `00000000...` placeholder IDs in `wrangler.toml`
- [ ] Set `ALLOWED_ORIGINS` to production domain (not `*`)
- [ ] Set `CF_ACCESS_AUD` + `CF_ACCESS_TEAM_DOMAIN` (auth is non-optional in prod)
- [ ] Set `SIGNING_SECRET` to cryptographically random 32+ byte value
- [ ] Confirm all 23 provider API keys in secrets (or remove unused providers from registry)
- [ ] Decide on `AI_SEARCH` — enable binding or disable the `/api/vault/search` route
- [ ] Apply all 12 D1 migrations to production database
- [ ] Create all 17 KV namespaces / confirm correct namespace IDs
- [ ] Create R2 bucket and confirm binding
- [ ] Create Vectorize index (768 dimensions, cosine metric) and confirm binding
- [ ] Confirm Analytics Engine binding if cost tracking is required
- [ ] Test CF Access JWT validation end-to-end with a real Access policy
- [ ] Add private IP range blocking to `parseWebhookUrl()` (R-04)
- [ ] Await rate limit KV writes (R-05)
- [ ] Add `messages[]` array length cap in schema (R-11)

---

*This document covers Phase 1 findings only. Detailed audit findings will be appended in subsequent phases.*
