# Cloudflare API Shield — Reference

Cloudflare API Shield identifies and addresses API vulnerabilities through discovery, schema validation, and abuse detection.

> **Availability**: Enterprise customers only (paid add-on). Exception: Mutual TLS and Endpoint Management are available on all plans.

---

## Table of Contents

1. [What It Is](#1-what-it-is)
2. [Core Features](#2-core-features)
3. [Availability by Plan](#3-availability-by-plan)
4. [How It Relates to Project Whisper](#4-how-it-relates-to-project-whisper)
5. [Further Reading](#5-further-reading)

---

## 1. What It Is

Modern APIs face problems that traditional WAF rules don't address: undocumented endpoints ("shadow APIs"), credential-stuffing against public routes, volumetric abuse targeting specific endpoints, and unusual usage sequences that signal reconnaissance. API Shield addresses these at the edge, before requests reach origin workers.

---

## 2. Core Features

### Security features

| Feature | Description |
|---------|-------------|
| **API Discovery** | Automatically discovers all API endpoints receiving traffic, including undocumented or forgotten routes. Builds an inventory without requiring OpenAPI specs. |
| **Schema Validation** | Upload an OpenAPI schema; API Shield enforces it on every request — blocking calls with missing required fields, wrong parameter types, or unexpected paths. |
| **Mutual TLS (mTLS)** | Require clients to present a certificate signed by a configured CA. Cloudflare validates the certificate at the edge before the request reaches the Worker. |
| **Volumetric Abuse Detection** | Rate limiting tuned per endpoint and per session, not just per IP. Detects bursts against specific routes (e.g., a login endpoint) that would be invisible to account-wide rate limits. |
| **Sequence Analytics** | Identifies request sequences that deviate from normal usage patterns — useful for detecting multi-step credential-stuffing or account-takeover flows. |

### Management and monitoring

| Feature | Description |
|---------|-------------|
| **Endpoint Management** | Lists all discovered endpoints, their traffic volumes, error rates, and latency. Available on all plans. |
| **Schema Validation UI** | Review schema validation violations and mismatches in the dashboard. |

---

## 3. Availability by Plan

| Feature | Free | Pro | Business | Enterprise |
|---------|------|-----|----------|------------|
| Endpoint Management | ✓ | ✓ | ✓ | ✓ |
| Schema Validation | ✓ | ✓ | ✓ | ✓ |
| Mutual TLS (Cloudflare-managed CA) | ✓ | ✓ | ✓ | ✓ |
| API Discovery | — | — | — | ✓ (add-on) |
| Volumetric Abuse Detection | — | — | — | ✓ (add-on) |
| Sequence Analytics | — | — | — | ✓ (add-on) |

Enterprise customers can access the full suite as a paid add-on. Non-contract preview access (full feature access with no metered fees) is available while in preview.

---

## 4. How It Relates to Project Whisper

Project Whisper exposes a REST API under `/api/` that processes AI completions, vault entries, sandbox operations, and pipeline execution. The API surface is wide and some endpoints (notably `POST /api/sandbox/:id/run`) are intentionally public.

### Immediately applicable (all plans)

- **Schema Validation** — upload an OpenAPI spec derived from `src/lib/schema.ts` parsers and enforce it at the Cloudflare edge, reducing malformed-request noise before it reaches the Worker.
- **Endpoint Management** — monitor which routes receive traffic and flag unexpected endpoint usage.
- **Mutual TLS** — for deployments where only known clients (CI, dashboards) should reach the API, mTLS provides a hard-auth layer independent of Cloudflare Access JWTs.

### Applicable if on Enterprise

- **API Discovery** — automatically surfaces any routes that receive traffic but are undocumented, including any leftover debug endpoints.
- **Volumetric Abuse Detection** — protect high-value endpoints like `POST /api/ai/complete` from per-endpoint burst abuse that the current rate limiter (KV-based, per-IP, per-route) already guards but edge-layer protection adds defence-in-depth.

### Not applicable

- Sequence Analytics requires sustained traffic and multi-step flow patterns. Most Project Whisper API flows are single-request (not multi-step session flows), so sequence-based detection adds little value at current traffic volumes.

---

## 5. Further Reading

- **Get started**: `https://developers.cloudflare.com/api-shield/get-started/`
- **API Discovery**: `https://developers.cloudflare.com/api-shield/security/api-discovery/`
- **Schema Validation**: `https://developers.cloudflare.com/api-shield/security/schema-validation/`
- **Mutual TLS**: `https://developers.cloudflare.com/api-shield/security/mtls/`
- **Volumetric Abuse Detection**: `https://developers.cloudflare.com/api-shield/security/volumetric-abuse-detection/`
- **Sequence Analytics**: `https://developers.cloudflare.com/api-shield/security/sequence-analytics/`
