# Security Audit — Project Whisper

**Audit date:** 2026-05-31  
**Scope:** Full codebase review — `src/**/*.ts`, `public/tools.html`, `wrangler.toml`, `.dev.vars.example`  
**Status:** Code fixes applied — SEC-03, SEC-04, SEC-05, SEC-08 resolved; SEC-01/SEC-06 require deployment config

---

## Findings Summary

| ID | Severity | Area | Title | Status |
|----|----------|------|-------|--------|
| SEC-01 | CRITICAL | Auth | CF Access is optional — full auth bypass when env vars absent | Open |
| SEC-02 | HIGH | Code execution | `eval` via `new Function()` in SandboxDO with no memory limit | Open |
| SEC-03 | HIGH | SSRF | Webhook URL allows private IP ranges (10.x, 172.16.x, 192.168.x) | **Fixed** |
| SEC-04 | HIGH | Rate limiting | `Content-Length` header trusted for body size — actual body not capped | **Fixed** |
| SEC-05 | HIGH | Rate limiting | Rate limit KV writes are fire-and-forget (`void`) — counter skipped on KV failure | **Fixed** |
| SEC-06 | HIGH | CORS | Default CORS origin is `*` — any web page can call the API cross-origin | Open |
| SEC-07 | MEDIUM | Input validation | `messages[]` array has no explicit length cap in `parseCompleteRequest` | Open |
| SEC-08 | MEDIUM | Input validation | `patchConfig` passes raw unvalidated body to SandboxDO — schema bypassed | **Fixed** |
| SEC-09 | MEDIUM | Secrets | Single `SIGNING_SECRET` covers three cryptographically distinct domains | Open |
| SEC-10 | MEDIUM | Info leakage | Internal error details (`String(e)`) exposed in `detail` field of API responses | Open |
| SEC-11 | MEDIUM | Code execution | `sessionId` is not UUID-validated — arbitrary DO storage key suffix injection | Open |
| SEC-12 | LOW | LLM injection | Guard patterns are regex-only — no semantic/context-aware validation layer | Open |
| SEC-13 | LOW | CSP | AI-generated app pages use `unsafe-eval` + `unsafe-inline` in CSP | Accepted Risk |
| SEC-14 | LOW | Auth | Email endpoint intentionally public — app-token enforcement not verified | Open |
| SEC-15 | LOW | Data | KV TTL expires sandbox registry entry but DO storage is never reclaimed | Open |

---

## SEC-01 — CF Access is optional (auth bypass)

**Severity:** CRITICAL  
**File:** `src/lib/access.ts:106`, `src/lib/http.ts:201`

**Risk:** When `CF_ACCESS_AUD` or `CF_ACCESS_TEAM_DOMAIN` env vars are absent, `requireAccess()` returns `{ deny: null, identity: null }` — the caller treats this as "auth not configured, allow." Every state-mutation endpoint (`POST /api/environments`, `POST /api/sandbox`, `POST /api/probes`, etc.) is then openly accessible without any authentication. An unauthenticated attacker can exhaust all 23 provider API quotas, write to all storage layers, and delete all sandboxes.

```typescript
// access.ts:106 — current (fail-open)
export async function requireAccess(req: Request, env: Env): Promise<AccessResult> {
  if (!env.CF_ACCESS_AUD || !env.CF_ACCESS_TEAM_DOMAIN) return { deny: null, identity: null }
```

**Proposed fix:** Fail closed when CF Access vars are absent — reject all protected requests with a 503 unless a `DISABLE_AUTH=true` flag is explicitly set to acknowledge running without auth (e.g. local development).

```diff
--- a/src/lib/access.ts
+++ b/src/lib/access.ts
@@ -104,7 +104,10 @@ export interface AccessResult {
 
 export async function requireAccess(req: Request, env: Env): Promise<AccessResult> {
-  if (!env.CF_ACCESS_AUD || !env.CF_ACCESS_TEAM_DOMAIN) return { deny: null, identity: null }
+  if (!env.CF_ACCESS_AUD || !env.CF_ACCESS_TEAM_DOMAIN) {
+    if (env.DISABLE_AUTH === 'true') return { deny: null, identity: null }
+    return {
+      deny: new Response(JSON.stringify({ ok: false, error: 'Authentication not configured — set CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN' }), { status: 503, headers: { 'Content-Type': 'application/json' } }),
+      identity: null,
+    }
+  }
```

