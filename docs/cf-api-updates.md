# Cloudflare API Updates — Working Notes

Scratch pad for reasoning through new CF documentation as it arrives.
Each entry records: what changed, what it breaks or enables in Project Whisper, and the recommended action.

---

## AI Search — Namespaces

**Source:** CF Namespaces docs (supplied 2026-06-11)
**Affects:** `src/types/env.d.ts`, `src/routes/vault.ts`, `src/routes/atlas.ts`, `wrangler.toml`

### What changed

1. **`search()` signature** — Old: `{ query: string; limit?: number; filters?: Record<string, string> }`.
   New: `{ messages: Array<{ role: string; content: string }> }`.
   It is now conversation-aware; the query is a messages array, not a plain string.

2. **New instance methods** — `chatCompletions()`, `info()`, `stats()`, `items` — none of these existed in the previous binding shape typed in `env.d.ts`.

3. **New namespace binding type** — `ai_search_namespaces` in `wrangler.toml`. Gives access to a *namespace handle*, not a single instance. Instances are resolved lazily via `env.AI_SEARCH.get("instance-name")`. Namespace-level operations: `list()`, `create()`, `delete()`.

4. **Direct instance binding** — `ai_search` (existing key, new semantics) binds to one pre-existing instance per entry. No `get()` call needed, but no `list()`/`create()`/`delete()` either.

5. **Minimum package versions required** — `@cloudflare/workers-types >= 4.20260304.0`, `wrangler >= 4.68.1`.

### What this breaks in Project Whisper

| Location | Issue |
|----------|-------|
| `src/types/env.d.ts:90-94` | `AI_SEARCH` typed with old `search({ query, limit, filters })` shape — wrong signature |
| `src/routes/vault.ts` — `search` handler | Calls `env.AI_SEARCH.search({ query: q, limit, filters })` — will break when binding upgrades |
| `src/routes/atlas.ts` — `nearest` handler | Same old `search()` signature |
| `wrangler.toml` | `ai_search` binding may need version bump in `@cloudflare/workers-types` |

The failure is silent: TypeScript will type-check against the stale interface in `env.d.ts` without error until `env.d.ts` is updated, but the runtime call will throw when the new binding rejects the old shape.

### What this enables for Project Whisper

**Per-sandbox AI Search instances (namespace model)**
Today the shared `AI_SEARCH` binding stores all vault records and atlas prompts in one flat index, scoped only by metadata filters (`{ tool, environment_id }`). The namespace binding allows:
- `env.AI_SEARCH.get(sandboxId)` — one index per sandbox
- True data isolation: a sandbox's RAG results cannot surface another sandbox's documents
- `create()` on sandbox creation, `delete()` on sandbox deletion — lifecycle matches the sandbox lifecycle

**`chatCompletions()` replaces the manual RAG pipeline**
The current document RAG flow in `SandboxDO` is: embed query → Vectorize search → inject chunks → `complete()`. If the per-sandbox AI Search instance handles this natively via `chatCompletions({ messages })`, the Vectorize binding + manual chunk injection can be retired for the document grounding path.

**Conversation-aware vault search**
The `messages` array on `search()` means the vault search at `GET /api/vault/search` can pass the full conversation context (not just the last query), returning results relevant to the thread rather than the last message alone.

### Recommended actions

**Immediate (safe, no infrastructure change):**
1. Update `env.d.ts` — retype `AI_SEARCH` to match the new `ai_search` direct-instance shape:
   - `search({ messages: Array<{ role: string; content: string }>, limit?: number })`
   - Add `chatCompletions()`, `info()`, `stats()`
   - Remove the old `upsert()` / `delete()` if those moved elsewhere (confirm from CF docs)
2. Update `vault.ts` and `atlas.ts` call sites to use the new `messages` shape.

**Medium-term (requires infra change):**
3. Evaluate switching to `ai_search_namespaces` for per-sandbox isolation.
   - Requires: `wrangler.toml` binding change, `create()` call in sandbox-create handler, `delete()` call in sandbox-delete handler.
   - Migration: existing flat index data needs re-indexing per sandbox (can be done lazily on first search hit).

**Defer until `chatCompletions()` docs are available:**
4. Assess replacing the Vectorize + manual RAG pipeline with `chatCompletions()` on per-sandbox instances.
   - Depends on: latency, context window behaviour, whether it supports the system-prompt injection pattern currently used in `SandboxDO`.

### Open questions

- Does the new `ai_search` binding retain `upsert()` / `delete()`? Not shown in namespace docs — need to check instance methods doc.
- What is the `chatCompletions()` signature? Does it accept a `system` field?
- Is `items` a property (array) or a method? The docs list it alongside methods but show no call signature.
- What are the rate limits and per-instance storage caps at the plan level?

---

---

## Cloudflare Email Service

**Source:** CF Email Service overview doc (supplied 2026-06-11)
**Affects:** `src/types/env.d.ts`, `src/index.ts`, `src/routes/appstate.ts`, `wrangler.toml`

### Current state in Project Whisper

