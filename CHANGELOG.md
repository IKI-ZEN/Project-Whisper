# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

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