Also add `DISABLE_AUTH` to `src/types/env.d.ts` and `.dev.vars.example`.

---

## SEC-02 — `eval` via `new Function()` in SandboxDO

**Severity:** HIGH  
**File:** `src/durable/SandboxDO.ts:88`

**Risk:** `executeCode()` runs arbitrary user-supplied JavaScript inside the SandboxDO V8 isolate. A 5-second timeout prevents infinite loops but there is no memory cap — a tight allocation loop (`while(true) arr.push(new Array(1e6))`) can exhaust DO memory before the timeout fires, crashing the isolate. Additionally, the executed code runs in the same V8 context as the DO itself and has access to DO storage methods if scope is not properly sandboxed by CF's runtime.

```typescript
// SandboxDO.ts:88
const fn = new Function('__code', `
  ...
  __result = eval(__code)
  ...
`)
fn(code)
```

**Proposed fix (minimal):** Wrap the entire `new Function` block in a try/catch that limits stack depth, and enforce memory usage by capping input code length. A deeper fix would be to execute in a separate DO or via a Worker sub-request with a resource limit.

```diff
--- a/src/durable/SandboxDO.ts
+++ b/src/durable/SandboxDO.ts
@@ -83,6 +83,9 @@ export class SandboxDO extends DurableObject<Env> {
 
   private async executeCode(code: string): Promise<string> {
+    const MAX_CODE_LEN = 8_000
+    if (code.length > MAX_CODE_LEN)
+      return `Error: Code exceeds maximum length (${MAX_CODE_LEN} characters)`
     try {
       const result = await Promise.race([
```

---

## SEC-03 — Webhook SSRF via private IP ranges

**Severity:** HIGH  
**File:** `src/lib/schema.ts:989`

**Risk:** `parseWebhookUrl()` blocks exact localhost hostnames (`localhost`, `127.0.0.1`, `0.0.0.0`, `::1`) and `.internal`/`.local` suffixes, but does **not** block private IP ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (link-local), or IPv4-mapped IPv6 (`::ffff:10.0.0.1`). Probe webhooks fire outbound `fetch()` calls from within Cloudflare's network, potentially reaching other tenants' internal services or Cloudflare's own internal APIs.

```typescript
// schema.ts:989 — current
const BLOCKED_WEBHOOK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])
```

**Proposed fix:** Add a post-DNS IP range check, or block numeric IPs at parse time.

```diff
--- a/src/lib/schema.ts
+++ b/src/lib/schema.ts
@@ -989,6 +989,27 @@ const BLOCKED_WEBHOOK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0',
 
+// Rejects any hostname that is a raw private/loopback IPv4 or IPv6 address.
+// DNS-resolved IPs cannot be checked here; this is a defence-in-depth measure.
+function isPrivateIp(host: string): boolean {
+  // Strip brackets from IPv6 literals
+  const h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
+
+  // IPv4 private ranges
+  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
+  if (v4) {
+    const [, a, b] = v4.map(Number)
+    if (a === 10) return true
+    if (a === 172 && b >= 16 && b <= 31) return true
+    if (a === 192 && b === 168) return true
+    if (a === 169 && b === 254) return true
+    if (a === 127) return true
+    if (a === 0) return true
+  }
+  // IPv4-mapped IPv6 ::ffff:x.x.x.x
+  if (/^::ffff:/i.test(h)) return true
+  return false
+}
+
 export function parseWebhookUrl(v: unknown): string | undefined {
   ...
   if (BLOCKED_WEBHOOK_HOSTNAMES.has(host)) throw new Error('webhookUrl must not target localhost')
   if (host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.localhost'))
     throw new Error('webhookUrl must not target internal hostnames')
+  if (isPrivateIp(host)) throw new Error('webhookUrl must not target private IP addresses')
   return v
 }
```

---

## SEC-04 — `Content-Length` header trusted for body size limit

