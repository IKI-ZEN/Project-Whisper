# Security Policy

## Supported Versions

Only the latest commit on the `main` branch is supported. There are no versioned releases at this time. Security fixes are applied to `main` directly.

## Reporting a Vulnerability

Open a [GitHub Security Advisory](https://github.com/iki-zen/project-whisper/security/advisories/new) or contact the maintainers privately with the subject line:

```
SECURITY: [brief description]
```

Please do **not** open a public GitHub issue for security vulnerabilities. Public disclosure before a fix is in place puts all users at risk.

**What to expect:**

- Acknowledgement within **48 hours**.
- A fix or mitigation plan within **14 days** of acknowledgement.
- Credit in the fix commit (with a link to your profile or name of your choice), unless you prefer to remain anonymous — just say so in your report.

Include as much detail as you can: steps to reproduce, affected endpoint or component, and any proof-of-concept code. The more context you provide, the faster the issue can be triaged.

## Scope

**In scope:**

- Prompt injection bypass — evading the inbound guard pipeline (pattern matching, Unicode normalisation, base64 decode-and-rescan)
- Path traversal via R2 keys (sandbox documents, build files, app images)
- Authentication bypass of Cloudflare Access-protected mutation endpoints
- Rate limit bypass (per-IP AI routes, per-sandbox run/stream, per-app email, vault analyze)
- HMAC signature forgery on exported sandbox configs
- Durable Object storage corruption (SandboxDO, AppBuilderDO, AppStateDO)
- Server-side request forgery via probe `webhookUrl` field — any `https://` URL is accepted and posted to on threshold breach

**Out of scope:**

- Vulnerabilities in the Cloudflare Workers platform itself — report those directly to [Cloudflare](https://www.cloudflare.com/disclosure/)
- Social engineering attacks
- Denial-of-service / DDoS

## Security Features

Project Whisper includes a layered security subsystem:

- **Inbound guard pipeline** — every AI call passes through Unicode normalisation (NFKC + zero-width stripping), pattern matching against blocked/suspicious/secrets tables, and base64 decode-and-rescan to catch encoded evasion attempts
- **Integrity hashing** — SHA-256 fingerprint over sandbox config fields; tamper detection on every `GET /api/sandbox/:id`
- **HMAC-signed exports** — config export/import uses HMAC-SHA256 over a canonical field order; rejected if `SIGNING_SECRET` is set and the signature is absent or invalid
- **Cloudflare Access Zero Trust** — all state-mutation endpoints require a valid Access JWT when `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` are configured
- **Three-layer rate limiting** — per-IP on `/api/ai/*`, per-sandbox on run/stream, per-app on email sends; vault cluster analysis additionally limited to 3 requests per 5 minutes per IP
- **CSP headers with per-request nonces** — `script-src 'nonce-{nonce}'` on all HTML pages; violation reports written to D1
- **X-Request-ID traceability** — every response carries a UUID for correlating HTTP logs with D1 audit rows
- **Webhook URL validation** — probe `webhookUrl` is validated as an `https://` URL (max 512 chars) at creation/update time; outbound webhook POSTs use a 5 s `AbortSignal.timeout` and are fire-and-forget

For full implementation detail, see `ARCHITECTURE.md` (Security Subsystem section).
