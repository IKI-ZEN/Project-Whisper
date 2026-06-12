# Cloudflare Email Service — Reference

Cloudflare Email Service provides two complementary capabilities for Workers: a `[[send_email]]` binding for sending outbound email programmatically, and an `email()` Worker handler for receiving and processing inbound email. The two work independently and can coexist.

> **Availability**: Outbound sending requires a paid Workers plan. Inbound routing (Email Routing) is available on Free and Paid plans.

---

## Table of Contents

1. [Outbound Email (`[[send_email]]` binding)](#1-outbound-email-send_email-binding)
2. [Inbound Email (`email()` Worker handler)](#2-inbound-email-email-worker-handler)
3. [How It Relates to Project Whisper](#3-how-it-relates-to-project-whisper)
4. [Pending Actions](#4-pending-actions)
5. [Further Reading](#5-further-reading)

---

## 1. Outbound Email (`[[send_email]]` binding)

### Configuration

```toml
# wrangler.toml
[[send_email]]
name = "SEND_EMAIL"
```

### Usage

```typescript
await env.SEND_EMAIL.send({
  to:      'user@example.com',
  from:    'noreply@yourdomain.com',
  subject: 'Alert from Whisper',
  text:    'Probe threshold breached.',
  html:    '<p>Probe threshold breached.</p>',
})
```

The `from` address must match a verified sender in Cloudflare Email Routing. The `to` address is unrestricted.

### Type

The official type is `SendEmail` from `@cloudflare/workers-types`. Project Whisper currently uses hand-rolled `SendEmailBinding` / `SendEmailMessage` interfaces — functionally equivalent but not aligned with the official type, so future CF type changes would be invisible to `tsc`.

---

## 2. Inbound Email (`email()` Worker handler)

### What it is

An `email()` export on the Worker default export — analogous to `fetch()`, `scheduled()`, and `queue()`. Cloudflare Email Routing delivers an inbound email to the Worker; the Worker can parse it, reply, forward it, or reject it.

### Handler signature

```typescript
export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const from    = message.from          // sender address
    const to      = message.to            // recipient address (your routing address)
    const raw     = message.raw           // ReadableStream — raw RFC-2822 bytes
    const headers = message.headers       // Headers object — pre-parsed

    // Options:
    await message.forward('other@example.com')  // re-route to another address
    await message.reply(replyMsg)               // send a reply (ForwardableEmailMessage)
    message.setReject('Not accepting email')    // bounce with an NDR
  },
}
```

### `[[email]]` binding in wrangler.toml

The routing binding is separate from `[[send_email]]`:

```toml
[[email]]
name    = "EMAIL"
# No additional fields needed — Cloudflare Email Routing config maps addresses to the Worker
```

---

## 3. How It Relates to Project Whisper

### Current state

| Component | Status |
|-----------|--------|
| `[[send_email]]` in `wrangler.toml` | Present — `name = "SEND_EMAIL"` |
| `env.d.ts` `SEND_EMAIL` type | Hand-rolled `SendEmailBinding`/`SendEmailMessage` (not official `SendEmail` type) |
| `src/routes/appstate.ts` `sendEmail` | Uses `SEND_EMAIL.send()` — call site correct, type is stale |
| `email()` Worker handler | Not implemented |
| `[[email]]` binding in `wrangler.toml` | Not present |
| `WhisperJob` inbound email type | Not present |

### Outbound (working today)

`POST /api/app/:id/send-email` in `src/routes/appstate.ts` sends transactional email from app instances. The `SEND_EMAIL.send()` call is correct; the only issue is the hand-rolled type rather than the official `SendEmail` type.

### Inbound (architecture opportunity)

The `email()` handler enables email as an interaction mode for sandboxes — a user emails `sandbox@yourdomain.com`, the Worker routes it to a sandbox run, and replies with the AI response. No UI required.

```
email() handler
  → extract subject + body from message.raw
  → doFetch(stub(env, sandboxId), 'run', 'POST', { prompt: parsedBody })
  → SEND_EMAIL.send() reply to message.from
```

**Async variant (recommended):** Route the inbound email into `JOB_QUEUE` as a new `'email_inbound'` job type — keeps the `email()` handler fast (no AI latency in the critical path) and follows the existing async job pattern:

```typescript
async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
  await env.JOB_QUEUE.send({
    type:      'email_inbound',
    sandboxId: routeSandboxId(message.to),
    payload:   { from: message.from, subject: message.headers.get('subject'), body: '...' },
    createdAt: now(),
  })
}
```

**Probe breach alerts via email:** An `alertEmail` field on a probe (alongside `webhookUrl`) would send a human-readable plaintext alert to an on-call address when the threshold is breached — no receiver server needed on the operator's side.

**Security note:** Any public-facing inbound email handler is a prompt injection surface. See `docs/cloudflare-security-center.md` — [Email Security](#5-email-security-cloudflare-one--area-1) for the upstream defence layer (Cloudflare One / Area 1). The existing 5-layer guard pipeline handles downstream normalisation and injection detection.

---

## 4. Pending Actions

### Immediate (type safety, no behaviour change)

1. Replace hand-rolled `SendEmailBinding` / `SendEmailMessage` in `src/types/env.d.ts` with the official `SendEmail` type from `@cloudflare/workers-types`. Requires confirming that the installed version of `@cloudflare/workers-types` exposes `SendEmail`; if not, a version bump is needed first.

### Medium-term (new features)

2. Add `'email_inbound'` to the `WhisperJob` union in `src/types/env.d.ts`.
3. Add `email()` handler to the Worker default export in `src/index.ts` — queue the inbound message as a `WhisperJob` for async processing.
4. Add `[[email]]` binding to `wrangler.toml` with the configured routing address.
5. Add `processEmailInbound` in `src/jobs/` following the `processFile` / `processEmbeddingBatch` pattern.
6. Add optional `alertEmail?: string` field to the probe schema (D1 migration + `src/lib/schema.ts` parser) for human-readable breach alerts alongside `webhookUrl`.

### Open questions

- What is `EmailMessage.raw`'s stream encoding — UTF-8 MIME, or raw RFC-2822 bytes with headers included?
- What are the size limits on inbound email body passed to the Worker?
- Can `message.reply()` be used when the original sender is an external (non-CF-verified) address?
- Is the `[[email]]` binding available on the Free plan?
- Does `message.setReject(reason)` emit an NDR or silently drop?

---

## 5. Further Reading

- **Email Routing overview**: `https://developers.cloudflare.com/email-routing/`
- **Email Workers**: `https://developers.cloudflare.com/email-routing/email-workers/`
- **Send Email binding**: `https://developers.cloudflare.com/workers/runtime-apis/bindings/send-email/`
- **Related security layer**: `docs/cloudflare-security-center.md` — Email Security section