**Severity:** HIGH  
**File:** `src/lib/http.ts:26`

**Risk:** `readJson()` reads `Content-Length` from the request header and rejects bodies over 1 MB, but then calls `req.json()` unconditionally, which reads the **actual** body regardless of the header. A client can send `Content-Length: 100` with a 10 MB body and the size check passes while the actual body is fully consumed. Cloudflare Workers' default body limit is 100 MB — far above the 1 MB the application intends to enforce.

```typescript
// http.ts:26 — current (reads header, not actual body)
const cl = parseInt(req.headers.get('Content-Length') ?? '0', 10)
if (cl > MAX_REQUEST_BODY) throw new Error('Request body too large (max 1 MB)')
return req.json()
```

**Proposed fix:** Read the body as `arrayBuffer()` first, check actual byte length, then parse.

```diff
--- a/src/lib/http.ts
+++ b/src/lib/http.ts
@@ -23,9 +23,13 @@ export async function readJson(req: Request): Promise<unknown> {
   const ct = req.headers.get('Content-Type') ?? ''
   if (!ct.includes('application/json')) throw new Error('Content-Type must be application/json')
-  const cl = parseInt(req.headers.get('Content-Length') ?? '0', 10)
-  if (cl > MAX_REQUEST_BODY) throw new Error('Request body too large (max 1 MB)')
-  return req.json()
+  const buf = await req.arrayBuffer()
+  if (buf.byteLength > MAX_REQUEST_BODY) throw new Error('Request body too large (max 1 MB)')
+  try {
+    return JSON.parse(new TextDecoder().decode(buf))
+  } catch {
+    throw new Error('Request body is not valid JSON')
+  }
 }
```

---

## SEC-05 — Rate limit KV writes are fire-and-forget

**Severity:** HIGH  
**File:** `src/lib/http.ts:113`

**Risk:** `checkRateLimit()` uses `void env.RATE_LIMITS.put(...)` — the KV write is unawaited. If the KV write fails (network error, KV overload, quota exceeded), the timestamp is never persisted. The in-memory window array is discarded when the Worker isolate terminates. Under concurrent load, race conditions can allow bursts well above the declared limit. For a rate limit of 5/min on AI generation endpoints, this could mean unbounded AI invocations.

```typescript
// http.ts:113 — current
void env.RATE_LIMITS.put(key, JSON.stringify(window), { expirationTtl: Math.ceil(windowMs / 1000) })
```

**Proposed fix:** Await the write. The performance cost is negligible compared to the AI calls being gated.

```diff
--- a/src/lib/http.ts
+++ b/src/lib/http.ts
@@ -110,7 +110,7 @@ export async function checkRateLimit(
   if (window.length >= max) return json(err(message), 429)
   window.push(now)
-  void env.RATE_LIMITS.put(key, JSON.stringify(window), { expirationTtl: Math.ceil(windowMs / 1000) })
+  await env.RATE_LIMITS.put(key, JSON.stringify(window), { expirationTtl: Math.ceil(windowMs / 1000) })
   return null
 }
```

Note: `SandboxDO.ts:77` has the same issue for per-DO rate limiting:
```diff
-    void this.ctx.storage.put(RL_STORAGE_KEY, { window })
+    await this.ctx.storage.put(RL_STORAGE_KEY, { window })
```

---

## SEC-06 — CORS defaults to wildcard (`*`)

**Severity:** HIGH  
**File:** `src/lib/http.ts:86`

**Risk:** When `ALLOWED_ORIGINS` is not configured, `corsHeaders()` returns `Access-Control-Allow-Origin: *`. This means any web page on the internet can make credentialed cross-origin requests to the API. While CF Access tokens are required for mutations, a logged-in user visiting an attacker-controlled page can have their session used to invoke AI, read vault contents, list sandboxes, etc. In a zero-dependency deployment without CF Access configured (SEC-01), this becomes trivially exploitable.

```typescript
// http.ts:86 — current
const allowed = (env.ALLOWED_ORIGINS ?? '*').split(',').map(s => s.trim())
```

**Proposed fix:** Fail to a restrictive default in production; the explicit opt-in for open CORS must be `ALLOWED_ORIGINS=*`.

