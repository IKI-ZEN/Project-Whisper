# Cloudflare AI Gateway — Reference

> **Last updated:** 2026-05-28 (Phase 10 — gateway architecture unification)

---

## Table of Contents

1. [Overview](#1-overview)
2. [URL Structure](#2-url-structure)
3. [Authentication](#3-authentication)
4. [Unified Chat Completions API](#4-unified-chat-completions-api)
5. [Features](#5-features)
   - 5.1 [Caching](#51-caching)
   - 5.2 [Rate Limiting](#52-rate-limiting)
   - 5.3 [Logging](#53-logging)
   - 5.4 [Analytics](#54-analytics)
   - 5.5 [Dynamic Routing](#55-dynamic-routing)
   - 5.6 [Unified Billing](#56-unified-billing)
   - 5.7 [Zero Data Retention (ZDR)](#57-zero-data-retention-zdr)
6. [Per-Request Headers Reference](#6-per-request-headers-reference)
7. [Provider Reference](#7-provider-reference)
   - 7A. [Core Providers (13)](#7a-implemented-providers-23-total)
   - 7B. [Extended Providers (10)](#7b-extended-providers-10-additional)
8. [Workers AI Models](#8-workers-ai-models)
   - 8A. [Hosted Models](#8a-hosted-models-env-ai-binding--cf-prefix)
   - 8B. [Proxied Models](#8b-proxied-models-via-gateway--not-workers-ai-binding)
9. [Project Implementation Notes](#9-project-implementation-notes)

---

## 1. Overview

Cloudflare AI Gateway is a proxy layer that sits between your application and AI provider APIs. It adds:

- **Observability** — per-request logs with prompt, response, tokens, cost, latency, and status
- **Caching** — cache identical requests to reduce cost and latency
- **Rate limiting** — enforce request quotas per gateway with fixed or sliding windows
- **Analytics** — aggregated metrics across models and providers via dashboard or GraphQL
- **Dynamic routing** — named, versioned flows with conditionals, A/B splits, fallbacks, and budget limits

AI Gateway supports **25+ providers** including OpenAI, Anthropic, Google, AWS Bedrock, Azure OpenAI, Mistral, Groq, xAI, Perplexity, DeepSeek, Cohere, HuggingFace, Replicate, ElevenLabs, Deepgram, Cartesia, Fal AI, Ideogram, Baseten, Cerebras, OpenRouter, and more.

All providers are accessed through a single Cloudflare-hosted endpoint, using provider-native or OpenAI-compatible request formats.

---

## 2. URL Structure

There are three endpoint patterns depending on how you want to access AI Gateway.

### Provider-native endpoint

Route to a specific provider using their native API format:

```
https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/{provider}/...
```

The `{provider}` segment and everything after it mirrors the provider's own URL path. For example, a request that would normally go to `https://api.openai.com/v1/chat/completions` becomes:

```
https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai/chat/completions
```

### Unified compatibility endpoint

An OpenAI-compatible endpoint that routes to any supported provider using a `{provider}/{model-id}` model string:

```
https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/compat/chat/completions
```

### REST API endpoint

Access any model — Workers AI or third-party — through the Cloudflare REST API, authenticated with a Cloudflare API token (no provider SDK or provider key needed when using Unified Billing). Three endpoints are available:

| Endpoint | Purpose |
|----------|---------|
| `/ai/v1/chat/completions` | OpenAI-compatible chat completions for all providers |
| `/ai/v1/responses` | Agentic workflows (built-in tools, multi-turn server-side state) |
| `/ai/run` | All modalities (text, image, audio, embedding) |

```
https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions
```

Model field format: `{provider}/{model-id}` — e.g. `openai/gpt-4o`, `anthropic/claude-sonnet-4-6`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.

To route through a specific gateway, supply the `cf-aig-gateway-id` header. Without it, AI Gateway uses a `default` gateway and **automatically creates it** on the first authenticated request (third-party providers only — Workers AI requests always require the header).

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/v1/chat/completions" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --header "cf-aig-gateway-id: my-gateway" \
  --header "Content-Type: application/json" \
  --data '{"model": "openai/gpt-4o", "messages": [{"role": "user", "content": "Hello"}]}'
```

---

## 3. Authentication

### Per-request provider key

The default approach: pass the provider's own API key in the provider-native authentication header on every request. The gateway forwards the header directly to the provider.

```http
Authorization: Bearer sk-...        # OpenAI, Groq, Mistral, etc.
x-api-key: sk-ant-...               # Anthropic
x-goog-api-key: AIza...             # Google AI Studio
api-key: ...                        # Azure OpenAI
```

### Bring Your Own Key (BYOK)

Store provider credentials in the Cloudflare dashboard (**Provider Keys** section) backed by Cloudflare Secrets Store, then reference them without sending the raw key on every request. Once configured, send only:

```http
cf-aig-authorization: Bearer {CF_AIG_TOKEN}
```

The gateway resolves the stored credential and injects it before forwarding to the provider. BYOK is required for providers that need complex credential formats (e.g. AWS SigV4, GCP service account JSON, Bedrock via the compat endpoint).

#### Key aliases

Multiple keys can be stored per provider. Each key has an **alias** (defaults to `default`). To select a non-default key, pass:

```http
cf-aig-byok-alias: production
```

If the header is absent, the key with alias `default` is used.

### Unified Billing

Authenticate and pay through your Cloudflare account — no provider API key required. Cloudflare bills a single invoice for all provider usage. A 5% fee applies to credits purchased; provider per-token rates are passed through at cost.

Send a Cloudflare API token in the `Authorization` header; omit all provider auth headers:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/v1/chat/completions" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"model": "openai/gpt-4o", "messages": [{"role": "user", "content": "Hello"}]}'
```

See [Section 5.6](#56-unified-billing) for the full feature description.

### Authenticated gateway

Adds gateway-level authentication independent of how the provider key is supplied. Any request missing a valid `cf-aig-authorization` header is rejected before reaching the provider. This prevents unauthorized access to your gateway and is **required when storing logs** to prevent third parties from writing log entries.

```http
cf-aig-authorization: Bearer {CF_AIG_TOKEN}
```

This header serves double duty: it authenticates the caller to the gateway **and** carries the BYOK token when that feature is enabled.

---

## 4. Unified Chat Completions API

The unified compat endpoint accepts OpenAI-formatted chat completions requests and routes them to any supported provider. Use this when you want a single integration point that can switch providers without changing your request format.

**Endpoint:**

```
POST https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/compat/chat/completions
```

**Model field format:** `{provider}/{model-id}`

The `model` field in the request body determines which provider and model receives the request:

| Provider | Example model string |
|----------|----------------------|
| AWS Bedrock (Anthropic Claude) | `aws-bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0` |
| AWS Bedrock (Amazon Nova) | `aws-bedrock/us.amazon.nova-lite-v1:0` |
| Anthropic (direct) | `anthropic/claude-sonnet-4-6` |
| Google Vertex AI | `google-vertex-ai/google/gemini-2.5-pro` |
| Parallel | `parallel/speed` |

**Currently supported via compat endpoint:**

- Anthropic Claude (direct)
- Amazon Nova via Amazon Bedrock
- Anthropic Claude via Amazon Bedrock
- Google Vertex AI (Gemini models)
- Baseten
- Parallel

**Authentication for compat endpoint:**

Requests to the compat endpoint for providers that require BYOK (e.g. Bedrock, Vertex AI) must supply:

```http
cf-aig-authorization: Bearer {CF_AIG_TOKEN}
```

No provider-specific auth header is sent; the gateway resolves the stored credential.

**Example request (Bedrock via compat):**

```http
POST https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/compat/chat/completions
Content-Type: application/json
cf-aig-authorization: Bearer {CF_AIG_TOKEN}

{
  "model": "aws-bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ]
}
```

---

## 5. Features

### 5.1 Caching

AI Gateway can cache responses to identical requests, reducing cost and latency for repeated queries.

**Scope:** Text and image responses only. Audio and streaming-only responses are not cached.

**Cache key:** SHA-256 of the concatenation of:
- Provider
- Endpoint path
- Model
- Auth header value
- Full request body (verbatim)

Any difference in the request body — including whitespace, field order, or temperature — produces a different cache key and a new cache entry.

**Response header:** `cf-aig-cache-status: HIT | MISS`

**Volatile cache note:** When multiple identical requests arrive simultaneously before any cached response exists, all of them may reach the provider (i.e. both miss). The cache is written after the first response completes.

#### Configuring cache defaults

- **Dashboard:** Settings → Cache Responses → set default TTL
- **API:** `cache_ttl` field on gateway create/update

#### Per-request overrides

| Header | Behaviour |
|--------|-----------|
| `cf-aig-cache-ttl: {seconds}` | Sets cache duration for this request. Minimum 60 s, maximum ~2,592,000 s (≈ 1 month). |
| `cf-aig-skip-cache: true` | Bypasses the cache entirely for this request; always hits the provider. |
| `cf-aig-cache-key: {string}` | Custom cache key string. The first request always hits the provider; subsequent requests with the same key are served from cache. Falls back to the dashboard TTL, or 5 minutes if caching is disabled. |

> **Old header names** (still accepted): `cf-cache-ttl` → `cf-aig-cache-ttl`, `cf-skip-cache` → `cf-aig-skip-cache`

---

### 5.2 Rate Limiting

Rate limiting enforces a maximum number of requests per time window at the gateway level, before any provider request is made.

**Window types:**

- **Fixed window** — the counter resets at clock boundaries (e.g. 12:00–12:10, then 12:10–12:20). A burst of requests right before the boundary depletes the quota; a burst right after starts fresh.
- **Sliding window** — a rolling last-N-minutes check that is stricter: the quota applies to any rolling window ending at the current instant.

**Exceeded response:** `429 Too Many Requests`. The request is not forwarded to the provider and is not logged as a provider call.

**Configuration:**

- **Dashboard:** Settings → Rate-limiting
- **API fields:** `rate_limiting_interval`, `rate_limiting_limit`, `rate_limiting_technique`

---

### 5.3 Logging

AI Gateway logs every request by default.

**Default log fields:**

- Prompt (request body)
- Response (response body)
- Provider
- Timestamp
- HTTP status
- Token usage (input / output / total)
- Estimated cost (USD)
- Duration (ms)

**DLP fields** (when Data Loss Prevention policies are configured):

| Field | Values |
|-------|--------|
| DLP Action | `FLAG` or `BLOCK` |
| Policies Matched | Policy names |
| Profiles Matched | Profile names |
| Entries Matched | Matched entry values |
| Check | `REQUEST` or `RESPONSE` |

**Storage limits:** Each plan has a per-gateway log storage limit. When the limit is reached, new logs stop being written (oldest entries are **not** automatically evicted unless auto-deletion is configured).

**Changing the default:** Dashboard → Settings → Logs

#### Per-request log control

| Header | Behaviour |
|--------|-----------|
| `cf-aig-collect-log: false` | Exclude this request's log even if gateway logging is enabled. Use `true` to include a request when gateway logging is disabled. |
| `cf-aig-collect-log-payload: false` | Skip storing the request and response bodies in the log, but still write the metadata record (tokens, cost, status, etc.). Has no effect if `cf-aig-collect-log: false`. |

#### Log deletion

- **Automatic:** Triggered when storage limit is hit (oldest first, if configured).
- **Manual:** Dashboard log viewer with filters (date range, provider, status, etc.).
- **API:** `DELETE` endpoint on the gateway logs resource.

---

### 5.4 Analytics

**Dashboard metrics** (per gateway, filterable by provider, model, time range):

- Request count
- Token usage (input / output / total)
- Estimated cost (USD)
- Error count and rate
- Cached response count and rate

**GraphQL API:**

```
POST https://api.cloudflare.com/client/v4/graphql
```

**Dataset:** `aiGatewayRequestsAdaptiveGroups`

**Dimensions:**

| Dimension | Description |
|-----------|-------------|
| `model` | Model identifier |
| `provider` | Provider slug |
| `gateway` | Gateway ID |
| `datetimeMinute` | Minute-level timestamp |

**Filtering:**

| Filter key | Type | Description |
|------------|------|-------------|
| `datetimeHour_geq` | ISO 8601 string | Start of time range (inclusive) |
| `datetimeHour_leq` | ISO 8601 string | End of time range (inclusive) |

**Example GraphQL query:**

```graphql
query {
  viewer {
    accounts(filter: { accountTag: "{account_id}" }) {
      aiGatewayRequestsAdaptiveGroups(
        filter: {
          datetimeHour_geq: "2025-01-01T00:00:00Z"
          datetimeHour_leq: "2025-01-31T23:59:59Z"
        }
        limit: 1000
      ) {
        dimensions {
          model
          provider
          gateway
          datetimeMinute
        }
        sum {
          requests
          tokensTotalIn
          tokensTotalOut
          costTotal
          cacheHits
          errors
        }
      }
    }
  }
}
```

---

### 5.5 Dynamic Routing

Dynamic routing lets you define named, versioned request flows that can conditionally route to different providers, split traffic for A/B testing, enforce rate limits or spend budgets with automatic fallback, and attach arbitrary metadata for observability.

**Accessing a dynamic route:** Set the model field to `dynamic/{route-name}` when calling the compat endpoint.

#### Prerequisites

- Authenticated gateway (gateway-level `cf-aig-authorization` required)
- Provider keys stored as BYOK in the dashboard (the gateway handles credential injection)

#### Node types

| Node | Description |
|------|-------------|
| **Start** | Entry point of every flow |
| **Conditional** | If/else branch based on request body fields, headers, or metadata values |
| **Percentage** | Splits traffic by percentage for A/B or canary deployments |
| **Model** | Calls a specific provider/model combination |
| **Rate Limit** | Enforces a request quota; routes to a fallback node when exceeded |
| **Budget Limit** | Enforces a cost quota (USD); routes to a fallback node when exceeded |
| **End** | Terminates the flow |

#### Metadata

Attach arbitrary key-value pairs to any request for use in Conditional nodes or for enriching logs:

```http
cf-aig-metadata: {"userId": "u_123", "orgId": "org_456", "plan": "pro"}
```

Values can be any JSON-serialisable type. Keys are arbitrary strings. Metadata is visible in logs and can be used as conditional routing criteria (e.g. route `plan = "free"` to a cheaper model).

#### Versioning

- **Save** → creates a draft version
- **Deploy** → makes a version live instantly
- Instant rollback to any previously deployed version from the dashboard
- Versions are immutable once deployed; always deploy a new version to make changes

---

### 5.6 Unified Billing

Unified Billing lets you call any supported provider through AI Gateway billed to your Cloudflare account — no provider API key or BYOK configuration needed. Cloudflare handles credential management and issues a single invoice.

**Pricing:** A 5% fee is applied to credits purchased through Unified Billing (e.g. $100 credit → $105 charge). Provider per-token rates are passed through at cost with no markup.

**Workers AI note:** `@cf/` models routed through AI Gateway are billed under [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), not Unified Billing credits.

#### Setup

1. Load credits via the **AI Gateway** dashboard → **Credits Available** → **Manage** → **Top-up credits**.
2. Optionally configure **auto top-up** to replenish credits when the balance falls below a threshold.
3. Ensure the gateway is [authenticated](#authenticated-gateway).

#### Usage — AI binding

```typescript
const resp = await env.AI.run(
  'openai/gpt-4o',
  { messages: [{ role: 'user', content: 'Hello' }] },
  { gateway: { id: 'my-gateway' } },
)
```

#### Usage — REST API

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/v1/chat/completions" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"model": "openai/gpt-4o", "messages": [{"role": "user", "content": "Hello"}]}'
```

No provider auth header is needed — Cloudflare injects credentials at the edge.

#### Spend limits

Set daily, weekly, or monthly spend limits in the dashboard. When a limit is reached, the gateway stops processing Unified Billing requests until the period resets or the limit is raised.

#### Supported providers (Unified Billing HTTP)

OpenAI, Anthropic, Google AI Studio, Google Vertex AI, xAI, Groq.

---

### 5.7 Zero Data Retention (ZDR)

Zero Data Retention routes Unified Billing traffic through provider endpoints that **do not retain prompts or responses** on the provider's infrastructure. Applies only to Unified Billing requests that use Cloudflare-managed credentials (not BYOK or per-request keys).

**ZDR does not affect AI Gateway logging** — to suppress gateway logs, configure the logging setting separately (see [5.3 Logging](#53-logging)).

**Supported providers:** OpenAI, Anthropic. Requests to unsupported providers fall back to standard Unified Billing.

#### Enable gateway-wide

Dashboard → **AI Gateway** → select gateway → **Settings** → toggle **Zero Data Retention (ZDR)**.

Via API: include `zdr: true` in the gateway PUT request body.

#### Per-request override

```http
cf-aig-zdr: true
```

Set to `true` to force ZDR or `false` to opt out for a specific request, regardless of the gateway default.

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/v1/chat/completions" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --header "cf-aig-zdr: true" \
  --header "Content-Type: application/json" \
  --data '{"model": "openai/gpt-4o", "messages": [{"role": "user", "content": "Hello"}]}'
```

---

## 6. Per-Request Headers Reference

All `cf-aig-*` headers are sent by the **caller** on the way into the gateway (Request direction) unless noted as Response.

| Header | Direction | Values / Notes |
|--------|-----------|----------------|
| `cf-aig-authorization` | Request | `Bearer {token}` — authenticates the caller to the gateway and/or passes the BYOK token. Required for authenticated gateways. |
| `cf-aig-byok-alias` | Request | Selects a specific stored provider key by alias. Defaults to the key with alias `default`. See [BYOK key aliases](#key-aliases). |
| `cf-aig-cache-ttl` | Request | Seconds (60–2,592,000). Overrides the gateway default TTL for this request. |
| `cf-aig-skip-cache` | Request | `true` / `false`. Set `true` to bypass the cache and always reach the provider. |
| `cf-aig-cache-key` | Request | Any string. Overrides the default SHA-256 cache key. First request always hits provider; subsequent requests with same key are cached. Falls back to dashboard TTL or 5 min default. |
| `cf-aig-collect-log` | Request | `true` / `false`. Overrides the gateway-level log collection setting for this request. |
| `cf-aig-collect-log-payload` | Request | `true` / `false`. When `false`, omits the request/response bodies from the log record but preserves the metadata entry. No effect if `cf-aig-collect-log: false`. |
| `cf-aig-metadata` | Request | JSON string of arbitrary key-value pairs. Used for observability enrichment and as input to Conditional routing nodes. |
| `cf-aig-zdr` | Request | `true` / `false`. Per-request Zero Data Retention override for Unified Billing requests. Overrides the gateway-level ZDR setting. |
| `cf-aig-cache-status` | Response | `HIT` — served from cache. `MISS` — forwarded to provider. |
| `cf-aig-gateway-id` | Request | Specifies which AI Gateway to route the request through. Required for Workers AI binding calls; optional for REST API (defaults to `default` gateway). |

### Renamed headers (old names still accepted)

| Old name | New name |
|----------|----------|
| `cf-cache-ttl` | `cf-aig-cache-ttl` |
| `cf-skip-cache` | `cf-aig-skip-cache` |

---

## 7. Provider Reference

Each entry lists: gateway path segment, authentication header(s), wire format, model string format used by this project, required environment variable, and notable details.

---

### 7A. Implemented Providers (23 total)
<!-- 13 core providers in this section + 10 extended providers in 7B = 23 total -->

---

#### OpenAI

| Field | Value |
|-------|-------|
| Gateway path | `/openai/chat/completions` |
| Auth header | `Authorization: Bearer {OPENAI_API_KEY}` |
| Wire format | OpenAI |
| Project model string | `openai:{model}` e.g. `openai:gpt-4o` |
| Env var | `OPENAI_API_KEY` |

**Notes:**
- Also supports `/openai/responses` (Responses API for GPT-5+ series and the o-series reasoning models).
- The Responses API exposes additional features: built-in tools (web search, code interpreter, file search), multi-turn conversation state managed server-side, and streaming events.

**Available models:**

| Model ID | Notes |
|----------|-------|
| `gpt-4o` | Flagship multimodal |
| `gpt-4o-mini` | Cost-optimised |
| `gpt-4.1` | Latest GPT-4.1 generation |
| `gpt-4.1-mini` | Fast/cheap GPT-4.1 |
| `gpt-5` | GPT-5 |
| `gpt-5.4` | GPT-5.4 |
| `gpt-5.4-mini` | GPT-5.4 cost-optimised |
| `gpt-5.4-nano` | GPT-5.4 nano |
| `gpt-5.5` | GPT-5.5 |
| `o4-mini` | Reasoning model |

---

#### Anthropic

| Field | Value |
|-------|-------|
| Gateway path | `/anthropic/v1/messages` |
| Auth headers | `x-api-key: {ANTHROPIC_API_KEY}` + `anthropic-version: 2023-06-01` |
| Wire format | Anthropic Messages API |
| Project model string | `anthropic:{model}` e.g. `anthropic:claude-sonnet-4-6` |
| Env var | `ANTHROPIC_API_KEY` |

**Notes:**
- **Prompt caching:** Add `anthropic-beta: prompt-caching-2024-07-31` to the request headers and set `cache_control: { type: 'ephemeral' }` on the system message block. This project enables prompt caching automatically whenever `systemPrompt` is non-empty — the `cache_control` block is always added to the system content array.
- Prompt caching reduces input token costs for repeated system prompts (the cached prefix is charged at a lower rate on subsequent requests within the cache TTL). Anthropic only activates caching for prefixes ≥ 1,024 tokens (~800 words); shorter prompts simply incur no caching overhead.

**Available models:**

| Model ID | Notes |
|----------|-------|
| `claude-sonnet-4-6` | Latest Sonnet |
| `claude-opus-4-7` | Latest Opus |
| `claude-opus-4-8` | Latest Opus (newer) |
| `claude-haiku-4-5` | Latest Haiku |
| `claude-sonnet-4` | Sonnet 4 |
| `claude-sonnet-4.5` | Sonnet 4.5 |

---

#### Google AI Studio

| Field | Value |
|-------|-------|
| Gateway path | `/google-ai-studio/v1/models/{model}:generateContent` |
| Auth header | `x-goog-api-key: {GOOGLE_AI_KEY}` |
| Wire format | Gemini API (`contents` / `parts`) |
| Project model string | `google:{model}` e.g. `google:gemini-2.0-flash` |
| Env var | `GOOGLE_AI_KEY` |

**Notes:**
- Streaming endpoint: `/google-ai-studio/v1/models/{model}:streamGenerateContent?alt=sse` — the API key is sent in the `x-goog-api-key` header (not the `?key=` query parameter).
- Grounding (real-time web search): add `tools: [{ googleSearch: {} }]` to the request body.
- The `key` query parameter is accepted by Google but the header form is preferred and is what this project sends.

**Available models:**

| Model ID | Notes |
|----------|-------|
| `gemini-2.0-flash` | Fast, multimodal |
| `gemini-2.5-flash` | Fast, enhanced |
| `gemini-2.5-pro` | High-capability |
| `gemini-3-flash` | Next-gen fast |
| `gemini-3.1-flash-lite` | Lightweight |
| `gemini-3.1-pro` | Next-gen pro |
| `gemini-1.5-pro` | Long context (deprecated path) |

---

#### Groq

| Field | Value |
|-------|-------|
| Gateway path | `/groq/chat/completions` |
| Auth header | `Authorization: Bearer {GROQ_API_KEY}` |
| Wire format | OpenAI-compatible |
| Project model string | `groq:{model}` e.g. `groq:llama-3.3-70b-versatile` |
| Env var | `GROQ_API_KEY` |

**Notes:**
- Groq's original base URL is `api.groq.com/openai/v1`. The gateway maps `api.groq.com` → `/groq`, so `/openai/v1/chat/completions` becomes `/groq/chat/completions` (the `/openai/v1` prefix is dropped).
- Path correction applied in this project: `/groq/openai/v1/...` → `/groq/...`

**Available models:**

| Model ID | Notes |
|----------|-------|
| `llama3-8b-8192` | 8k context |
| `llama3.1-8b` | |
| `llama-3.3-70b-versatile` | Best quality |
| `llama-3.1-8b-instant` | Fastest |

---

#### Mistral AI

| Field | Value |
|-------|-------|
| Gateway path | `/mistral/v1/chat/completions` |
| Auth header | `Authorization: Bearer {MISTRAL_API_KEY}` |
| Wire format | OpenAI-compatible |
| Project model string | `mistral:{model}` e.g. `mistral:mistral-large-latest` |
| Env var | `MISTRAL_API_KEY` |

**Available models:**

| Model ID | Notes |
|----------|-------|
| `mistral-large-latest` | Flagship |
| `mistral-small-latest` | Cost-optimised |

---

#### DeepSeek

| Field | Value |
|-------|-------|
| Gateway path | `/deepseek/chat/completions` |
| Auth header | `Authorization: Bearer {DEEPSEEK_API_KEY}` |
| Wire format | OpenAI-compatible |
| Project model string | `deepseek:{model}` e.g. `deepseek:deepseek-chat` |
| Env var | `DEEPSEEK_API_KEY` |

**Notes:**
- **Important:** There is no `/v1/` prefix in the gateway path. DeepSeek's original base URL is `api.deepseek.com/v1`; the gateway strips `/v1` when mapping to `/deepseek`.
- Path correction applied in this project: `/deepseek/v1/...` → `/deepseek/...`

**Available models:**

| Model ID | Notes |
|----------|-------|
| `deepseek-chat` | General purpose |
| `deepseek-reasoner` | Chain-of-thought reasoning |

---

#### xAI (Grok)

| Field | Value |
|-------|-------|
| Gateway path | `/grok/v1/chat/completions` |
| Auth header | `Authorization: Bearer {XAI_API_KEY}` |
| Wire format | OpenAI-compatible (also accepts Anthropic SDK format at same endpoint) |
| Project model string | `xai:{model}` e.g. `xai:grok-2-latest` |
| Env var | `XAI_API_KEY` |

**Notes:**
- xAI's original base URL is `api.x.ai/v1`. The gateway maps `api.x.ai` → `/grok` (not `/x-ai`), retaining the `/v1/` path segment.
- **Gateway prefix is `grok`, not `x-ai`.** Path correction applied in this project.

**Available models:**

| Model ID | Notes |
|----------|-------|
| `grok-2-latest` | Stable Grok 2 |
| `grok-4` | Grok 4 |
| `grok-4.3` | Grok 4.3 |
| `grok-4.20` | Grok 4.20 |
| `grok-beta` | Beta channel |

---

#### Perplexity

| Field | Value |
|-------|-------|
| Gateway path | `/perplexity-ai/chat/completions` |
| Auth header | `Authorization: Bearer {PERPLEXITY_API_KEY}` |
| Wire format | OpenAI-compatible |
| Project model string | `perplexity:{model}` e.g. `perplexity:sonar-pro` |
| Env var | `PERPLEXITY_API_KEY` |

**Notes:**
- Perplexity models include real-time web search in their responses by default; no special parameter is required.

**Available models:**

| Model ID | Notes |
|----------|-------|
| `sonar-pro` | Best quality with search |
| `sonar` | Standard with search |
| `mistral-7b-instruct` | Legacy, no search |

---

#### Cerebras

| Field | Value |
|-------|-------|
| Gateway path | `/cerebras/chat/completions` |
| Auth header | `Authorization: Bearer {CEREBRAS_API_KEY}` |
| Wire format | OpenAI-compatible |
| Project model string | `cerebras:{model}` e.g. `cerebras:llama-3.3-70b` |
| Env var | `CEREBRAS_API_KEY` |

**Notes:**
- Cerebras hardware delivers ultra-low-latency inference, particularly for large models. Suitable for latency-sensitive applications.

**Available models:**

| Model ID | Notes |
|----------|-------|
| `llama3.1-8b` | Fast, small |
| `llama-3.3-70b` | Fast, large |

---

#### OpenRouter

| Field | Value |
|-------|-------|
| Gateway path | `/openrouter/chat/completions` |
| Auth header | `Authorization: Bearer {OPENROUTER_API_KEY}` |
| Wire format | OpenAI-compatible |
| Project model string | `openrouter:{provider/model}` e.g. `openrouter:openai/gpt-5-mini` |
| Env var | `OPENROUTER_API_KEY` |

**Notes:**
- OpenRouter's original base URL is `openrouter.ai/api/v1`. The gateway maps this to `/openrouter` with no `/v1/` prefix retained in the path.
- The model field in the request body includes the provider prefix: e.g. `openai/gpt-5-mini`, `anthropic/claude-opus-4-7`, `google/gemini-2.5-pro`.
- OpenRouter provides access to 200+ models from a wide range of providers under a single API key with unified billing.

---

#### Amazon Bedrock

| Field | Value |
|-------|-------|
| Gateway path (compat) | `/compat/chat/completions` |
| Auth header | `cf-aig-authorization: Bearer {CF_AIG_TOKEN}` |
| Wire format | OpenAI-compatible (body `model` field: `aws-bedrock/{bedrockModelId}`) |
| Project model string | `bedrock:{bedrockModelId}` e.g. `bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0` |
| Env var | `CF_AIG_TOKEN` |

**Notes:**
- **BYOK required.** AWS credentials (Access Key ID, Secret Access Key, region) must be stored in the CF dashboard. The gateway handles SigV4 request signing internally.
- BYOK credential format (stored in dashboard):
  ```json
  {
    "accessKeyId": "AKIA...",
    "secretAccessKey": "...",
    "region": "us-east-1"
  }
  ```
- **Alternative native path** (direct invocation, requires client-side SigV4 signing):
  ```
  /aws-bedrock/bedrock-runtime/{region}/model/{modelId}/invoke
  ```
- The compat endpoint currently supports only **Anthropic Claude** and **Amazon Nova** model families. Other Bedrock model families are not yet supported via compat.

**Available models (Bedrock Model IDs):**

| Bedrock Model ID | Family |
|------------------|--------|
| `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Anthropic Claude Haiku |
| `us.anthropic.claude-3-5-sonnet-20241022-v2:0` | Anthropic Claude Sonnet |
| `us.amazon.nova-lite-v1:0` | Amazon Nova Lite |
| `us.amazon.nova-pro-v1:0` | Amazon Nova Pro |
| `us.amazon.nova-micro-v1:0` | Amazon Nova Micro |

---

#### Azure OpenAI

| Field | Value |
|-------|-------|
| Gateway path | `/azure-openai/{resource_name}/{deployment_name}/chat/completions?api-version=2024-02-01` |
| Auth header | `api-key: {AZURE_OPENAI_API_KEY}` |
| Wire format | OpenAI-compatible |
| Project model string | `azure:{resource-name}/{deployment-name}` e.g. `azure:my-resource/gpt-4o-deploy` |
| Env var | `AZURE_OPENAI_API_KEY` |

**Notes:**
- Auth header is `api-key:` — **not** `Authorization: Bearer`. Azure OpenAI uses a different authentication scheme from OpenAI.
- Both `{resource_name}` and `{deployment_name}` are URL-encoded path components.
- The deployment name appears in **both** the URL path and the request body's `model` field.
- The `api-version` query parameter is required; `2024-02-01` is the current stable version.

---

#### Baseten

| Field | Value |
|-------|-------|
| Gateway path | `/baseten/v1/chat/completions` |
| Auth header | `Authorization: Bearer {BASETEN_API_KEY}` |
| Wire format | OpenAI-compatible |
| Project model string | `baseten:{model-id}` e.g. `baseten:openai/gpt-oss-120b` |
| Env var | `BASETEN_API_KEY` |

**Notes:**
- For non-OpenAI-compatible models hosted on Baseten, a model-specific endpoint is available: `/baseten/model/{model_id}`. This requires a custom handler since the request/response format varies by model.
- Baseten hosts open-weight models including OpenAI's open-source releases.

**Available models:**

| Model ID | Notes |
|----------|-------|
| `openai/gpt-oss-120b` | OpenAI open-weight 120B |

---

### 7B. Extended Providers (10 additional)

These providers are fully implemented. Text-completion providers (Cohere, HuggingFace, Replicate, Parallel, Google Vertex AI) are wired into the `GATEWAY_PROVIDERS` registry in `src/lib/ai.ts` and dispatched through `complete()`/`completeStream()`. Media providers (ElevenLabs, Cartesia, Fal AI, Ideogram) use dedicated gateway functions called from new/extended route handlers. Deepgram is available via Workers AI hosted models with no gateway changes required.

---

#### Cohere

| Field | Value |
|-------|-------|
| Gateway path | `/cohere/v1/chat` |
| Auth header | `Authorization: Token {key}` |
| Wire format | `cohere` (custom handler) |
| Project model string | `cohere:{model}` e.g. `cohere:command-r-plus` |
| Env var | `COHERE_API_KEY` |

**Notes:**
- Auth uses `Token {key}` — **not** `Bearer`. This is a Cohere-specific convention.
- Cohere's request body uses `chat_history` (array of `{role, message}` objects), a `message` field for the current user turn, and a `preamble` field for the system prompt.
- **Tools (function calling):** `opts.tools` are forwarded as Cohere's native `parameter_definitions` format. Response `tool_calls[].parameters` are decoded via the project's `encodeToolCalls()` encoder and returned as the standard `__tool_calls__` envelope.
- Web search: add `connectors: [{ id: "web-search" }]` to the request body (not currently exposed via the API).
- Streaming: real SSE streaming via Cohere's `stream: true` — extracts `text-generation` events.

**Available models:** `command-r-plus`, `command-r`, `command`

---

#### HuggingFace

| Field | Value |
|-------|-------|
| Gateway path | `/huggingface/{org}/{model}` e.g. `/huggingface/bigcode/starcoder` |
| Auth header | `Authorization: Bearer {key}` |
| Wire format | `huggingface` (custom handler) |
| Project model string | `huggingface:{org}/{model}` |
| Env var | `HUGGINGFACE_API_KEY` |

**Notes:**
- The model identifier is part of the **URL path** (`/huggingface/${id}` where `id` = everything after `huggingface:`).
- Request body uses `inputs` (prompt string) and `parameters.max_new_tokens`/`temperature`.
- **System prompt:** `opts.systemPrompt` is prepended to the `inputs` string as `System: {prompt}\n`. Conversation messages follow as `{role}: {content}` lines (the system role line is not repeated).
- No streaming support — blocking completion only; `completeStream` emits the full result as one chunk.
- Response is `[{"generated_text": "..."}]` or `{"generated_text": "..."}`.

---

#### Replicate

| Field | Value |
|-------|-------|
| Gateway path | `/replicate/predictions` |
| Auth header | `Authorization: Bearer {key}` |
| Wire format | `replicate` (async polling handler) |
| Project model string | `replicate:{version-hash}` |
| Env var | `REPLICATE_API_KEY` |

**Notes:**
- Request body uses `version` (model version hash) and `input.prompt`.
- **Temperature:** `opts.temperature` is forwarded to the prediction `input` object when provided.
- Implementation: create prediction (with gateway headers) → poll `urls.get` every 1.5s until `status: "succeeded"` or timeout. The poll requests go directly to Replicate and do **not** include `cf-aig-*` headers.
- No streaming support — blocking poll only; `completeStream` emits the full result as one chunk.
- Output is `string[]` joined or a single string; joined with `''`.

**Available models:** `anthropic/claude-4.5-haiku`, `google/nano-banana`, and many others (community + official).

---

#### Parallel

| Field | Value |
|-------|-------|
| Auth header | `x-api-key: {key}` |
| Wire format | OpenAI-compat via unified `/compat` endpoint |
| Project model string | `parallel:{model-id}` e.g. `parallel:speed` |
| Env var | `PARALLEL_API_KEY` |

**Gateway paths:**

| API | Path |
|-----|------|
| Chat (compat — implemented) | `/compat/chat/completions` with model `parallel/{model-id}` |
| Tasks API | `/parallel/v1/tasks/runs` |
| Search API | `/parallel/v1beta/search` |
| FindAll API | `/parallel/v1beta/findall/ingest` |

**Notes:**
- Auth uses `x-api-key:` — not `Authorization: Bearer`. The `authHeaders` override handles this.
- Model string `parallel:speed` → compat body model `parallel/speed`.
- Parallel is purpose-built for AI agents — specialised in web research, evidence-based outputs, and structured data extraction.

---

#### Cartesia

| Field | Value |
|-------|-------|
| Gateway path | `/cartesia/tts/bytes` |
| Auth headers | `X-API-Key: {key}` + `Cartesia-Version: 2024-06-10` |
| Wire format | Cartesia-native; returns binary audio |
| Route | `POST /api/ai/tts` with `{ "provider": "cartesia" }` |
| Env var | `CARTESIA_API_KEY` |

**Request body fields:**

| Field | Description |
|-------|-------------|
| `text` | Text to synthesise (field mapped to `transcript` internally) |
| `modelId` | Model to use (default: `sonic-english`) |
| `voice` | `{ "mode": "id", "id": "{voice-uuid}" }` |
| `outputFormat` | `{ "container": "mp3", "encoding": "mp3", "sampleRate": 44100 }` |

**Available models:** `sonic-english`

---

#### Deepgram

| Field | Value |
|-------|-------|
| Gateway path | `/deepgram/` (WebSocket) |
| Auth header | `cf-aig-authorization: Bearer {CF_AIG_TOKEN}` in WebSocket headers |
| Wire format | Deepgram real-time streaming WebSocket |

**Notes:**
- Real-time WebSocket gateway path is not wired — requires a WebSocket upgrade handler, not a REST endpoint.
- Deepgram models are available as **Workers AI hosted models** and are fully usable today via `POST /api/ai/transcribe` with model `@cf/deepgram/nova-3`, `@cf/deepgram/aura-2-en`, etc. No additional API key needed.

---

#### ElevenLabs

| Field | Value |
|-------|-------|
| Gateway path | `/elevenlabs/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128` |
| Auth header | `xi-api-key: {key}` |
| Wire format | ElevenLabs-native; returns binary audio (MP3) |
| Route | `POST /api/ai/tts` with `{ "provider": "elevenlabs" }` |
| Env var | `ELEVENLABS_API_KEY` |

**Request body fields:**

| Field | Description |
|-------|-------------|
| `text` | Text to convert to speech |
| `voiceId` | Voice ID (default: `EXAVITQu4vr4xnSDxMaL`) |
| `modelId` | Model to use (default: `eleven_multilingual_v2`) |

**Notes:**
- Auth uses `xi-api-key:` — **not** `Authorization: Bearer`.
- The voice ID is URL-path-encoded internally by `synthesizeSpeech`.

**Available models:** `eleven_multilingual_v2`

---

#### Fal AI

| Field | Value |
|-------|-------|
| Gateway path | `/fal/{model-path}` e.g. `/fal/fal-ai/fast-sdxl` |
| Auth header | `Authorization: Key {key}` |
| Wire format | Fal-native; response is image URL |
| Route | `POST /api/ai/image` with `model: "fal:{model-path}"` |
| Env var | `FAL_API_KEY` |

**Notes:**
- Auth uses `Authorization: Key {key}` — **not** `Bearer`. This is a Fal-specific convention.
- Response returns `{ url: "...", format: "url" }` (not base64 bytes like Workers AI).
- For custom model routing, send requests to `/fal` with the `x-fal-target-url: https://queue.fal.run/...` header (advanced use; not currently exposed).
- Fal provides 600+ generative media models (image, video, voice, audio).

---

#### Ideogram

| Field | Value |
|-------|-------|
| Gateway path | `/ideogram/v1/ideogram-v3/generate` |
| Auth header | `Api-Key: {key}` |
| Wire format | Ideogram-native; returns image URL |
| Route | `POST /api/ai/image` with `model: "ideogram:V_3"` |
| Env var | `IDEOGRAM_API_KEY` |

**Request body fields:**

| Field | Description |
|-------|-------------|
| `prompt` | Text description of the image to generate |
| `model` | Model version (default: `V_3`) |

**Notes:**
- Auth uses `Api-Key:` — **not** `Authorization: Bearer` or `Authorization: Key`.
- Response returns `{ url: "...", format: "url" }`.

**Available models:** `V_3`

---

#### Google Vertex AI

| Field | Value |
|-------|-------|
| Gateway path | `/compat/chat/completions` (unified compat) |
| Auth header | `cf-aig-authorization: Bearer {CF_AIG_TOKEN}` |
| Wire format | OpenAI-compat via `/compat` endpoint |
| Project model string | `vertex:{model}` e.g. `vertex:google/gemini-2.5-pro` |
| Env var | `CF_AIG_TOKEN` (shared with Bedrock BYOK) |

**Authentication options:**

| Method | Headers required |
|--------|-----------------|
| **BYOK (implemented)** | `cf-aig-authorization: Bearer {CF_AIG_TOKEN}` only — gateway signs with stored service account |
| Service account JSON (direct) | `cf-aig-authorization: Bearer {CF_AIG_TOKEN}` + `Authorization: Bearer {base64-encoded-service-account-json-with-region-key}` |
| Direct access token | `cf-aig-authorization: Bearer {CF_AIG_TOKEN}` + `Authorization: Bearer {gcloud-access-token}` |

**BYOK credential format** (stored in CF dashboard — select region during setup):

```json
{
  "type": "service_account",
  "project_id": "my-project",
  "private_key_id": "...",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...",
  "client_email": "my-sa@my-project.iam.gserviceaccount.com",
  ...
}
```

**Notes:**
- Model string `vertex:google/gemini-2.5-pro` → compat body model `google-vertex-ai/google/gemini-2.5-pro`.
- Use specific region names (e.g. `us-central1`, `europe-west4`) — **not** `global`. The `global` endpoint has limited model support and often returns `UNAUTHENTICATED` errors.
- Common errors: `CREDENTIALS_MISSING` / `UNAUTHENTICATED` → check that the region key is present in the service account JSON and that BYOK is correctly configured in the dashboard.

---

## 8. Workers AI Models

Workers AI models are served from Cloudflare's own GPU infrastructure. They are accessed in one of two ways:

- **`env.AI.run('@cf/...', inputs)`** — Workers AI binding (direct, no HTTP overhead)
- **REST API with `cf-aig-gateway-id` header** — routes through AI Gateway for logging, caching, and analytics

---

### 8A. Hosted Models (env.AI binding / @cf/ prefix)

#### Text Generation

| Model ID | Notes |
|----------|-------|
| `@cf/moonshotai/kimi-k2.6` | 1T params, 262k context, function calling, reasoning, vision — recommended |
| `@cf/moonshotai/kimi-k2.5` | 256k context, function calling, reasoning, vision — planned deprecation |
| `@cf/zai-org/glm-4.7-flash` | 131k context, multilingual (100+ languages), function calling, reasoning |
| `@cf/openai/gpt-oss-120b` | OpenAI open-weight, function calling, reasoning |
| `@cf/openai/gpt-oss-20b` | OpenAI open-weight, lower latency, function calling, reasoning |
| `@cf/google/gemma-4-26b-a4b-it` | Function calling, reasoning, vision |
| `@cf/google/gemma-3-12b-it` | Vision, 128k context, 140+ languages, LoRA — planned deprecation |
| `@cf/google/gemma-7b-it` | LoRA — planned deprecation |
| `@cf/google/gemma-7b-it-lora` | LoRA |
| `@cf/google/gemma-2b-it-lora` | LoRA |
| `@hf/google/gemma-7b-it` | LoRA — planned deprecation |
| `@cf/nvidia/nemotron-3-120b-a12b` | Hybrid MoE, function calling, reasoning |
| `@cf/ibm-granite/granite-4.0-h-micro` | Function calling, RAG, multi-agent |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | Multimodal MoE, function calling, vision, batch |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Function calling, batch |
| `@cf/meta/llama-3.2-11b-vision-instruct` | Vision, LoRA |
| `@cf/meta/llama-3.2-3b-instruct` | |
| `@cf/meta/llama-3.2-1b-instruct` | |
| `@cf/meta/llama-3.1-8b-instruct` | Planned deprecation |
| `@cf/meta/llama-3.1-8b-instruct-fast` | |
| `@cf/meta/llama-3.1-8b-instruct-fp8` | |
| `@cf/meta/llama-3.1-8b-instruct-awq` | int4 quantised — planned deprecation |
| `@cf/meta/llama-3.1-70b-instruct` | Planned deprecation |
| `@cf/meta/llama-3-8b-instruct` | Planned deprecation |
| `@cf/meta/llama-3-8b-instruct-awq` | int4 quantised — planned deprecation |
| `@hf/meta-llama/meta-llama-3-8b-instruct` | Planned deprecation |
| `@cf/meta/llama-guard-3-8b` | Content safety classification, LoRA |
| `@cf/meta/llama-2-7b-chat-fp16` | Planned deprecation |
| `@cf/meta/llama-2-7b-chat-int8` | int8 quantised — planned deprecation |
| `@cf/meta-llama/llama-2-7b-chat-hf-lora` | LoRA — planned deprecation |
| `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | Reasoning |
| `@cf/qwen/qwq-32b` | Reasoning, LoRA |
| `@cf/qwen/qwen3-30b-a3b-fp8` | Function calling, reasoning, batch |
| `@cf/qwen/qwen2.5-coder-32b-instruct` | Code generation, LoRA |
| `@cf/alibaba/qwen3-max` | Function calling, multilingual |
| `@cf/alibaba/qwen3.5-397b-a17b` | MoE, 397B total params / 17B active, reasoning |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | Vision, 128k context, function calling |
| `@hf/mistral/mistral-7b-instruct-v0.2` | 32k context — planned deprecation |
| `@cf/mistral/mistral-7b-instruct-v0.1` | LoRA — planned deprecation |
| `@cf/mistral/mistral-7b-instruct-v0.2-lora` | LoRA |
| `@hf/nousresearch/hermes-2-pro-mistral-7b` | Function calling — planned deprecation |
| `@cf/microsoft/phi-2` | 1.4T token training — planned deprecation |
| `@cf/defog/sqlcoder-7b-2` | SQL generation — planned deprecation |
| `@cf/aisingapore/gemma-sea-lion-v4-27b-it` | Southeast Asian languages |

---

#### Text Embeddings

| Model ID | Dimensions | Notes |
|----------|------------|-------|
| `@cf/baai/bge-base-en-v1.5` | 768 | Batch |
| `@cf/baai/bge-large-en-v1.5` | 1024 | Batch |
| `@cf/baai/bge-small-en-v1.5` | 384 | Batch |
| `@cf/baai/bge-m3` | — | Multi-lingual, multi-granularity |
| `@cf/google/embeddinggemma-300m` | — | 300M params, 100+ languages, Gemma-based |
| `@cf/qwen/qwen3-embedding-0.6b` | — | |
| `@cf/pfnet/plamo-embedding-1b` | — | Japanese text |

---

#### Text Classification and Reranking

| Model ID | Task | Notes |
|----------|------|-------|
| `@cf/huggingface/distilbert-sst-2-int8` | Sentiment classification | |
| `@cf/baai/bge-reranker-base` | Reranking | Outputs similarity score [0, 1] |

---

#### Text-to-Image

| Model ID | Notes |
|----------|-------|
| `@cf/black-forest-labs/flux-1-schnell` | 12B params, 1024px |
| `@cf/black-forest-labs/flux-2-klein-4b` | Ultra-fast editing, partner model |
| `@cf/black-forest-labs/flux-2-klein-9b` | Ultra-fast editing, enhanced quality, partner model |
| `@cf/black-forest-labs/flux-2-dev` | Multi-reference support, partner model |
| `@cf/bytedance/stable-diffusion-xl-lightning` | 1024px, few-step generation |
| `@cf/stabilityai/stable-diffusion-xl-base-1.0` | |
| `@cf/runwayml/stable-diffusion-v1-5-img2img` | Image-to-image |
| `@cf/runwayml/stable-diffusion-v1-5-inpainting` | Inpainting |
| `@cf/lykon/dreamshaper-8-lcm` | Photorealism |
| `@cf/alibaba/wan-2.6-image` | Alibaba |
| `@cf/leonardo/lucid-origin` | Prompt-responsive, partner model |
| `@cf/leonardo/phoenix-1.0` | Text rendering, partner model |

---

#### Text-to-Speech

| Model ID | Notes |
|----------|-------|
| `@cf/myshell-ai/melotts` | Multi-lingual |
| `@cf/deepgram/aura-1` | Context-aware pacing, real-time + batch, partner model |
| `@cf/deepgram/aura-2-en` | English, context-aware, real-time + batch, partner model |
| `@cf/deepgram/aura-2-es` | Spanish, context-aware, real-time + batch, partner model |

---

#### Automatic Speech Recognition

| Model ID | Notes |
|----------|-------|
| `@cf/openai/whisper` | General-purpose, multilingual |
| `@cf/openai/whisper-large-v3-turbo` | Batch |
| `@cf/openai/whisper-tiny-en` | English only |
| `@cf/deepgram/nova-3` | Real-time + batch, partner model |
| `@cf/deepgram/flux` | Conversational, real-time only, partner model |
| `@cf/assemblyai/universal-3-pro` | High-accuracy |

---

#### Image-to-Text / Vision

| Model ID | Notes |
|----------|-------|
| `@cf/llava-hf/llava-1.5-7b-hf` | Visual question answering, image captioning |
| `@cf/unum/uform-gen2-qwen-500m` | Image captioning, VQA — planned deprecation |

---

#### Object Detection

| Model ID | Notes |
|----------|-------|
| `@cf/facebook/detr-resnet-50` | COCO 2017 dataset, end-to-end transformer |

---

#### Image Classification

| Model ID | Notes |
|----------|-------|
| `@cf/microsoft/resnet-50` | 50-layer CNN, ImageNet |

---

#### Summarization

| Model ID | Notes |
|----------|-------|
| `@cf/facebook/bart-large-cnn` | Seq2seq — planned deprecation |

---

#### Translation

| Model ID | Notes |
|----------|-------|
| `@cf/meta/m2m100-1.2b` | Many-to-many multilingual, batch |
| `@cf/ai4bharat/indictrans2-en-indic-1B` | English → 22 Indic languages |

---

#### Voice Activity Detection

| Model ID | Notes |
|----------|-------|
| `@cf/pipecat-ai/smart-turn-v2` | Audio turn detection, real-time + batch |

---

### 8B. Proxied Models (via Gateway — not Workers AI binding)

These models are accessed through provider gateway routes, not `env.AI.run()`. They are listed by provider for reference.

---

#### Anthropic (proxied)

`claude-opus-4.8`, `claude-opus-4.7`, `claude-opus-4.6`, `claude-sonnet-4.6`, `claude-sonnet-4.5`, `claude-sonnet-4`, `claude-haiku-4.5`

---

#### OpenAI (proxied)

**Text generation:** `gpt-5.5-pro`, `gpt-5.5`, `gpt-5.4-pro`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5`, `gpt-4.1`, `gpt-4.1-mini`, `o4-mini`

**Speech-to-text:** `gpt-4o-transcribe`

**Text-to-speech:** `tts-1`, `tts-1-hd`

**Text-to-image:** `gpt-image-1.5`, `gpt-image-2`

---

#### Google (proxied)

**Text generation:** `gemini-3.1-pro`, `gemini-3.1-flash-lite`, `gemini-3-flash`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`

**Text-to-speech:** `gemini-3.1-flash-tts`

**Text-to-image:** `imagen-4`, `nano-banana`, `nano-banana-2`, `nano-banana-pro`

**Text-to-video:** `veo-3`, `veo-3-fast`, `veo-3.1`, `veo-3.1-fast`

---

#### xAI (proxied)

**Text generation:** `grok-4.20-multi-agent-0309`, `grok-4.20-0309-reasoning`, `grok-4.20-0309-non-reasoning`, `grok-4.3`, `grok-4`, `grok-2-latest`

**Image generation:** `grok-imagine-image`, `grok-imagine-image-quality`

**Video generation:** `grok-imagine-video`

---

#### MiniMax (proxied)

**Text generation:** `m2.7`

**Text-to-speech:** `speech-2.8-hd`, `speech-2.8-turbo`

**Music generation:** `music-2.6`

**Video generation:** `hailuo-2.3`, `hailuo-2.3-fast`

---

#### ByteDance (proxied)

**Image generation:** `seedream-4.0`, `seedream-4.5`, `seedream-5-lite`

**Video generation:** `seedance-2.0`, `seedance-2.0-fast`

---

#### Alibaba (proxied)

**Image-to-video:** `hh1-i2v`

**Text-to-video:** `hh1-t2v`

---

#### Other proxied providers

| Provider | Models |
|----------|--------|
| **Vidu** | `q3-pro`, `q3-turbo` |
| **RunwayML** | `gen-4.5` |
| **PixVerse** | `v5.6`, `v6` |
| **Black Forest Labs** | `flux-2-pro-preview`, `flux-2-max`, `flux-2-flex` |
| **Recraft** | `recraftv3`, `recraftv4`, `recraftv4-pro`, `recraftv4-vector`, `recraftv4-pro-vector` |
| **Inworld** | `tts-1.5-max`, `tts-1.5-mini`, `tts-2` |
| **AssemblyAI** | `universal-3-pro` |

---

## 9. Project Implementation Notes

This section documents how Project Whisper wires AI Gateway internally.

### Key files

| File | Purpose |
|------|---------|
| `src/lib/ai.ts` | `GatewayProviderDef` + `ProviderCapabilities` registry (18 providers); `buildGatewayHeaders()` shared utility; `completeOpenAI/Anthropic/Google/Cohere/HuggingFace/Replicate` + their stream counterparts |
| `src/lib/pricing.ts` | Per-model input/output cost estimates (USD per 1k tokens); `estimateCost()` strips provider prefix before lookup |
| `src/types/env.d.ts` | TypeScript declarations for all environment variables (provider API keys, CF tokens) |
| `.dev.vars.example` | Documentation of all required and optional env vars with descriptions |

### Model string format

Callers specify models using the `provider:model-id` format:

```
openai:gpt-4o
anthropic:claude-sonnet-4-6
google:gemini-2.5-flash
groq:llama-3.3-70b-versatile
mistral:mistral-large-latest
deepseek:deepseek-chat
xai:grok-2-latest
perplexity:sonar-pro
cerebras:llama-3.3-70b
openrouter:openai/gpt-5-mini
bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0
azure:my-resource/gpt-4o-deploy
baseten:openai/gpt-oss-120b
cohere:command-r-plus
huggingface:bigcode/starcoder
replicate:meta/llama-4-maverick-instruct-basic
parallel:speed
vertex:google/gemini-2.5-pro
```

**Non-text model strings (new routes):**

```
fal:fal-ai/fast-sdxl          → POST /api/ai/image  → { url, format:"url" }
ideogram:V_3                   → POST /api/ai/image  → { url, format:"url" }
provider:"elevenlabs"          → POST /api/ai/tts    → binary audio (MP3)
provider:"cartesia"            → POST /api/ai/tts    → binary audio (MP3)
```

### Project-specific features

**Anthropic prompt caching (automatic)**

Whenever a non-empty `systemPrompt` is passed to an Anthropic request, the AI layer automatically:

1. Adds `anthropic-beta: prompt-caching-2024-07-31` to the request headers.
2. Wraps the system prompt as a content block with `cache_control: { type: 'ephemeral' }`.

Anthropic only activates the cache for prefixes ≥ 1,024 tokens (~800 words); shorter prompts incur no caching overhead but are safe to send with the block present.

**JSON Schema mode**

Pass a `jsonSchema` field in the request options to enable structured output. The AI layer converts this to the provider's native structured output or tool-use mechanism.

**ContentBlock vision input**

Vision requests use a `ContentBlock` type for multi-modal inputs (text + image). The AI layer converts this to the provider's native format (`content` array with `type: "image_url"` for OpenAI, `type: "image"` with base64 source for Anthropic, etc.).

**ProviderCapabilities**

Every entry in `GATEWAY_PROVIDERS` declares a `capabilities` object:

```typescript
interface ProviderCapabilities {
  tools?:        boolean  // native function calling
  vision?:       boolean  // ContentBlock[] image inputs
  streaming?:    boolean  // real SSE streaming (vs. fallback single-chunk)
  systemPrompt?: boolean  // dedicated system field (not prepended to prompt)
  jsonMode?:     boolean  // json_object or json_schema response format
}
```

HuggingFace (`streaming: false`) and Replicate (`streaming: false`) fall back to blocking completion wrapped in a single-chunk stream.

**Unified gateway header builder**

`buildGatewayHeaders(key, authH, opts, modelLabel)` is the single source of truth for all `cf-aig-*` headers. Every provider handler — blocking and streaming — calls this function. No handler constructs its own `cf-aig-cache-ttl` or `cf-aig-metadata` headers inline.

The builder also forwards three optional caller-controlled headers when the corresponding `CompletionOpts` fields are set:

| `CompletionOpts` field | Emitted header | When emitted |
|---|---|---|
| `byokAlias: "my-key"` | `cf-aig-byok-alias: my-key` | When `byokAlias` is a non-empty string |
| `zdr: true` | `cf-aig-zdr: true` | When `zdr === true` |
| `collectLogPayload: false` | `cf-aig-collect-log-payload: false` | When `collectLogPayload === false` |

These are surfaced in the API via `POST /api/ai/complete` and `POST /api/ai/stream` request bodies.

**Analytics Engine data points**

Every AI Gateway request records a data point to Cloudflare Analytics Engine with:

- **Blobs:** `model`, `provider`, `sandboxId`
- **Doubles:** `latencyMs`, `inputTokens`, `outputTokens`, `costUsd`

**Model fallback routing**

Pass `fallbackModel` in `CompletionOpts` to declare a secondary model. If the primary provider throws (rate limit, outage, bad model ID), `complete()` records the failure to Analytics Engine and retries once with the fallback model:

```json
POST /api/ai/complete
{
  "model": "anthropic:claude-opus-4-8",
  "fallbackModel": "anthropic:claude-sonnet-4-6",
  "prompt": "Summarise this document."
}
```

Fallback events appear in Analytics Engine with blob[1] = `"fallback"` so they can be tracked separately from successful completions.

**Timeout**

All gateway fetch calls use `AbortSignal.timeout(120_000)` (120 seconds). Long-running model calls that exceed this limit will throw an `AbortError`.

**Caching behaviour**

All provider requests (blocking and streaming, all 18 providers) send:

```http
cf-aig-cache-ttl: 3600
```

When `temperature` is non-zero (i.e. the response is non-deterministic), caching is bypassed:

```http
cf-aig-skip-cache: true
```

When `sandboxId` is present in opts, observability metadata is attached:

```http
cf-aig-metadata: {"sandboxId": "...", "model": "..."}
```

### Path corrections applied

The following gateway path corrections were discovered and applied in this project:

| Provider | Wrong path | Correct path | Reason |
|----------|-----------|--------------|--------|
| Groq | `/groq/openai/v1/chat/completions` | `/groq/chat/completions` | Gateway strips the `openai/v1` middle segment |
| DeepSeek | `/deepseek/v1/chat/completions` | `/deepseek/chat/completions` | Gateway strips the `/v1` segment |
| xAI | `/x-ai/v1/chat/completions` | `/grok/v1/chat/completions` | Gateway prefix is `grok`, not `x-ai` |

---

*This document is generated from Cloudflare AI Gateway documentation. All paths and examples reflect the actual gateway behaviour as of the document date. Do not invent or modify URLs — use only the paths shown here.*
