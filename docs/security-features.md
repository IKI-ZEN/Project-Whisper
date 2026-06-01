# Security Features

User-facing security controls in Project Whisper. All of these are **opt-in and
non-blocking by default** — the adversarial research suite (Whisperer tools, raw
`/api/ai/*` primitives) is never force-scanned, so prompt archaeology, entropy
probing, and the Guard Laboratory keep full traversal.

---

## Output guard (sandbox chat)

Each sandbox has a `guardOutput` policy applied to the model's **reply** on the
`/run` and `/stream` paths:

| Mode | Behaviour |
|------|-----------|
| `off` | No output scan |
| `audit` *(default)* | Scan and log a `response_flag` event; reply unchanged |
| `block` | If a blocked-level pattern fires, the reply is withheld |
| `redact` | Leaked API-secret spans are masked with `[REDACTED:secret]` |

Set it at create time or via `PATCH /api/sandbox/:id`:

```json
{ "guardOutput": "redact", "redactPiiOutput": true }
```

**Streaming limitation.** SSE token bytes are never mutated mid-stream, so on the
`/stream` path `block`/`redact` degrade to audit: the accumulated text is scanned
at stream end and logged with `streamLimitation: true`. Use `/run` when you need
the reply to be actually blocked or redacted.

`redactPiiOutput` (default `false`) additionally redacts PII (see below) from
replies. It is independent of `guardOutput` and off by default so researchers
keep raw output.

---

## PII detection & redaction

`POST /api/ai/pii-scan` detects and optionally redacts personal data. Detected
types: `email`, `credit_card` (Luhn-validated), `ssn`, `phone`, `ipv4`.

```bash
curl -X POST /api/ai/pii-scan \
  -H 'Content-Type: application/json' \
  -d '{ "text": "mail me at a@b.com, card 4242 4242 4242 4242", "redact": true }'
```

```json
{
  "ok": true,
  "data": {
    "matches": [
      { "type": "email", "start": 11, "end": 18, "description": "Email address" },
      { "type": "credit_card", "start": 25, "end": 44, "description": "Payment card number (Luhn-valid)" }
    ],
    "count": 2,
    "redacted": "mail me at [REDACTED:email], card [REDACTED:credit_card]",
    "counts": { "email": 1, "credit_card": 1 }
  }
}
```

Pass `"types": ["email", "ssn"]` to restrict the scan.

---

## Outbound webhook signing

When `SIGNING_SECRET` is configured, probe breach-alert webhooks are signed so
receivers can verify authenticity:

```
X-Whisper-Timestamp: 1700000000000
X-Whisper-Signature: v1,sha256=<hex hmac>
```

The signature is `HMAC-SHA256(secret, "${timestamp}.${rawBody}")`. Verify on the
receiver:

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(rawBody, headers, secret) {
  const ts  = headers['x-whisper-timestamp']
  const sig = headers['x-whisper-signature']            // "v1,sha256=<hex>"
  const hex = sig.split('sha256=')[1] ?? ''
  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')
  const a = Buffer.from(hex), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

Optionally reject timestamps outside an acceptable skew window to limit replay.

---

## Email content scanning

`POST /api/app/:id/email` always scans subject + text + html before sending
(email is an abuse vector, not a research path):

- **blocked** content → `422`, logs an `email_blocked` event
- **suspicious** content → sent, logs an `email_flagged` event

---

## Security posture report

`GET /api/sandbox/:id/security` returns a read-only summary aggregating existing
data — no new storage:

```json
{
  "ok": true,
  "data": {
    "integrity":        { "hashPresent": true, "tampered": false },
    "guard":            { "input": "strict", "output": "audit", "redactPii": false },
    "encryptionAtRest": true,
    "events":           { "guard_flag": 3, "response_flag": 1 },
    "windowMs":         604800000
  }
}
```

`encryptionAtRest` reflects whether `SIGNING_SECRET` is set (system prompts are
sealed with AES-GCM at rest when it is). `events` counts security events over the
last 7 days.

---

## Rate-limit headers

`429` responses include `Retry-After` (seconds) plus `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, and `X-RateLimit-Reset` (unix seconds) so clients can
back off precisely.

---

## Indirect injection & residual risks

Defense-in-depth on the sandbox chat path for vectors the LLM call itself can't
see. All of these are scoped to sandbox chat — the research suite and the vault
are never affected.

- **RAG context sanitization.** Retrieved document chunks are untrusted: a doc
  indexed earlier can carry an injection that only fires on retrieval. Chunks are
  scanned before being concatenated into the prompt. In strict mode a chunk with
  a blocked-level pattern is dropped (the turn still proceeds with the remaining
  context); in audit it is kept but recorded. An `rag_flag` event logs matched
  pattern names only — never the raw injected text.
- **Tool-output guard.** `run_code` results are masked for leaked secrets and, on
  blocked-level patterns in strict mode, withheld before they re-enter the model's
  context — so a tool can't smuggle an injection or a credential into the next
  turn. Logs `tool_result_flag`.
- **Audit-log redaction.** The flagged-input previews stored in `sandbox_events`
  are the content most likely to contain a secret or PII. They are masked and
  redacted before storage. The research vault is deliberately left raw.

### Known limits (honest scope)

- **Multi-turn jailbreaks.** The guard scans each message independently; a
  slow-burn attack that is benign per message can still get through. The
  `drift` and `consistency` research tools are the intended detection signal for
  trajectory-level manipulation — the guard does not claim to cover it.
- **Semantic / novel injection.** The guard is pattern-based and will miss
  paraphrased attacks. A future option is to layer the Cloudflare AI Gateway's
  Llama Guard as a semantic second opinion in front of the regex guard; it would
  be opt-in and disabled for research endpoints to preserve adversarial traversal.