```diff
--- a/src/lib/http.ts
+++ b/src/lib/http.ts
@@ -86,7 +86,9 @@ function corsHeaders(req: Request, env: Env): Record<string, string> {
-  const allowed = (env.ALLOWED_ORIGINS ?? '*').split(',').map(s => s.trim())
+  // Default to restrictive — require explicit ALLOWED_ORIGINS=* to enable open CORS
+  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
+  if (allowed.length === 0) return {}   // no CORS headers = same-origin only
   const origin  = req.headers.get('Origin') ?? ''
   const allow   = allowed.includes('*') ? '*'
     : allowed.includes(origin) ? origin
```

---

## SEC-07 — `messages[]` array has no explicit length cap

**Severity:** MEDIUM  
**File:** `src/lib/schema.ts:246`

**Risk:** `parseCompleteRequest` maps `body.messages` with no check on array length before iterating. A 1 MB body can contain ~3,000–10,000 minimal messages. Each message is forwarded to the AI provider, which must tokenise and process the full context window. This enables context window stuffing and cost amplification attacks on expensive models.

```typescript
// schema.ts:246 — current (no length check)
messages: Array.isArray(body.messages) ? body.messages.map((m, i) => parseMessage(m, i)) : undefined,
```

**Proposed fix:** Cap `messages` at a reasonable limit (e.g. 200 turns = 400 messages including assistant replies):

```diff
--- a/src/lib/schema.ts
+++ b/src/lib/schema.ts
@@ -246,6 +246,8 @@ export function parseCompleteRequest(body: unknown): CompleteRequest {
+    if (Array.isArray(body.messages) && body.messages.length > 200)
+      throw new Error('messages may contain at most 200 items')
     messages: Array.isArray(body.messages) ? body.messages.map((m, i) => parseMessage(m, i)) : undefined,
```

---

## SEC-08 — `patchConfig` passes raw unvalidated body to SandboxDO

**Severity:** MEDIUM  
**File:** `src/routes/sandbox.ts:166`, `src/durable/SandboxDO.ts:317`

**Risk:** `PATCH /api/sandbox/:id` reads the request body with `readJson()` and casts it directly to `Partial<{name, description, model, systemPrompt}>`, but then passes the **entire raw body** to the DO via `doFetch(stub, 'config', 'PATCH', body)`. Inside the DO, `handlePatchConfig` filters out `id`, `memory`, `createdAt`, and `integrityHash`, but spreads all remaining fields onto the config. An authenticated caller can set `guardMode: 'off'` (disabling prompt injection protection), set arbitrary `tools`, or set `ragEnabled: true` (enabling RAG unexpectedly).

```typescript
// sandbox.ts:166
let body: unknown
try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
const patch = body as Partial<{ name: string; description: string; model: string; systemPrompt: string }>
...
const res = await doFetch(stub(env, id), 'config', 'PATCH', body, identityHeader(req))
                                                           // ^^^^ raw unvalidated body
```

**Proposed fix:** Add a `parsePatchSandboxRequest` parser to `schema.ts` that only passes through explicitly allowed fields.

