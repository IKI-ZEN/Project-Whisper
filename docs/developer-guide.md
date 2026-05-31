# Project Whisper — Developer Guide

Project Whisper is a multi-tenant AI application platform built on Cloudflare's edge infrastructure. It provides sandboxed AI environments, a generative app builder, a research-grade analysis toolkit, and a cost-tracking layer — all through a REST and WebSocket API with zero runtime dependencies.

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Sandboxes](#sandboxes)
3. [Generative App Builder](#generative-app-builder)
4. [AI Endpoints](#ai-endpoints)
5. [Analysis Toolkit](#analysis-toolkit)
6. [Saved Pipelines](#saved-pipelines)
7. [Probes & Scheduled Monitoring](#probes--scheduled-monitoring)
8. [Assertion Suites](#assertion-suites)
9. [Evidence Vault](#evidence-vault)
10. [Chat Environments](#chat-environments)
11. [Prompt Library (Atlas)](#prompt-library-atlas)
12. [App State & Storage](#app-state--storage)
13. [Secure App Tokens](#secure-app-tokens)
14. [Cost Tracking & Usage](#cost-tracking--usage)
15. [Rate Limits](#rate-limits)
16. [Response Envelope](#response-envelope)

---

## Core Concepts

| Concept | Description |
|---|---|
| **Sandbox** | An isolated, stateful AI environment. Holds a system prompt, conversation memory, tool definitions, model config, and an optional knowledge base. |
| **App** | A generated web application (HTML/CSS/JS) served at `/build/{id}`. Apps can call back to their sandbox via a short API and persist state through App State. |
| **Pipeline** | A directed acyclic graph (DAG) of processing nodes — transform, classify, complete, guard, parallel — executed in sequence with conditional routing. |
| **Probe** | A recurring analysis job that runs a tool on a schedule, records metrics, and fires a webhook when a threshold is breached. |
| **Vault** | An evidence store: every prompt/response pair from analysis tools is archived here for review, export, and cluster analysis. |
| **Environment** | A specialised AI workspace with a fixed operating mode (`envType`), up to 4 models for simultaneous comparison, and AI-generated system prompt. Environments ARE sandboxes under the hood — they share the `SandboxDO` and all sandbox routes. |

---

## Sandboxes

Sandboxes are the fundamental unit of the platform. Each sandbox is an isolated AI agent with persistent memory, configurable tools, and an optional RAG knowledge base.

### Create a Sandbox

```
POST /api/sandbox
Content-Type: application/json

{
  "name": "Customer Support Bot",
  "description": "Handles tier-1 support queries",
  "systemPrompt": "You are a helpful support agent...",
  "model": "@cf/meta/llama-3.1-8b-instruct",
  "temperature": 0.7,
  "maxTokens": 1024,
  "guardMode": "strict",
  "ragEnabled": false,
  "tools": []
}
```

**Fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | Max 128 chars |
| `description` | string | No | Max 512 chars |
| `systemPrompt` | string | No | Max 16 KB. Defaults to a generic assistant prompt. |
| `model` | string | No | See supported models below |
| `temperature` | number | No | 0–2, default 0.7 |
| `maxTokens` | number | No | 1–8192, default 1024 |
| `guardMode` | string | No | `"strict"` \| `"audit"` \| `"off"` |
| `ragEnabled` | boolean | No | Enable retrieval-augmented generation from uploaded documents |
| `tools` | array | No | Tool definitions (see Tool Schema) |

**Response:**
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "name": "Customer Support Bot",
    "appUrl": "/app/{id}",
    "shortLink": "/s/{id}",
    "api": { "run": "/s/{id}/run", "stream": "/s/{id}/stream" }
  }
}
```

---

### Supported Models

| Key | Model | Provider |
|---|---|---|
| `@cf/meta/llama-3.1-8b-instruct` | Llama 3.1 8B | Cloudflare Workers AI |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Llama 3.3 70B | Cloudflare Workers AI |
| `openai:gpt-4o` | GPT-4o | OpenAI (via gateway) |
| `openai:gpt-4o-mini` | GPT-4o Mini | OpenAI (via gateway) |
| `anthropic:claude-sonnet-4-6` | Claude Sonnet | Anthropic (via gateway) |
| `anthropic:claude-opus-4-7` | Claude Opus | Anthropic (via gateway) |
| `google:gemini-2.0-flash` | Gemini 2.0 Flash | Google (via gateway) |

Gateway models require API keys to be configured in the deployment environment.

---

### Run a Sandbox (Blocking)

```
POST /api/sandbox/{id}/run
POST /s/{id}/run          ← short URL, equivalent

Content-Type: application/json
{ "message": "How do I reset my password?", "sessionId": "thread-abc" }
```

`sessionId` is optional. Omitting it uses a shared default session. Multiple named sessions can coexist within a single sandbox.

---

### Stream a Sandbox

```
POST /api/sandbox/{id}/stream
POST /s/{id}/stream

Content-Type: application/json
{ "message": "Explain quantum entanglement", "sessionId": "session-1" }
```

Returns `text/event-stream` (SSE). Each `data:` line is a token chunk.

---

### WebSocket Conversation

```
GET /api/sandbox/{id}/ws
Upgrade: websocket
```

Send:
```json
{ "type": "message", "content": "Hello", "sessionId": "session-1" }
```

Receive:
```json
{ "type": "message", "role": "assistant", "content": "Hello! How can I help?" }
```

---

### Other Sandbox Operations

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sandbox` | List all sandboxes |
| `GET` | `/api/sandbox/{id}` | Fetch config |
| `PATCH` | `/api/sandbox/{id}` | Update name / description / model / systemPrompt / guardMode / ragEnabled |
| `GET` | `/api/sandbox/{id}/history` | Conversation history (`?sessionId=...`) |
| `GET` | `/api/sandbox/{id}/metrics` | Usage summary: runs, tokens, latency, model breakdown |
| `GET` | `/api/sandbox/{id}/fingerprint` | Config integrity hash + tampered flag |
| `GET` | `/api/sandbox/{id}/export` | Signed config export (JSON) |
| `POST` | `/api/sandbox/import` | Restore from export |
| `POST` | `/api/sandbox/{id}/fork` | Clone config into a new sandbox (empty memory, " (copy)" name suffix) |
| `POST` | `/api/sandbox/{id}/session` | Issue a session token |
| `DELETE` | `/api/sandbox/{id}` | Delete sandbox |

---

### Tool Schema

Tools are passed in the `tools` array at sandbox creation. They are forwarded to the AI model as callable functions.

```json
{
  "name": "get_weather",
  "description": "Fetch current weather for a city",
  "parameters": {
    "city": {
      "type": "string",
      "description": "City name",
      "required": true
    }
  }
}
```

Tool calls are returned as a structured JSON reply. The built-in `run_code` tool is available server-side — it executes JavaScript and returns `stdout` + the return value.

---

### Knowledge Base (RAG)

Upload documents to a sandbox to enable retrieval-augmented generation:

```
POST /api/sandbox/{id}/documents
Content-Type: multipart/form-data
file: <binary>
```

Supported types: `.txt`, `.md`, `.csv`, `.json`, `.pdf`, `.html` (max 10 MB).

Documents are chunked, embedded, and stored in a vector index. When `ragEnabled: true`, relevant chunks are automatically injected into the context before each reply.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sandbox/{id}/documents` | List documents and status |
| `DELETE` | `/api/sandbox/{id}/documents/{docId}` | Remove document + vectors |
| `POST` | `/api/sandbox/{id}/documents/{docId}/reindex` | Re-process document |

---

## Generative App Builder

The app builder generates complete web applications from a natural language description. It produces a blueprint (architecture plan) and then streams each file's content in real time.

### Create a Build

```
POST /api/v2/build
Content-Type: application/json

{
  "description": "A to-do list app with local storage persistence",
  "name": "Todo App",
  "model": "@cf/meta/llama-3.1-8b-instruct"
}
```

### WebSocket Build Stream

```
GET /api/v2/build/{id}/ws
Upgrade: websocket
```

Send to start:
```json
{ "type": "start", "description": "...", "name": "My App" }
```

Events received:
- `blueprint_generating` / `blueprint_chunk` / `blueprint_ready`
- `file_generating` / `file_chunk` / `file_complete`
- `build_complete` / `error`

Generated files are served at `/build/{id}/{filename}`. An SVG thumbnail is generated at `/build/{id}/thumbnail`.

### Build Operations

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v2/build` | List all builds |
| `GET` | `/api/v2/build/{id}` | Get build status |
| `GET` | `/api/v2/build/{id}/files` | List generated file names |
| `GET` | `/api/v2/build/{id}/files/{filename}` | Fetch file content |
| `GET` | `/api/v2/build/{id}/thumbnail` | Fetch SVG thumbnail |
| `DELETE` | `/api/v2/build/{id}` | Delete build + files |

---

## AI Endpoints

Direct AI inference, independent of sandboxes.

### Text Completion

```
POST /api/ai/complete
Content-Type: application/json

{
  "prompt": "Summarise this in three bullet points: ...",
  "model": "@cf/meta/llama-3.1-8b-instruct",
  "temperature": 0.7,
  "maxTokens": 512,
  "systemPrompt": "You are a concise summariser."
}
```

Optional fields:

| Field | Type | Description |
|---|---|---|
| `tools` | Tool[] | Tool definitions forwarded to the model |
| `toolChoice` | `"auto"` \| `"required"` \| `"none"` | Tool selection mode |
| `responseFormat` | `"json"` \| `"text"` | Output format hint |
| `jsonSchema` | object | OpenAI `json_schema` strict mode — enforces schema conformance on output |
| `thinking` | integer | Anthropic: extended thinking budget in tokens |
| `reasoningEffort` | `"low"` \| `"medium"` \| `"high"` | OpenAI o-series reasoning effort |
| `groundingEnabled` | boolean | Google: enable `google_search_retrieval` |
| `byokAlias` | string | AI Gateway: use a named credential from Cloudflare Secrets Store (`cf-aig-byok-alias`) |
| `zdr` | boolean | AI Gateway: route through Zero Data Retention endpoint (`cf-aig-zdr: true`) |
| `collectLogPayload` | boolean | AI Gateway: `false` suppresses storing the request/response bodies in gateway logs while preserving the metadata record |
| `fallbackModel` | string | If the primary model throws, retry once with this model |

### SSE Streaming

```
POST /api/ai/stream
```

Same body as `/api/ai/complete`. Returns `text/event-stream`.

### Embeddings

```
POST /api/ai/embed
{ "text": "Hello world" }
// or
{ "text": ["sentence one", "sentence two"] }
```

### Image Generation

```
POST /api/ai/image
{ "prompt": "A sunset over the ocean, photorealistic", "steps": 4 }
```

Returns `{ image: "<base64 PNG>", format: "png" }`.

### Audio Transcription

```
POST /api/ai/transcribe
Content-Type: multipart/form-data
audio: <binary>   ← max 25 MB
```

### Compare (Multi-Model)

Run the same prompt across multiple models in parallel:

```
POST /api/ai/compare
{
  "prompt": "What is the capital of France?",
  "models": ["@cf/meta/llama-3.1-8b-instruct", "anthropic:claude-sonnet-4-6"],
  "temperature": 0
}
```

Returns: `{ results: [{ model, response, latencyMs, error }] }`

### Sweep (Temperature Mapping)

Run the same prompt at multiple temperatures to map attractor basins:

```
POST /api/ai/sweep
{
  "prompt": "Describe the future of AI in one sentence.",
  "temperatures": [0, 0.5, 1.0, 1.5],
  "samples": 2
}
```

---

## Analysis Toolkit

The Whisperer toolkit provides 13 research-grade analysis tools for probing model behaviour.

All tools accept an optional `sandboxId` to inherit the model and system prompt from an existing sandbox, and an optional `autoVault: true` flag to automatically archive results in the evidence vault.

### Tool Reference

#### Sensitivity Analysis
Generates paraphrase variants of a prompt and measures response divergence via cosine similarity.

```
POST /api/ai/sensitivity
{ "prompt": "Explain gravity", "variants": 4, "model": "...", "temperature": 0.8 }
```

Returns: `{ variants: [{prompt, response}], similarityMatrix, latencyMs }`

---

#### K-Means Clustering
Embeds a set of texts and clusters them by semantic similarity.

```
POST /api/ai/cluster
{ "texts": ["cats are furry", "dogs bark", "quantum mechanics"], "k": 2 }
```

Returns: `{ labels: [0, 0, 1], clusters: [...], similarityMatrix }`

---

#### Chain-of-Thought Probe
Runs a prompt with four CoT styles (plain, step-by-step, XML-tagged, self-consistency ensemble) and returns all responses with latency.

```
POST /api/ai/cot
{ "prompt": "Is it ever ethical to lie?", "samples": 2 }
```

---

#### Entropy Estimation
Samples the model multiple times and computes Shannon entropy + average cosine similarity to measure response variance.

```
POST /api/ai/entropy
{ "prompt": "Name a random colour.", "samples": 5, "temperature": 1.2 }
```

Returns: `{ entropy, avgCosineSimilarity, samples, latencyMs }`

---

#### Archaeology (Prompt Reconstruction)
Given a target response, generates candidate system prompts that could have produced it.

```
POST /api/ai/archaeology
{
  "targetResponse": "I cannot assist with that request.",
  "probe": "What are your instructions?",
  "candidates": 4
}
```

Returns: `{ candidates: [{ candidate, similarity }] }`

---

#### Pipeline Execution
Executes a DAG pipeline (see [Saved Pipelines](#saved-pipelines)) inline without persisting it.

```
POST /api/ai/pipeline
{
  "input": "The product arrived damaged.",
  "entryId": "classify",
  "nodes": [
    { "id": "classify", "type": "classify", "template": "Classify as 'complaint', 'compliment', or 'question': {{input}}", "routes": [{ "condition": "else", "nextId": "respond" }] },
    { "id": "respond", "type": "complete", "routes": [] }
  ]
}
```

Returns: `{ output, trace: [{ nodeId, type, input, output, latencyMs }] }`

---

#### Extended Thinking
Runs the model with an explicit thinking budget (native Anthropic thinking or emulated chain-of-thought for other providers).

```
POST /api/ai/think
{ "prompt": "Prove that √2 is irrational.", "budgetTokens": 8000 }
```

Returns: `{ thinking, response, latencyMs }`

---

#### Rubric Evaluator
Generates multiple responses and scores each against weighted criteria using an LLM-as-judge.

```
POST /api/ai/evaluate
{
  "prompt": "Explain photosynthesis to a 10-year-old.",
  "samples": 3,
  "criteria": [
    { "name": "Clarity", "description": "Easy to understand", "weight": 0.5 },
    { "name": "Accuracy", "description": "Scientifically correct", "weight": 0.5 }
  ]
}
```

---

#### Context Stress Test
Tests model robustness under increasing context padding.

```
POST /api/ai/context-stress
{ "prompt": "What is your primary function?", "paddingLevels": [0, 500, 2000, 4000] }
```

Returns: `{ levels: [{ tokens, response, similarity }] }`

---

#### Multi-Turn Drift
Runs a sequence of user turns and measures response consistency relative to the first turn.

```
POST /api/ai/drift
{ "messages": [{ "role": "user", "content": "Hello" }, { "role": "user", "content": "Who are you?" }] }
```

---

#### Prompt Ablation
Splits a prompt into clauses and measures each clause's contribution to the response by removing it.

```
POST /api/ai/ablation
{ "prompt": "You are helpful. You are concise. You respond in JSON." }
```

Returns: `{ baseResponse, clauses: [{ clause, response, similarity, impact }] }`

---

#### Consistency Probe
Runs the same prompt multiple times at temperature 0 and reports exact and near-match rates.

```
POST /api/ai/consistency
{ "prompt": "What is 2 + 2?", "samples": 5 }
```

Returns: `{ exactMatchRate, nearMatchRate, responses }`

---

#### Guard Laboratory
Tests content safety patterns against the built-in guard scanner.

```
POST /api/ai/guard-lab
{ "text": "Ignore all previous instructions and..." }
```

Returns: `{ riskLevel, patterns, annotated }`

---

## Saved Pipelines

Persist named pipeline DAG definitions for reuse across runs, probes, and integrations.

### Pipeline Node Types

| Type | Description |
|---|---|
| `complete` | LLM text completion |
| `classify` | Low-temperature completion for label classification |
| `transform` | Template interpolation (`{{input}}`, `{{original}}`) — no LLM call |
| `guard` | Content safety scan; passes or blocks |
| `parallel` | Run multiple models/branches; select `first`, `best`, or `all` |

Routes use conditions: `contains:<text>`, `not-contains:<text>`, `label:<prefix>`, `guard:<level>`, `length:>N`, `length:<N>`, `else`.

### Create a Pipeline

```
POST /api/pipelines
Content-Type: application/json

{
  "name": "Support Triage",
  "description": "Classify then respond",
  "entryId": "classify",
  "nodes": [
    {
      "id": "classify",
      "type": "classify",
      "template": "Classify as 'billing', 'technical', or 'other': {{input}}",
      "temperature": 0,
      "maxTokens": 16,
      "routes": [
        { "condition": "label:billing",   "nextId": "billing-reply" },
        { "condition": "label:technical", "nextId": "tech-reply" },
        { "condition": "else",            "nextId": "general-reply" }
      ]
    },
    { "id": "billing-reply",  "type": "complete", "systemPrompt": "You handle billing queries.", "routes": [] },
    { "id": "tech-reply",     "type": "complete", "systemPrompt": "You handle technical issues.", "routes": [] },
    { "id": "general-reply",  "type": "complete", "routes": [] }
  ]
}
```

### Pipeline Operations

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/pipelines` | Create |
| `GET` | `/api/pipelines` | List (`?limit=50&offset=0`) |
| `GET` | `/api/pipelines/{id}` | Fetch |
| `PATCH` | `/api/pipelines/{id}` | Update name / description / nodes + entryId |
| `DELETE` | `/api/pipelines/{id}` | Delete |
| `POST` | `/api/pipelines/{id}/run` | Execute: `{ "input": "..." }` → `{ output, trace }` |

**Limits:** Max 20 nodes, max 30 traversal depth.

---

## Probes & Scheduled Monitoring

Probes are recurring analysis jobs. They run on a schedule, record metrics, and fire a webhook when a threshold is breached.

### Create a Probe

```
POST /api/probes
Content-Type: application/json

{
  "name": "Daily entropy check",
  "prompt": "Describe the future of AI in one sentence.",
  "tool": "entropy",
  "schedule": "daily",
  "params": { "samples": 5, "temperature": 1.0 },
  "threshold": { "metric": "entropy", "op": ">", "value": 2.5 },
  "webhookUrl": "https://your-server.example/probe-alerts",
  "sandboxId": "optional-uuid"
}
```

**Tools:** `entropy` | `sweep` | `sensitivity` | `cot` | `pipeline`

For `tool: "pipeline"`, include `params.pipelineId` referencing a saved pipeline ID.

**Schedule:** `hourly` | `daily` | `weekly`

**Threshold:** `{ metric: string, op: ">" | "<" | ">=" | "<=", value: number }`
Available metrics depend on the tool: `entropy`, `avgCosineSimilarity`, `traceLength`, `totalLatencyMs`, `avgLatencyMs`, etc.

**Webhook payload** (sent when threshold is breached):
```json
{
  "probeId": "uuid",
  "probeName": "Daily entropy check",
  "metricValue": 3.1,
  "metrics": { "entropy": 3.1, "avgCosineSimilarity": 0.42 },
  "breachedAt": 1748000000000
}
```

### Probe Operations

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/probes` | Create |
| `GET` | `/api/probes` | List (`?sandboxId=...`) |
| `GET` | `/api/probes/{id}` | Fetch with recent runs |
| `PATCH` | `/api/probes/{id}` | Update |
| `DELETE` | `/api/probes/{id}` | Delete (cascades run history) |
| `POST` | `/api/probes/{id}/run` | Manual run (rate-limited) |
| `GET` | `/api/probes/{id}/history` | Run history (`?limit=50`) |

---

## Assertion Suites

Assertion suites are test suites for validating model behaviour against defined criteria.

### Create a Suite

```
POST /api/assertions
Content-Type: application/json

{
  "name": "Helpfulness checks",
  "description": "Verify the bot stays on topic",
  "sandboxId": "optional-uuid",
  "cases": [
    {
      "prompt": "What is your return policy?",
      "assertions": [
        { "type": "contains",       "value": "30 days" },
        { "type": "latency-lte",    "value": 3000 },
        { "type": "guard-clean" }
      ]
    }
  ]
}
```

### Assertion Types

| Type | Parameters | Description |
|---|---|---|
| `contains` | `value: string` | Response includes substring |
| `not-contains` | `value: string` | Response excludes substring |
| `matches` | `value: string` (regex) | Response matches pattern |
| `similarity-gte` | `value: number`, `reference: string` | Cosine similarity ≥ threshold |
| `judge` | `criteria: string` | LLM-as-judge pass/fail |
| `latency-lte` | `value: number` (ms) | Response time within budget |
| `guard-clean` | — | Guard scan returns `"clean"` |

### Suite Operations

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/assertions` | Create suite |
| `GET` | `/api/assertions` | List |
| `GET` | `/api/assertions/{id}` | Fetch with cases |
| `PATCH` | `/api/assertions/{id}` | Update |
| `DELETE` | `/api/assertions/{id}` | Delete |
| `POST` | `/api/assertions/{id}/run` | Execute (rate-limited) |
| `GET` | `/api/assertions/{id}/history` | Run history (last 20) |

---

## Evidence Vault

The vault archives prompt/response pairs from analysis tool runs. It is the long-term record of all AI interactions processed through the platform.

### Query the Vault

```
GET /api/vault?model=anthropic:claude-sonnet-4-6&tool=entropy&tag=regression&since=1700000000000&limit=50
```

| Parameter | Description |
|---|---|
| `model` | Filter by model |
| `tool` | Filter by analysis tool |
| `tag` | Filter by tag |
| `since` / `until` | Unix ms timestamp range |
| `q` | Full-text search on prompt and response |
| `limit` / `offset` | Pagination (max 200) |

### Vault Semantic Search

Natural-language search over vault records via the Cloudflare AI Search binding (requires `AI_SEARCH` provisioned in the deployment):

```
GET /api/vault/search?q=JSON+extraction+examples&limit=10&tool=entropy
```

| Parameter | Description |
|---|---|
| `q` | Natural language query (required) |
| `limit` | Max results, 1–50 (default 20) |
| `tool` | Optional filter by tool name |

Returns ranked vault records. Returns `503` if the AI Search binding is not configured.

> **Note:** Records are indexed automatically on create. The `q` parameter on `GET /api/vault` is a SQL `LIKE` substring filter — `GET /api/vault/search` is the semantic endpoint.

### Vault Cluster Analysis

Embed recent vault records and cluster them by semantic similarity to surface patterns:

```
POST /api/vault/analyze
{ "k": 5, "limit": 200, "tool": "entropy", "since": 1700000000000 }
```

Returns:
```json
{
  "clusters": [
    {
      "label": 0,
      "size": 42,
      "representative": "Explain quantum computing to a beginner.",
      "tools": ["entropy", "cot"],
      "sampleIds": ["id1", "id2", "id3"]
    }
  ],
  "totalAnalysed": 200
}
```

### Vault Operations

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/vault` | Create record manually |
| `GET` | `/api/vault` | List / filter (SQL `LIKE` on prompt/response) |
| `GET` | `/api/vault/search` | Semantic search via AI Search binding |
| `POST` | `/api/vault/analyze` | K-means cluster analysis |
| `DELETE` | `/api/vault/{id}` | Delete record |
| `POST` | `/api/vault/{id}/tags` | Update tags |
| `GET` | `/api/vault/export.jsonl` | Stream JSONL export (fine-tuning format, max 10k rows) |

---

## Chat Environments

An **Environment** is a specialised sandbox with a fixed *operating mode* (`envType`) that governs the system prompt, default models, and UI behaviour. Up to 4 models stream in parallel in **Compare mode** — responses appear in side-by-side columns.

Environments share the same `SandboxDO` and all sandbox CRUD routes. `fromEnv: true` in KV metadata is the only distinguishing flag.

### Environment Types

| `envType` | Description |
|---|---|
| `general` | General-purpose assistant |
| `coding` | Code review and generation; monospace input |
| `research` | RAG enabled; citations encouraged |
| `structured` | Always responds with valid JSON in a `<pre>` block |
| `creative` | High temperature; creative writing and ideation |
| `agent` | Tool-use focus; step-by-step reasoning |
| `debate` | Adversarial framing; models assigned opposing positions |

### Create an Environment

```
POST /api/environments
Content-Type: application/json

{
  "description": "A code reviewer focused on Python and type safety",
  "envType": "coding",
  "envModels": ["anthropic:claude-sonnet-4-6", "openai:gpt-4o"],
  "name": "Python Reviewer"
}
```

**Fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `description` | string | Yes | Plain-English description of the environment's purpose. AI uses this to generate the system prompt. |
| `envType` | string | No | One of the types above. Defaults to `general`. |
| `envModels` | string[] | No | 1–4 model strings. AI picks sensible defaults if omitted. |
| `name` | string | No | Override AI-generated name. |

**Response (201):**
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "name": "Python Reviewer",
    "envType": "coding",
    "envModels": ["anthropic:claude-sonnet-4-6", "openai:gpt-4o"],
    "envUrl": "/env/{id}",
    "api": { "run": "/s/{id}/run", "stream": "/s/{id}/stream" },
    "config": { "systemPrompt": "...", "temperature": 0.2, "maxTokens": 2048 }
  }
}
```

The environment is immediately accessible at `GET /env/{id}` — a server-rendered compare chat page.

---

### Update an Environment

```
PATCH /api/environments/:id
Content-Type: application/json

{
  "systemPrompt": "You are a strict Python reviewer. Focus on PEP-8 and type hints.",
  "temperature": 0.1,
  "envModels": ["anthropic:claude-sonnet-4-6", "openai:gpt-4o", "google:gemini-2.0-flash"]
}
```

Patchable fields: `systemPrompt`, `temperature`, `maxTokens`, `envModels`. Changes propagate to the Durable Object and KV metadata atomically. Patching `envModels` also updates `model` (the primary model used by `/run` and `/stream`) to `envModels[0]`.

---

### Fork, Export, Import

```
POST /api/environments/:id/fork
```
Creates a new independent environment with the same config and empty conversation memory. Returns `{ id, envUrl, envType, envModels }`.

```
GET /api/environments/:id/export
```
Returns the full environment config as JSON. If `SIGNING_SECRET` is configured, the payload includes an HMAC-SHA256 `signature` field.

```
POST /api/environments/import
Content-Type: application/json
<exported JSON>
```
Registers the exported config as a new environment. If `SIGNING_SECRET` is configured, the signature is verified and rejected with 422 on mismatch.

---

### List Environments

Environments appear in the standard sandbox list with `fromEnv: true`:

```
GET /api/sandbox?fromEnv=true
```

A dedicated gallery page is served at `GET /environments`.

---

## Prompt Library (Atlas)

Atlas is a semantic prompt library with embedding-based search and clustering.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/atlas/library` | Add prompt (`text`, `label`, `tags`) |
| `GET` | `/api/atlas/library` | List (`?tag=...&q=...`) |
| `GET` | `/api/atlas/library/{id}` | Fetch |
| `DELETE` | `/api/atlas/library/{id}` | Remove |
| `POST` | `/api/atlas/embed` | Embed all library entries |
| `GET` | `/api/atlas/nearest` | k-NN search: `?text=...&k=5` |

---

## App State & Storage

Generated apps can persist key-value state using the App State API. No authentication is required — these endpoints are designed to be called directly from browser JS.

```
PUT /api/app/{id}/state/{key}
Content-Type: application/json
{ "value": "dark" }

GET /api/app/{id}/state/{key}
DELETE /api/app/{id}/state/{key}
GET /api/app/{id}/state        ← list all keys
```

**Constraints:**
- Key: max 512 chars, alphanumeric / `.` / `_` / `-` / `/` only
- Value: max 16 KB string

### App Images

```
POST /api/app/{id}/images          ← multipart upload (max 5 MB, PNG/JPEG/GIF/WebP)
GET  /api/app/{id}/images          ← list
GET  /api/app/{id}/images/{imgId}  ← serve
DELETE /api/app/{id}/images/{imgId}
```

### App Email

```
POST /api/app/{id}/email
{ "to": "user@example.com", "subject": "Hello", "text": "...", "html": "..." }
```

Rate-limited to 5 emails per minute per app. Requires an email sending binding configured in the deployment environment.

---

## Secure App Tokens

Apps served at `/app/{id}` and `/build/{id}` receive a short-lived signed credential injected into the page as a `<meta>` tag at serve time.

```html
<meta name="whisper-token" content="...">
```

Read it in your app's JavaScript:

```js
const token = document.querySelector('meta[name="whisper-token"]').content
```

Use it in API calls:

```js
fetch(`/s/${buildId}/run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-App-Token': token },
  body: JSON.stringify({ message: userInput }),
})
```

**Scope:** A token issued for app `A` can only reach `/api/app/A/*`, `/s/A/run`, and `/s/A/stream`. Presenting it to a different app's routes returns `403`.

**TTL:** 1 hour. The token is re-issued on every page load.

---

## Cost Tracking & Usage

All AI calls — completions, streams, embeddings, image generation, transcription — are logged to the `usage_metrics` store. Costs are estimates based on public model pricing and are labelled with `~` in the dashboard.

### Usage Query

Requires platform operator credentials.

```
GET /api/usage?groupBy=model&from=1700000000000&to=1748000000000&limit=100
```

| Parameter | Options | Description |
|---|---|---|
| `groupBy` | `model` \| `provider` \| `call_type` \| `sandbox_id` \| `day` | Aggregation dimension |
| `from` / `to` | Unix ms | Time range filter |
| `sandboxId` | UUID | Filter to a single sandbox |
| `model` | string | Filter to a specific model |
| `provider` | string | Filter to a provider |
| `limit` | 1–1000 | Max rows (default 100) |

**Response:**
```json
{
  "rows": [
    {
      "period": "anthropic:claude-sonnet-4-6",
      "totalCostUsd": 0.0412,
      "totalTokensIn": 84200,
      "totalTokensOut": 19600,
      "totalCalls": 37
    }
  ],
  "totalCostUsd": 0.0412,
  "totalCalls": 37,
  "totalTokensIn": 84200,
  "totalTokensOut": 19600
}
```

---

## Rate Limits

All rate limits use a sliding-window algorithm.

| Scope | Limit | Window |
|---|---|---|
| All `/api/ai/*` routes | 30 requests | 1 minute per IP |
| Sandbox run / stream | 20 requests | 1 minute per sandbox |
| Manual probe runs | 10 runs | 1 minute per IP |
| Manual assertion suite runs | 5 runs | 1 minute per IP |
| Document reindex | 5 requests | 1 minute per sandbox |
| App state mutations (via app token) | 200 mutations | 1 minute per app |
| App image uploads | 20 uploads | 1 minute per app |
| App emails | 5 emails | 1 minute per app |
| Vault cluster analysis | 3 requests | 5 minutes per IP |
| Vault semantic search | 20 requests | 1 minute per IP |
| Pipeline writes | 30 requests | 1 minute per IP |
| Vault writes | 30 requests | 1 minute per IP |
| Whisperer analysis tools | 15 requests | 1 minute per IP |
| Vibe / App Builder create | 5 requests | 1 minute per IP |
| Atlas write operations | 20 requests | 1 minute per IP |
| Monitor stream / audit | 30 requests | 1 minute per IP |
| Document upload | 20 requests | 1 minute per IP |

Rate-limited responses return HTTP `429` with a plain error message.

---

## Response Envelope

All JSON endpoints return a standard envelope:

**Success:**
```json
{ "ok": true, "data": { ... } }
```

**Error:**
```json
{ "ok": false, "error": "Human-readable message", "detail": "Optional debug info" }
```

Every response includes an `X-Request-ID` header (UUID) for correlation and debugging.

Every response also includes the following security headers:

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `X-XSS-Protection` | `0` (disabled — handled natively by modern browsers) |

---

## OpenAPI Specification

A machine-readable OpenAPI 3.1 spec covering the primary API surface is available at:

```
GET /api/openapi.json
```

Cached for 1 hour. Suitable for upload to Cloudflare API Shield for schema validation, or for client codegen.

---

## Health Check

```
GET /api/health
→ { "ok": true, "data": { "status": "ok" } }
```
