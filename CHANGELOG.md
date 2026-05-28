# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.2.0] — 2026-05-28

### Added

- Threat Monitor — live SSE stream of guard flag events from `sandbox_events` with pattern frequency analytics (`GET /api/monitor/stream`, `/audit`, `/patterns`)
- Evidence Vault — prompt/response dataset builder with tags, filters, and streaming JSONL export in OpenAI fine-tuning format (`/api/vault`)
- Replay Engine — replay a conversation session against a different model or system prompt with per-turn cosine similarity scoring (`POST /api/replay`)
- Model Assertions — behaviour contract testing with 7 assertion types (`contains`, `not-contains`, `matches`, `similarity-gte`, `judge`, `latency-lte`, `guard-clean`) and pass/fail history (`/api/assertions`)
- Semantic Map (Atlas) — prompt library with embedding, k-means clustering, PCA-2D scatter plot, and nearest-prompt search (`/api/atlas`)
- Cron Whisper (Probes) — scheduled whisperer tool runs (entropy, sensitivity, CoT, sweep) on hourly/daily/weekly cron triggers with time-series results (`/api/probes`)
- D1 migrations 0004–0007 for probes, vault, assertion suites/runs, and prompt library tables
- GPL v3 `LICENSE` file and SPDX headers on all source files

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
- Aether-Lite browser SDK (`public/vibe-sdk.js`): `AetherLiteClient`, `AppBuilder`, `AppHandle`, `AppStateHandle`, `SandboxConnection`, and `<aether-lite-chat>` web component
- GitHub Actions type-check workflow (`.github/workflows/typecheck.yml`)