```diff
--- a/src/lib/schema.ts
+++ b/src/lib/schema.ts
+export function parsePatchSandboxRequest(body: unknown): Partial<{
+  name: string; description: string; model: string; systemPrompt: string;
+  temperature: number; maxTokens: number; guardMode: 'strict' | 'audit' | 'off'
+}> {
+  if (!isObj(body)) throw new Error('Body must be a JSON object')
+  const out: ReturnType<typeof parsePatchSandboxRequest> = {}
+  if (body.name        !== undefined) out.name        = str(body.name,        'name')
+  if (body.description !== undefined) out.description = str(body.description, 'description')
+  if (body.model       !== undefined) out.model       = str(body.model,       'model')
+  if (body.systemPrompt!== undefined) out.systemPrompt= str(body.systemPrompt,'systemPrompt')
+  if (body.temperature !== undefined) out.temperature = num(body.temperature, 'temperature', DEFAULT_TEMPERATURE, 0, 2)
+  if (body.maxTokens   !== undefined) out.maxTokens   = num(body.maxTokens,   'maxTokens',   DEFAULT_MAX_TOKENS, 1, 8192)
+  if (body.guardMode   !== undefined) {
+    if (!['strict', 'audit', 'off'].includes(body.guardMode as string))
+      throw new Error('guardMode must be "strict", "audit", or "off"')
+    out.guardMode = body.guardMode as 'strict' | 'audit' | 'off'
+  }
+  return out
+}

--- a/src/routes/sandbox.ts
+++ b/src/routes/sandbox.ts
@@ -161,9 +161,9 @@ const patchConfig: Handler = async (req, env, params: Params) => {
   if (!isUUID(id)) return json(err('Invalid sandbox id'), 422)
   if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
-  let body: unknown
-  try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
-  const patch = body as Partial<{ name: string; description: string; model: string; systemPrompt: string }>
+  const p = await parseBody(req, parsePatchSandboxRequest)
+  if (!p.ok) return p.response
+  const patch = p.data
   ...
-  const res = await doFetch(stub(env, id), 'config', 'PATCH', body, identityHeader(req))
+  const res = await doFetch(stub(env, id), 'config', 'PATCH', patch, identityHeader(req))
```

---

## SEC-09 — Single `SIGNING_SECRET` for multiple domains

**Severity:** MEDIUM  
**File:** `src/lib/vault.ts`, `src/lib/appToken.ts`, `src/routes/sandbox.ts`, `src/routes/environments.ts`

**Risk:** `SIGNING_SECRET` is used for three cryptographically distinct purposes:
1. AES-GCM system prompt encryption (key derivation via HKDF)
2. HMAC-SHA256 config export/import signatures
3. HMAC-SHA256 app token generation

A single key rotation invalidates all existing exported configs and active app tokens simultaneously. More critically, if a weakness is found in any one use of the key (e.g. a timing oracle on token verification), it potentially degrades security for the other two domains.

**Proposed fix (minimal):** Derive domain-specific sub-keys via HKDF with distinct `info` labels. This requires no new environment variable.

```diff
--- a/src/lib/vault.ts
+++ b/src/lib/vault.ts
+const HMAC_INFO          = new TextEncoder().encode('whisper-hmac-v1')
+const APP_TOKEN_INFO     = new TextEncoder().encode('whisper-app-token-v1')
+
+export async function deriveSubkey(secret: string, info: Uint8Array): Promise<string> {
+  const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey'])
+  const key = await crypto.subtle.deriveKey(
+    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info },
+    raw, { name: 'HMAC', hash: 'SHA-256', length: 256 }, true, ['sign', 'verify'],
+  )
+  const exported = await crypto.subtle.exportKey('raw', key)
+  return [...new Uint8Array(exported)].map(b => b.toString(16).padStart(2, '0')).join('')
+}
```

Then `signPayload` and `verifySignature` callers use `await deriveSubkey(secret, HMAC_INFO)` as the secret, and app tokens use `await deriveSubkey(secret, APP_TOKEN_INFO)`.

---

## SEC-10 — Internal error details exposed in API responses

**Severity:** MEDIUM  
**File:** Multiple route files

**Risk:** Every route that catches exceptions returns `json(err('description', String(e)), 500)`. The `detail` field exposes raw JS error messages, which can include Cloudflare D1 SQL error text, AI Gateway response bodies, internal file paths, and binding names. This gives attackers insight into the backend implementation, database schema, and query patterns.

Example (from `probes.ts:361`):
```typescript
return json(err('Failed to create probe', String(e)), 500)
// Response: { ok: false, error: "Failed to create probe", detail: "D1_ERROR: SQLITE_CONSTRAINT: NOT NULL constraint failed: probes.webhook_url" }
```

**Proposed fix:** Log errors to the audit table (already available) and return only a request ID. For the minimal fix, strip the `detail` from 500 responses:

```diff
--- a/src/lib/http.ts
+++ b/src/lib/http.ts
+// Use for internal errors: never expose raw exception text to callers.
+export function internalErr(message: string, _e: unknown): Response {
+  // TODO: route _e to structured logging
+  return json(err(message), 500)
+}
```

