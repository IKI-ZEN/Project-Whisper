# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- **Chat Environments** — a third entity type alongside sandboxes and apps: AI-configured specialised chat workspaces with per-type operating modes (`general`, `coding`, `research`, `structured`, `creative`, `agent`, `debate`). Full lifecycle routes at `/api/environments` (create, PATCH, fork, export, import); gallery page at `/environments`; compare-mode UI at `/env/:id` fans each message out to up to 4 models simultaneously. Environments reuse `SandboxDO` with `fromEnv: true` in KV metadata — same storage primitive, different view.
- **Environments gallery** (`GET /environments`) — server-rendered gallery page lists all `fromEnv: true` sandboxes with envType badges colour-coded by type; mirrors the `/apps` gallery pattern.
- `POST /api/environments` — create an environment via AI-generated config; generates system prompt tailored to `envType` via `generateEnvConfig()`
- `PATCH /api/environments/:id` — update `systemPrompt`, `temperature`, `maxTokens`, or `envModels`; validated by new `parsePatchEnvironmentRequest` in `src/lib/schema.ts`; propagates changes to SandboxDO and re-registers KV metadata
- `POST /api/environments/:id/fork` — clone an environment into a new independent copy (mirrors sandbox fork)
- `GET /api/environments/:id/export` — HMAC-signed config export (mirrors sandbox export)
- `POST /api/environments/import` — import a signed environment config as a new environment
- **`env_resolve` pipeline node type** — new node type in `executePipeline()` and `parsePipelineRequest()`; resolves an environment's config from its sandbox at execution time and exposes `{ systemPrompt, model, temperature, maxTokens }` as the node output; enables environment-aware pipeline DAGs
- **`batchSandboxIds` in Replay Engine** — `POST /api/replay` now accepts `batchSandboxIds: string[]` (max 5) symmetric with the existing `batchEnvIds`; resolves each sandbox config via `doFetch(stub, 'config', 'GET')` and runs the conversation against each in parallel; tools.html Replay pane updated with Batch Comparison section for both field types
- **`environment_id` on assertion suites** — `assertion_suites` table gains `environment_id` column (migration 0012); `POST /api/assertions` accepts `environmentId`; `GET /api/assertions?environmentId=...` filters by environment; suite shapes include `environment_id` in responses
- **`environment_id` on atlas prompt library** — `prompt_library` table gains `environment_id` column (migration 0012); `POST /api/atlas/library` accepts `environmentId`; `GET /api/atlas/library?environmentId=...` filters by environment; prompt shapes include `environment_id` in responses
- **`environment_id` filter on monitor endpoints** — `GET /api/monitor/stream` and `GET /api/monitor/audit` now accept `?environment_id=...` as an alternative to `?sandbox_id=...`; since environments ARE sandboxes the UUID is used directly in the `sandbox_id` column filter
- **OpenAPI spec completeness** — `GET /api/openapi.json` now covers all 5 environments routes, replay `batchEnvIds`/`batchSandboxIds` fields, vault `environment_id` filter, probes `environmentId` field, assertion suites `environmentId` field, atlas `environmentId` field, monitor `environment_id` filter; schema objects updated for `CreateEnvironmentRequest`, `PatchEnvironmentRequest`, `CreateAssertionSuiteRequest`, `ReplayRequest`
- D1 migration `0012_assertions_atlas_env.sql` — `environment_id TEXT` column + index on `assertion_suites`; `environment_id TEXT` column + index on `prompt_library`

### Changed

- **Vault Semantic Search** — `GET /api/vault/search?q=<query>` finds semantically similar vault records using the Cloudflare AI Search binding; results ranked by similarity; rate-limited 20 req / 60 s per IP
- **AI Gateway Extended Controls** — four new fields on all completion requests:
  - `byokAlias` — named BYOK credential from the Cloudflare Secrets Store (`cf-aig-byok-alias` header)
  - `zdr` — Zero Data Retention mode for Unified Billing accounts (`cf-aig-zdr: true`)
  - `collectLogPayload` — set `false` to suppress gateway request/response logging
  - `fallbackModel` — automatically retried once if the primary model throws (logs to Analytics Engine with `source: 'fallback'`)
