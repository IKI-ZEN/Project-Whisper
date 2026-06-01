# Project Whisper

An AI platform harness built entirely on Cloudflare's edge infrastructure. Zero runtime npm dependencies — all routing, streaming, and serialisation use native Web Platform APIs.

---

## What It Is

Project Whisper is a self-hosted AI platform that runs as a single Cloudflare Worker. It provides a structured environment for building, evaluating, and operating AI-powered applications — without a framework, a build step, or a managed backend.

The design principle is minimal surface area: one deployment artifact, one config file, native platform primitives only.

---

## Core Capabilities

**Multi-provider AI routing** — route requests to Workers AI, OpenAI, Anthropic, or Google via a unified `provider:model-id` convention. Supports completions, streaming, embeddings, image generation, text-to-speech, and transcription.

**Sandboxed AI agents** — each sandbox is a Durable Object with persistent conversation memory, configurable system prompt, temperature, tool definitions, and an integrity fingerprint. Sandboxes are addressable, forkable, and exportable.

**App Builder** — describe an application in plain English and receive a complete multi-file web app (HTML, CSS, JS) streamed in real time. Supports vanilla, Alpine, React, Vue, Svelte, and Cloudflare Worker targets. Generated apps are served at a stable URL, deployable to Cloudflare Pages.

**Chat Environments** — AI-configured workspaces where the environment type (general, coding, research, structured, creative, agent, debate) governs model behaviour, system prompt, and UI rendering contract. Supports side-by-side multi-model comparison.

**Vibe Builder** — natural language → full sandbox configuration. Describe the assistant you want; the platform generates and deploys it.

---

## Research & Evaluation Suite

A set of tools for systematic AI model analysis, built on the same infrastructure:

- **Evidence Vault** — prompt/response dataset builder with semantic search, tag filtering, and JSONL export in OpenAI fine-tuning format
- **Replay Engine** — replay conversation sessions against alternative models or system prompts with per-turn similarity scoring
- **Model Assertions** — behaviour contract testing (contains, matches, similarity, judge, latency, guard-clean assertion types)
- **Semantic Atlas** — prompt library with embedding, k-means clustering, and nearest-prompt search
- **Scheduled Probes** — run evaluation tools on hourly/daily/weekly schedules with time-series results and webhook alerting
- **Prompt Pipelines** — declarative node-graph executor with per-node model routing, persisted to D1
- **Threat Monitor** — live stream of prompt injection guard events with pattern frequency analytics
- **Analysis endpoints** — chain-of-thought probing, entropy measurement, attractor archaeology, temperature sweep, multi-turn drift, prompt ablation, consistency scoring, rubric evaluation

---

## Technology

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (V8 isolates) |
| Persistent state | Durable Objects |
| Relational data | Cloudflare D1 (SQLite) |
| Key-value store | Cloudflare KV |
| Object storage | Cloudflare R2 |
| Vector search | Cloudflare Vectorize |
| AI inference | Cloudflare AI Gateway (23 providers) |
| Auth | Cloudflare Access (Zero Trust) |
| Language | TypeScript (strict mode, zero `any`) |

---

## Design Constraints

- No runtime npm dependencies
- No build step for the Worker itself
- All IDs are UUIDs; all external input is validated at the boundary
- Rate limiting on every write and AI endpoint
- Cryptographic config integrity (SHA-256 fingerprint per sandbox)
- HMAC-signed export/import for provenance verification
- Prompt injection guard with Unicode normalisation and base64 decode-and-rescan

---

## Status

Active development. Core platform stable. Research suite complete.

**Version:** 0.3.0  
**License:** Modified MIT — IKI-ZEN  
**Repository:** [github.com/IKI-ZEN/Project-Whisper](https://github.com/IKI-ZEN/Project-Whisper)