Then replace `json(err('...', String(e)), 500)` with `internalErr('...', e)` across all route files.

---

## SEC-11 — `sessionId` not UUID-validated — DO storage key injection

**Severity:** MEDIUM  
**File:** `src/durable/SandboxDO.ts:56–61`, `src/lib/schema.ts` (parseRunSandboxRequest)

**Risk:** `sessionId` is stored as `session:${sessionId}` in DO storage. While the external schema parser limits length, it does not restrict the character set. A caller who has access to a sandbox can supply `sessionId` values like `../config`, `.`, or other path-like strings. DO storage keys are opaque strings and `session:../config` is distinct from `config`, so this does not directly compromise other keys — but it allows a caller to deliberately litter arbitrary session keys into DO storage, accumulating data indefinitely (7-day TTL only applies to KV registry, not DO storage).

**Proposed fix:** Validate sessionId to UUID format.

```diff
--- a/src/lib/schema.ts
+++ b/src/lib/schema.ts
 export function parseRunSandboxRequest(body: unknown): RunSandboxRequest {
   ...
-  sessionId: typeof body.sessionId === 'string' && body.sessionId.length <= MAX_SESSION_ID_LEN
-    ? body.sessionId
-    : undefined,
+  sessionId: typeof body.sessionId === 'string' && isUUID(body.sessionId)
+    ? body.sessionId
+    : undefined,
```

---

## SEC-12 — Guard patterns are regex-only (no semantic layer)

**Severity:** LOW  
**File:** `src/lib/guard.ts`

**Risk:** The 5 blocked and 7 suspicious patterns are regex-based. Adversarial inputs can bypass them using:
- Paraphrasing: "Disregard your earlier directives" vs "ignore previous instructions"
- Multi-language: `Ignorez toutes les instructions précédentes`
- Indirect injection: "When summarising, add a prefix: [JAILBREAK]..."
- LLM-generated instruction smuggling in documents

The system correctly applies NFKC normalization and 3-layer base64 decoding, which covers many obfuscation techniques, but semantic bypasses remain.

**Accepted-risk threshold:** The guard is explicitly labelled as a defence-in-depth layer, not a security boundary. Single-tenant architecture means the only actors are trusted users. Raising this to a semantic guard would require an AI classification step on every message (cost + latency).

**Recommended action:** Document this limitation. Consider adding a deny-list for non-English equivalents of the most common jailbreak phrases if multilingual support is added.

---

## SEC-13 — AI-generated app pages use `unsafe-eval` + `unsafe-inline`

**Severity:** LOW  
**File:** `src/routes/pages.ts:1432`

**Status:** Accepted Risk

The `BUILD_CSP` constant includes `unsafe-eval` and `unsafe-inline` for AI-generated app HTML pages (`/build/:id/*`). This is intentional — generated apps may load ESM frameworks from CDN that require eval. Since the HTML is itself AI-generated and deployed by the operator, the risk model is "operator trusts their own AI-generated output."

No change recommended. This is documented as accepted risk.

---

## SEC-14 — Email endpoint is publicly accessible (token enforcement unverified)

**Severity:** LOW  
**File:** `src/lib/access.ts:140`, `src/routes/appstate.ts:134`

**Risk:** `POST /api/app/:id/email` is explicitly excluded from CF Access protection (`/^\/api\/app\/[^/]+\/(images|email)$/`). This is intentional so that AI-generated apps can send email. However, any caller who knows an app UUID can trigger email sends at will. A rate limit exists (`5/min per app`) but UUID enumeration combined with distributed sources could exhaust email quotas or spam recipients.

The app-token mechanism exists but `sendEmail` does not currently verify it — it only checks that `SEND_EMAIL` is bound and that the `id` is a valid UUID.

**Proposed fix:** Add token verification to the email handler:

```diff
--- a/src/routes/appstate.ts
+++ b/src/routes/appstate.ts
 const sendEmail: Handler = async (req, env, params) => {
   if (!env.SEND_EMAIL) return json(err('Email sending is not configured on this server.'), 503)
   const id = params.id ?? ''
   if (!isUUID(id)) return json(err('Invalid app id'), 422)
+  // Require a valid app token so only the app itself can trigger sends
+  if (env.SIGNING_SECRET) {
+    const token = req.headers.get('X-App-Token')
+    const tokenAppId = token ? await verifyAppToken(token, env.SIGNING_SECRET) : null
+    if (!tokenAppId || tokenAppId !== id)
+      return json(err('Valid app token required to send email'), 401)
+  }
```

---

## SEC-15 — Sandbox KV TTL expires but DO storage is never reclaimed

**Severity:** LOW  
**File:** `src/routes/sandbox.ts:76`, `wrangler.toml`

**Risk:** KV metadata has a 7-day TTL (`SANDBOX_TTL = 7 * 24 * 3600`). After TTL, the sandbox disappears from `SANDBOX_REGISTRY` (list/exists checks fail) but the `SandboxDO` instance and all its storage (messages, config, session history) persists indefinitely in DO storage. This accumulates unbounded DO storage and potentially retains user conversation data beyond the implied 7-day window.

**Proposed fix:** Schedule a cleanup job via the existing Cron Trigger infrastructure. After KV expiry, issue a `DELETE /` to the DO stub to trigger `handleDelete()` (which calls `ctx.storage.deleteAll()`). Alternatively, extend the KV TTL to function as the data retention policy.

No code diff — this requires adding a new cron handler branch to `src/index.ts`.

---

## No Hardcoded Secrets Found

All API keys are read from the `Env` interface at runtime. Test files use clearly dummy values (`'test-secret-key-32-bytes-long!!'`). No hardcoded credentials were found in any source file.

---

## Dependency Security

Zero runtime npm dependencies — no supply chain risk from third-party packages at runtime. Only `devDependencies` are present (TypeScript, Wrangler, Vitest). These should be kept current but carry no runtime exposure.

---

## Prompt Injection Risk Assessment

| Surface | Scan applied | Risk |
|---------|-------------|------|
| Chat message (POST /api/sandbox/:id/run) | Yes — `scan()` pre-call | Low |
| System prompt (sandbox create/patch) | Yes — `scan()` pre-call | Low |
| Document upload (text content) | Yes — `scan()` on text slice | Low |
| Pipeline node prompts | No | Medium |
| Atlas prompt library entries | No | Medium |
| Probe prompts (scheduled) | No | Medium |
| WebSocket chat messages | Yes — `scan()` per message | Low |

**Recommendation:** Apply `scan()` to pipeline node prompts at create time and to atlas entries at add time. These can contain injected instructions that execute later without the caller being present.

---

## Changes Required Before Launch

Items from this audit that block launch:

- [ ] **SEC-01**: Set `CF_ACCESS_AUD` + `CF_ACCESS_TEAM_DOMAIN`, or set `DISABLE_AUTH=true` explicitly
- [x] **SEC-03**: Add private IP blocking to `parseWebhookUrl` — `isPrivateIp()` added in `src/lib/schema.ts`
- [x] **SEC-04**: Fix body size check to read actual bytes — `readJson()` now uses `arrayBuffer()` in `src/lib/http.ts`
- [x] **SEC-05**: Await rate limit KV writes — `void` → `await` in `http.ts:113` and `SandboxDO.ts:77`
- [ ] **SEC-06**: Set explicit `ALLOWED_ORIGINS` in production wrangler secrets (config change)
- [x] **SEC-08**: Add `parsePatchSandboxRequest` schema parser — implemented in `schema.ts`, wired in `sandbox.ts:patchConfig`

Items deferred to post-launch hardening:

- [ ] **SEC-07**: Cap `messages[]` length
- [ ] **SEC-09**: Domain-separated signing keys
- [ ] **SEC-10**: Strip internal error details from 500 responses
- [ ] **SEC-11**: UUID-validate `sessionId`
- [ ] **SEC-14**: Add app-token enforcement to email endpoint
- [ ] **SEC-15**: Add DO storage cleanup cron

---

*SEC-03, SEC-04, SEC-05, and SEC-08 are fixed in commit `191a2db`. SEC-01 and SEC-06 require production deployment configuration.*