- **23-provider AI Gateway registry** — model string prefix routing extended from 4 to 23 providers. New prefixes: `groq:`, `mistral:`, `deepseek:`, `xai:`, `perplexity:`, `cerebras:`, `openrouter:`, `cohere:`, `huggingface:`, `replicate:`, `parallel:`, `fal:`, `ideogram:`, `bedrock:`, `google-vertex-ai:`, `azure:`, `baseten:`; each with capability flags (tools, vision, streaming, json mode)
- **OpenAPI 3.1 spec** — `GET /api/openapi.json` returns a machine-readable spec for all routes, generated from the live route table; updated in this release to cover all environments routes, replay batch fields, assertion/atlas environment filters, and monitor environment filter
- **Text-to-speech** — `POST /api/ai/tts` accepts `{ text, voice?, model?, provider }` and returns binary audio; supports ElevenLabs (provider: `"elevenlabs"`) and Cartesia (provider: `"cartesia"`); requires `ELEVENLABS_API_KEY` or `CARTESIA_API_KEY`
- **Vision / multimodal** — `complete`, `stream`, and `compare` now accept `contentBlocks: ContentBlock[]` alongside `prompt`; images passed as `{ type: 'image', data: base64, mediaType }` are forwarded to providers that support vision (OpenAI, Anthropic, Google, Groq); max 5 images, 4 MB each
- **App tokens** — short-lived HMAC-SHA256-signed credentials (1-hour TTL) injected into generated app pages at serve time; used for authenticated `state`, `images`, and `email` calls from within the generated app without exposing `SIGNING_SECRET`
- **Analytics Engine cost tracking** — every AI inference call records cost, tokens in/out, provider, call type, and model to the `ANALYTICS` binding; visible in Cloudflare Analytics dashboard; `GET /api/usage` aggregates from `usage_metrics` in D1 with provider/model/date filters
- **Prompt caching** — Anthropic `cache_control: ephemeral` markers applied automatically to eligible long system prompts (≥ 1024 tokens); reduces cost on repeated prompts
- **Whisperer: Rubric Evaluator** — `POST /api/ai/evaluate` scores a model response against a set of named rubric criteria; returns per-criterion pass/fail and aggregate score
- **Whisperer: Context Stress Test** — `POST /api/ai/context-stress` runs the same prompt at increasing context sizes to find degradation points; returns per-level similarity to baseline
- **Whisperer: Multi-Turn Drift** — `POST /api/ai/drift` runs a conversation up to N turns, measuring semantic drift from the opening response at each step
- **Whisperer: Prompt Ablation** — `POST /api/ai/ablation` removes clauses from a prompt one at a time and measures the impact on response similarity; isolates which clauses matter most
- **Whisperer: Consistency** — `POST /api/ai/consistency` runs the same prompt across logically equivalent rephrased variants and measures consistency; surfaces factual drift across phrasings
- **Whisperer: Guard Laboratory** — `POST /api/ai/guard-probe` runs the guard scanner over arbitrary text and returns the full scan result (matched patterns, severity, raw categories); for guard rule tuning without making live sandboxes
- **Saved Pipelines** — persist named DAG pipeline definitions to D1; full CRUD at `/api/pipelines`; execute via `POST /api/pipelines/:id/run` with `{ input }` → `{ output, trace }`
- `POST /api/sandbox/:id/fork` — clone a sandbox config into a new independent sandbox (name appended with " (copy)", empty memory, fresh timestamps)
- Prompt auto-versioning — patching `systemPrompt` on a sandbox automatically saves the previous value to the vault, tagged `system-prompt-version`, providing free version history
- `POST /api/vault/analyze` — cluster vault records by prompt embedding similarity using k-means; returns cluster representatives, size, tools breakdown, and sample IDs; rate-limited 3 req / 5 min per IP
- Pipeline probe tool — probes now accept `tool: 'pipeline'` (fifth tool type alongside `entropy`, `sweep`, `sensitivity`, `cot`) with `params.pipelineId` to schedule saved pipeline DAGs as cron health checks
- Probe webhook alerts — probes now accept an optional `webhookUrl` (HTTPS, max 512 chars); a fire-and-forget POST is sent to the URL when a metric threshold is breached, with payload `{ probeId, probeName, metricValue, metrics, breachedAt }`

### Changed