- `env.d.ts` defines two hand-rolled interfaces: `SendEmailMessage` and `SendEmailBinding`. The `Env.SEND_EMAIL` field is typed against these custom shapes rather than the official `SendEmail` type from `@cloudflare/workers-types`.
- `wrangler.toml` already has `[[send_email]]` with `name = "SEND_EMAIL"` — the binding config is correct.
- The only use site is `src/routes/appstate.ts:sendEmail` — outbound email from apps via `SEND_EMAIL.send()`.
- `src/index.ts` exports `fetch`, `scheduled`, and `queue` handlers. There is no `email()` handler — inbound email is completely unhandled.
- `WhisperJob` in `env.d.ts` has union type `'ai_completion' | 'embedding_batch' | 'file_process' | 'replay'` — no inbound email job type.

### What the new docs confirm

1. **`send()` signature is unchanged.** `{ to, from, subject, html, text }` matches the existing `SendEmailMessage` shape exactly. No call site changes needed for outbound.

2. **The binding name for outbound sending is `send_email` / type `SendEmail`.** Project Whisper uses `send_email` in wrangler.toml correctly. The only issue is the hand-rolled type in `env.d.ts` rather than the official `SendEmail` type. tsc validates against the stub, not the real CF binding — if CF's type evolves, mismatches will be invisible.

3. **New inbound capability: the `email()` Worker handler.** Analogous to `fetch()` and `queue()` — a first-class export handler on the Worker default export. Not present in Project Whisper at all. Receives an `EmailMessage` object: `message.from`, `message.to`, `message.raw` (ReadableStream of raw RFC-2822 bytes), `message.forward(address)`, `message.reply(message)`, `message.setReject(reason)`.

4. **The `email` routing binding is separate from `send_email`.** `[[send_email]]` is for outbound. `[[email]]` is for registering inbound routing. Both can coexist. Project Whisper currently has neither `[[email]]` in wrangler.toml nor an `email()` handler.

5. **Queue integration is mentioned.** CF suggests routing inbound emails to Queues for async processing — fully compatible with the existing `JOB_QUEUE` / `queue()` handler pattern.

### What this breaks

Nothing. The outbound `send()` API is unchanged. The hand-rolled type mismatch is a latent risk but not an active failure.

### What this enables for Project Whisper

**Email-as-interaction-mode for sandboxes (highest value)**
The `email()` handler could route inbound email to a sandbox run. A user emails `sandbox@yourdomain.com` with a prompt; the handler calls `doFetch(stub(env, sandboxId), 'run', 'POST', { prompt: parsedBody })` and sends the AI reply back via `SEND_EMAIL.send()`. This makes every sandbox reachable via email with no UI dependency — useful for agent integrations, background assistants, and mobile-friendly AI interactions.

Pattern:
```
email() handler → extract subject+body → sandbox run → SEND_EMAIL.send() reply
```

Address routing options: a single catch-all address with sandbox ID in the subject line, or per-sandbox addresses provisioned via Cloudflare Email Routing rules.

**Probe breach alerts via email (complements webhooks)**
The webhook dispatch (`dispatchWebhook`) covers machine-to-machine alerting. Adding an email delivery path means a human on-call can receive a plaintext breach alert directly in their inbox — no receiver server needed. Could be a second channel on `dispatchWebhook` when `env.SEND_EMAIL` is configured and the probe has an `alertEmail` field.

**Async inbound processing via Queue**
Route the inbound `EmailMessage` raw stream into `JOB_QUEUE` as a new job type (`'email_inbound'`). The queue worker parses it, runs it through a sandbox, and dispatches the reply. This keeps the `email()` handler fast (no AI latency in the critical path) and follows the existing async job pattern.

```typescript
// In src/index.ts:
async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
  await env.JOB_QUEUE.send({
    type: 'email_inbound',
    sandboxId: routeSandboxId(message.to),
    payload: { from: message.from, subject: ..., body: ... },
    createdAt: now(),
  })
}
```

**Transactional flows: magic links, OTP**
Currently CF Access handles all auth. An email-based magic link or OTP flow would allow unauthenticated users to receive a time-limited sandbox link — useful for public-facing demos and sandboxes shared with external collaborators who don't have CF Access accounts.

### Recommended actions

**Immediate (no behaviour change, reduces type drift):**
1. Replace hand-rolled `SendEmailBinding` / `SendEmailMessage` in `env.d.ts` with the official `SendEmail` type from `@cloudflare/workers-types`. Check if `@cloudflare/workers-types` version in `package.json` exposes `SendEmail` — if not, a version bump is needed first.

**Medium-term (new feature):**
2. Add `'email_inbound'` to the `WhisperJob` union in `env.d.ts`.
3. Add `email()` handler to the Worker default export in `src/index.ts`.
4. Add `[[email]]` binding to `wrangler.toml` with a configured routing address.
5. Add `processEmailInbound` handler in `src/jobs/` following the `processFile` pattern.
6. Add `alertEmail?: string` field to the probe schema (D1 migration + parser) for human-readable breach alerts alongside webhooks.

### Open questions

- What is `EmailMessage.raw`'s stream encoding — UTF-8 MIME, or raw RFC-2822 bytes? Does it include headers in the stream or are they stripped?
- What are the size limits on inbound email body passed to the Worker? Large attachments could be a memory concern.
- Can `message.reply()` be used if the original sender is external (not a CF verified address)?
- Is the `[[email]]` binding available on the Free plan, or only Paid? The overview says Email Routing is "Free and Paid" but sending requires Paid.
- Does `message.setReject(reason)` bounce with an NDR, or silently drop?

---

_Entries added in chronological order as docs are supplied._