- **Second Unified Architecture Refactor** — six coordinated improvements applied after the May 2026 audit:
  1. **Rate limits on whisperer** — `checkRateLimit(`rl:whisperer:{ip}`, 15 req/60 s)` added to all 13 whisperer handlers (`sensitivity`, `cluster`, `cot`, `entropy`, `archaeology`, `pipeline`, `think`, `evaluate`, `contextStress`, `drift`, `ablation`, `consistency`, `guardLab`)
  2. **Rate limits on atlas writes** — `rl:atlas-write:{ip}` (20 req/60 s) on `addPrompt` and `deletePrompt`; `rl:whisperer:{ip}` on `embedAtlas` and `nearestPrompts`
  3. **Rate limits on vibes, build, monitor, documents** — `rl:vibe-create:{ip}` (5 req/60 s) on `createVibe`; `rl:build-create:{ip}` (5 req/60 s) on `create`; `rl:monitor:{ip}` (30 req/60 s) on `stream` and `audit`; `rl:doc-upload:{ip}` (20 req/60 s) on document `upload`
  4. **`parsePatchEnvironmentRequest` in `schema.ts`** — `patchEnvironment` handler in `environments.ts` migrated from `readJson` + manual casting to `parseBody(req, parsePatchEnvironmentRequest)`; validates `temperature` range, `maxTokens` range, and `envModels` array constraints
  5. **`environment_id` cross-propagation** — consistently present on create, list, and shape-response across assertions, atlas, monitor (previously absent from all three)
  6. **Rate limit constants block** — six new constant pairs added to `src/lib/constants.ts`: `WHISPERER_RATE_LIMIT_*`, `ATLAS_WRITE_RATE_LIMIT_*`, `VIBE_CREATE_RATE_LIMIT_*`, `BUILD_CREATE_RATE_LIMIT_*`, `MONITOR_RATE_LIMIT_*`, `DOCUMENT_UPLOAD_RATE_LIMIT_*`
- **Unified Architecture Refactor** (first, prior release) — seven coordinated improvements applied uniformly across all route files:
  1. `bool(v, field, fallback)` helper added to `src/lib/schema.ts`; replaces all inline `=== true` boolean coercions in parsers (`zdr`, `groundingEnabled`, `collectLogPayload`, `ragEnabled`, `autoVault`)
  2. `parseQueryInt(params, key, fallback, min, max)` added to `src/lib/http.ts`; replaces all inline `parseInt`/`isNaN`/`Math.min/max` patterns in vault, monitor, atlas, and pipelines handlers
  3. `LIST_LIMIT_DEFAULT/MAX`, `MONITOR_LIMIT_DEFAULT/MAX`, and rate-limit constants added to `src/lib/constants.ts`; inline literals eliminated
  4. UUID validation (`isUUID()`) propagated to all handlers that access KV, D1, R2, or DO stubs by sandbox/doc/prompt id — `sandbox.ts` (10 handlers), `assertions.ts` (5 handlers), `atlas.ts` (2 handlers), `replay.ts` (1 handler), `documents.ts` (docId)
  5. `checkRateLimit` added to `sandbox.ts` create/import/fork, `pipelines.ts` run, and `replay.ts` post — DO-provisioning and multi-step AI operations now rate-limited per IP
  6. Whisperer envelope propagation — `cluster`, `archaeology`, and `pipeline` tools switched to `parseWithEnvelope()`; all 13 whisperer tools now support `sandboxId` (inherit model context from a sandbox) and `autoVault` (auto-save results to vault)
  7. `now()` from `src/lib/utils.ts` propagated to all route files that used `Date.now()` directly (`ai.ts`, `appstate.ts`, `assertions.ts`, `monitor.ts`, `pipelines.ts`, `probes.ts`, `replay.ts`, `security.ts`, `vault.ts`, `whisperer.ts`)
- D1 migration 0008 (`0008_sandbox_analysis.sql`) — `sandbox_id` column added to `probes` and `assertion_suites` for per-sandbox filtering; `metrics_json` column added to `probe_runs` for rich structured metrics; `sandbox_id` column added to `vault_records`
- D1 migration 0009 (`0009_usage_cost.sql`) — `provider`, `call_type`, and `cost_usd` columns added to `usage_metrics` for cost attribution per model and call type
- D1 migration 0010 (`0010_pipelines_webhooks.sql`) — creates the `pipelines` table; adds `webhook_url` column to `probes`

## [0.2.1] — 2026-05-28

### Fixed

- `GET /api/health` endpoint added for uptime monitoring
- `crypto.randomUUID()` replaced with `newId()` from `src/lib/utils.ts` across all route files (`assertions.ts`, `probes.ts`, `atlas.ts`, `vault.ts`, `replay.ts`, `sandbox.ts`) — enforces the single ID-generation source rule
- `req.json()` in `documents.ts` and `sandbox.ts` replaced with `parseBodyOptional` for optional-body routes; `parseBodyOptional` added to `src/lib/http.ts`
- UUID validation added to all four handlers in `documents.ts` before R2/KV access
- Inline numeric literals in `documents.ts` (`8192`, `500`, `5`, `60_000`) replaced with named constants in `src/lib/constants.ts`
- Custom `doBuild()` helper in `build.ts` replaced with the shared `doFetch()` from `src/routes/sandbox.ts`
- `SETUP.md`: open-AI-proxy warning added; Vectorize `--dimensions` documents its embedding model dependency; Node.js requirement corrected to 20+
- `README.md`: 0.2.0 Whisperer Suite features documented; all new API routes added; full 7-migration setup sequence; CF Access warning

## [0.2.0] — 2026-05-28

### Added

- Threat Monitor — live SSE stream of guard flag events from `sandbox_events` with pattern frequency analytics (`GET /api/monitor/stream`, `/audit`, `/patterns`)
- Evidence Vault — prompt/response dataset builder with tags, filters, and streaming JSONL export in OpenAI fine-tuning format (`/api/vault`)
- Replay Engine — replay a conversation session against a different model or system prompt with per-turn cosine similarity scoring (`POST /api/replay`)
- Model Assertions — behaviour contract testing with 7 assertion types (`contains`, `not-contains`, `matches`, `similarity-gte`, `judge`, `latency-lte`, `guard-clean`) and pass/fail history (`/api/assertions`)
- Semantic Map (Atlas) — prompt library with embedding, k-means clustering, PCA-2D scatter plot, and nearest-prompt search (`/api/atlas`)
- Cron Whisper (Probes) — scheduled whisperer tool runs (entropy, sensitivity, CoT, sweep) on hourly/daily/weekly cron triggers with time-series results (`/api/probes`)
- D1 migrations 0004–0007 for probes, vault, assertion suites/runs, and prompt library tables

### Fixed

- `POST /api/app/:id/email` now returns 503 when `EMAIL_FROM_ADDRESS` is not configured instead of silently attempting an unverified address
- `GET /api/assertions/:id/history` and `GET /api/assertions` guard `.results` with `?? []` to prevent TypeError on empty tables
- Atlas embedding cache writes batched via `env.DB.batch()` instead of individual sequential UPDATEs

## [0.1.0] — 2026-05-26

### Added

- Core AI harness: Workers AI + Cloudflare AI Gateway routing for OpenAI, Anthropic, and Google models
- Persistent sandboxes (SandboxDO) with conversation memory, tool use, and configurable system prompt
- Multi-session memory (`?sessionId=` parameter on all inference endpoints)
- Vibe Builder: AI-generated sandbox from a plain-English description
- App Builder (AppBuilderDO): multi-file web app generation streamed in real time via WebSocket
- AppStateDO: persistent key-value store for generated apps (`/api/app/:id/state/*`)
- R2-backed image storage for generated apps (`/api/app/:id/images/*`)
- Email sending via Cloudflare Email Routing (`/api/app/:id/email`)
- Cloudflare Pages Direct Upload deploy (`POST /api/v2/build/:id/deploy`)
- SVG metadata thumbnails auto-generated at build completion
- RAG document pipeline (upload → Queues → chunk → Vectorize) with CSV and PDF extraction
- Zero-dep markdown renderer (`src/lib/markdown.ts`) inlined in SDK and app pages
- SVG chart library (`public/chart.js`): bar, line, and pie chart types — zero dependencies
- AI analysis suite (Whisperer): compare, sweep, sensitivity, cluster, chain-of-thought probing, entropy, archaeology, pipeline, and extended thinking endpoints
- Inbound prompt injection guard with Unicode normalisation, base64 decode-and-rescan, and per-sandbox guard mode
- Integrity hashing: SHA-256 config fingerprint with tamper detection on every sandbox fetch
- HMAC-signed config export/import
- Cloudflare Access Zero Trust integration for mutation endpoints
- Per-request nonce CSP headers with violation reporting to D1
- Three-layer rate limiting: per-IP on AI routes, per-sandbox on run/stream, per-app on email sends
- `GET /api/v2/build` build list endpoint with KV-backed metadata index
- Whisper browser SDK (`public/vibe-sdk.js`): `WhisperClient`, `AppBuilder`, `AppHandle`, `AppStateHandle`, `SandboxConnection`, and `<whisper-chat>` web component
- GitHub Actions type-check workflow (`.github/workflows/typecheck.yml`)
