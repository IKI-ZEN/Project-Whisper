# Testing Assessment

_Assessed: 2026-05-31_

---

## Current State

### What exists

**9 test files — all in `src/lib/`:**

| File | Suites | Tests | What is covered |
|------|--------|-------|-----------------|
| `src/lib/analysis.test.ts` | 1 | ~20 | `extractMetrics` (entropy, sensitivity, sweep, CoT tools) |
| `src/lib/appToken.test.ts` | 3 | 19 | `isAppScopedPath`, `extractAppToken`, `issueAppToken`/`verifyAppToken` |
| `src/lib/guard.test.ts` | 2 | ~18 | `scan`, `scanVerbose` |
| `src/lib/http.test.ts` | 2 | 17 | `parseQueryInt`, `checkRateLimit` |
| `src/lib/markdown.test.ts` | 7 | ~40 | `renderMarkdown` (headers, code, tables, lists, links, XSS, edge cases) |
| `src/lib/pipeline.test.ts` | 5 | ~35 | `executePipeline` (complete, embed, compare, transform, conditional nodes) |
| `src/lib/pricing.test.ts` | 1 | ~8 | `estimateCost` |
| `src/lib/schema.test.ts` | 4 | ~20 | `parseCompleteRequest`, `parseCreateSandboxRequest`, `parsePatchEnvironmentRequest`, `parsePipelineRequest` |
| `src/lib/utils.test.ts` | 1 | 9 | `isUUID` |

**Total: 184 tests, 35 suites. All passing. Zero failures.**

### What is NOT tested

**Zero coverage in:**
- `src/routes/` — 17 route files, 0 test files
- `src/durable/` — `SandboxDO.ts`, `AppBuilderDO.ts`, `AppStateDO.ts`, 0 test files
- `src/jobs/` — `fileProcess.ts`, 0 test files

**32 of 36 exported schema parsers have no tests:**

Whisperer / analysis tools:
`parseEmbedRequest`, `parseImageRequest`, `parseCompareRequest`, `parseSweepRequest`,
`parseThinkRequest`, `parseSensitivityRequest`, `parseClusterRequest`, `parseCotRequest`,
`parseEntropyRequest`, `parseArchaeologyRequest`, `parseGuardProbeRequest`,
`parseAblationRequest`, `parseDriftRequest`, `parseContextStressRequest`,
`parseEvaluateRequest`, `parseConsistencyRequest`

Core sandbox / run:
`parseRunSandboxRequest`, `parseSessionBody`, `parseReindexBody`

Platform features:
`parseVibeRequest`, `parseEnvironmentRequest`, `parseAppStateValueRequest`,
`parseEmailRequest`, `parseBuildRequest`, `parseUsageQuery`

Pipeline:
`parseCreatePipeline`, `parsePatchPipeline`, `parsePipelineRunRequest`

Vault / TTS / Atlas / search:
`parseVaultAnalyzeRequest`, `parseVaultSearchRequest`, `parseWebhookUrl`, `parseTTSRequest`

**Auth — zero tests:**
- `requireAccess` (JWT validation, CF Access gating)
- `isProtectedRequest` (route-level auth routing decision)

**Vault / crypto — zero tests:**
- `sealPrompt` / `openPrompt` (AES-GCM envelope encryption for system prompts)
- `signPayload` / `verifySignature` (HMAC used for import/export signing)

---

## Gap Analysis: Production Risk

### CRITICAL

**`isProtectedRequest` is untested.**
This pure function decides whether a request must be authenticated. A bug could silently
expose all write endpoints to the public (if it returns `false` too broadly) or break
all writes for legitimate users (if it returns `true` too broadly). It has 4 regex-guarded
exception paths (short API `/s/*`, CSP sink, core run/stream, app public endpoints) that
are trivially testable but currently uncovered.

**`parseWebhookUrl` SSRF guards are untested.**
The function blocks `localhost`, `.internal`, `.local`, `.localhost` hostnames and requires
`https://`. This is the SSRF prevention for probe webhooks. No test verifies that these
guards hold — a refactor or constant change could silently remove the protection. The
`BLOCKED_WEBHOOK_HOSTNAMES` set in constants.ts is also untested.

**`requireAccess` fail-open path is untested.**
When `CF_ACCESS_AUD`/`CF_ACCESS_TEAM_DOMAIN` are absent, the function returns
`{ deny: null, identity: null }` (unauthenticated pass). This is the SEC-01 finding from
the security audit. A test is needed to document (and lock in) this behavior so any change
to it is visible.

### HIGH

**`parseEnvironmentRequest` envType validation — behavior confirmed but not locked.**
The parser does validate `envType` against `ENV_TYPES` (`['general','coding','research',
'structured','creative','agent','debate']`). However, there are no tests. If `ENV_TYPES`
is accidentally cleared or the validation is removed during a refactor, no CI signal.

**`parseRunSandboxRequest` sessionId sanitization — untested.**
The parser rejects sessionIds with characters outside `[a-zA-Z0-9_\-]` to prevent path
traversal in KV keys. The regex exists but is never exercised by a test. Any weakening
of this regex goes undetected.

**`sealPrompt`/`openPrompt` round-trip — untested.**
System prompts are encrypted at rest with AES-GCM. The passthrough path (`if
(!sealed.startsWith('v1:')) return sealed`) could silently activate if the prefix
format changes. No test verifies that seal→open returns the original plaintext, or that
cross-sandbox decryption fails.

### MEDIUM

**`signPayload`/`verifySignature` — untested.**
Used to sign environment export/import payloads. No test verifies that a valid signature
verifies, that a tampered payload fails, or that the constant-time comparison holds.

**`parseUsageQuery` uses raw `parseInt`/`isNaN` (known P1-B quality issue).**
Current behavior for edge inputs (strings, floats, negative numbers) is not captured in
tests, making it risky to refactor to `parseQueryInt` without a behavioral baseline.

**`parsePatchEnvironmentRequest` — partially covered.**
`parsePatchEnvironmentRequest` is tested by `schema.test.ts` but the `envModels` array
validation (max 4 items, all strings) is not exercised.

---

## Recommended Tests (Priority Order)

The following 6 test additions cover the highest-risk gaps with the lowest implementation
cost. All are pure unit tests of existing library functions — no network, no Workers
runtime, no mocking beyond what already exists.

---

### TEST-1: `isProtectedRequest` (access.ts)

**Risk:** Untested auth routing logic. Critical.

**Proposed implementation** — add to `src/lib/access.test.ts` (new file):

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isProtectedRequest } from './access.ts'

describe('isProtectedRequest — write methods', () => {
  it('gates POST to /api/', () => assert.strictEqual(isProtectedRequest('POST', '/api/vault'), true))
  it('gates PATCH to /api/', () => assert.strictEqual(isProtectedRequest('PATCH', '/api/sandbox/x'), true))
  it('gates DELETE to /api/', () => assert.strictEqual(isProtectedRequest('DELETE', '/api/atlas/x'), true))
  it('gates PUT to /api/', () => assert.strictEqual(isProtectedRequest('PUT', '/api/foo'), true))
})

describe('isProtectedRequest — exempt read methods', () => {
  it('does not gate GET', () => assert.strictEqual(isProtectedRequest('GET', '/api/vault'), false))
  it('does not gate HEAD', () => assert.strictEqual(isProtectedRequest('HEAD', '/api/vault'), false))
})

describe('isProtectedRequest — exempt paths', () => {
  it('exempts /s/ prefix', () => assert.strictEqual(isProtectedRequest('POST', '/s/abc/run'), false))
  it('exempts /api/csp-report', () => assert.strictEqual(isProtectedRequest('POST', '/api/csp-report'), false))
  it('exempts sandbox run', () => assert.strictEqual(isProtectedRequest('POST', '/api/sandbox/abc-123/run'), false))
  it('exempts sandbox stream', () => assert.strictEqual(isProtectedRequest('POST', '/api/sandbox/abc-123/stream'), false))
  it('exempts app images', () => assert.strictEqual(isProtectedRequest('POST', '/api/app/abc/images'), false))
  it('exempts app email', () => assert.strictEqual(isProtectedRequest('POST', '/api/app/abc/email'), false))
})

describe('isProtectedRequest — near-miss paths (must still be gated)', () => {
  it('sandbox /run with extra suffix is still gated', () =>
    assert.strictEqual(isProtectedRequest('POST', '/api/sandbox/abc/run/extra'), true))
  it('csp-report with suffix is still gated', () =>
    assert.strictEqual(isProtectedRequest('POST', '/api/csp-report/extra'), true))
  it('/api/sandboxes (typo) is gated', () =>
    assert.strictEqual(isProtectedRequest('POST', '/api/sandboxes'), true))
})
```

---

### TEST-2: `parseWebhookUrl` SSRF guards (schema.ts)

**Risk:** SSRF prevention — critical for probe webhook safety.

**Proposed implementation** — add to `src/lib/schema.test.ts`:

```typescript
import { parseWebhookUrl } from './schema.ts'

describe('parseWebhookUrl — valid URLs', () => {
  it('accepts a normal https URL', () =>
    assert.strictEqual(parseWebhookUrl('https://example.com/hook'), 'https://example.com/hook'))
  it('returns undefined for undefined', () =>
    assert.strictEqual(parseWebhookUrl(undefined), undefined))
  it('returns undefined for empty string', () =>
    assert.strictEqual(parseWebhookUrl(''), undefined))
})

describe('parseWebhookUrl — SSRF blocking', () => {
  const ssrfCases = [
    'http://example.com/hook',         // not https
    'https://localhost/hook',           // localhost
    'https://127.0.0.1/hook',           // loopback IP (in BLOCKED_WEBHOOK_HOSTNAMES)
    'https://0.0.0.0/hook',             // any-address
    'https://service.internal/hook',    // .internal suffix
    'https://db.local/hook',            // .local suffix
    'https://server.localhost/hook',    // .localhost suffix
  ]
  for (const url of ssrfCases) {
    it(`rejects ${url}`, () =>
      assert.throws(() => parseWebhookUrl(url), /Error/))
  }
})

describe('parseWebhookUrl — type errors', () => {
  it('rejects number', () => assert.throws(() => parseWebhookUrl(42), /must be a string/))
  it('rejects object', () => assert.throws(() => parseWebhookUrl({}), /must be a string/))
})
```

---

### TEST-3: `parseRunSandboxRequest` sessionId sanitization (schema.ts)

**Risk:** Path traversal prevention in KV key construction.

**Proposed implementation** — add to `src/lib/schema.test.ts`:

```typescript
import { parseRunSandboxRequest } from './schema.ts'

describe('parseRunSandboxRequest — sessionId sanitization', () => {
  it('accepts alphanumeric sessionId', () => {
    const r = parseRunSandboxRequest({ message: 'hi', sessionId: 'session-123_abc' })
    assert.strictEqual(r.sessionId, 'session-123_abc')
  })
  it('accepts undefined sessionId', () => {
    const r = parseRunSandboxRequest({ message: 'hi' })
    assert.strictEqual(r.sessionId, undefined)
  })
  it('rejects sessionId with path traversal', () =>
    assert.throws(() => parseRunSandboxRequest({ message: 'hi', sessionId: '../etc/passwd' }), /alphanumeric/))
  it('rejects sessionId with spaces', () =>
    assert.throws(() => parseRunSandboxRequest({ message: 'hi', sessionId: 'a b' }), /alphanumeric/))
  it('rejects sessionId with dot', () =>
    assert.throws(() => parseRunSandboxRequest({ message: 'hi', sessionId: 'x.y' }), /alphanumeric/))
  it('rejects empty message', () =>
    assert.throws(() => parseRunSandboxRequest({ message: '   ' }), /empty/))
  it('rejects non-object body', () =>
    assert.throws(() => parseRunSandboxRequest('string'), /JSON object/))
})
```

---

### TEST-4: `parseEnvironmentRequest` envType validation (schema.ts)

**Risk:** Locks in enum validation that was a known correctness gap.

**Proposed implementation** — add to `src/lib/schema.test.ts`:

```typescript
import { parseEnvironmentRequest } from './schema.ts'

describe('parseEnvironmentRequest — envType validation', () => {
  const VALID_TYPES = ['general', 'coding', 'research', 'structured', 'creative', 'agent', 'debate']
  for (const envType of VALID_TYPES) {
    it(`accepts envType "${envType}"`, () => {
      const r = parseEnvironmentRequest({ description: 'a'.repeat(10), envType })
      assert.strictEqual(r.envType, envType)
    })
  }
  it('rejects unknown envType', () =>
    assert.throws(() =>
      parseEnvironmentRequest({ description: 'a'.repeat(10), envType: 'malicious' }),
      /must be one of/))
  it('rejects empty envType', () =>
    assert.throws(() =>
      parseEnvironmentRequest({ description: 'a'.repeat(10), envType: '' }),
      /must be one of/))
  it('rejects description under 10 chars', () =>
    assert.throws(() =>
      parseEnvironmentRequest({ description: 'short', envType: 'general' }),
      /10/))
})
```

---

### TEST-5: `sealPrompt`/`openPrompt` round-trip (vault.ts)

**Risk:** Encryption correctness — silent decryption failure leaves system prompts unreadable.

**Proposed implementation** — new file `src/lib/vault.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sealPrompt, openPrompt, signPayload, verifySignature } from './vault.ts'

const SECRET = 'test-secret-for-unit-tests'
const SANDBOX_ID = '00000000-0000-0000-0000-000000000001'

describe('sealPrompt / openPrompt', () => {
  it('round-trips a plaintext prompt', async () => {
    const original = 'You are a helpful assistant.'
    const sealed = await sealPrompt(original, SECRET, SANDBOX_ID)
    assert.match(sealed, /^v1:/)
    const opened = await openPrompt(sealed, SECRET, SANDBOX_ID)
    assert.strictEqual(opened, original)
  })

  it('produces different ciphertext each call (random IV)', async () => {
    const prompt = 'same prompt'
    const a = await sealPrompt(prompt, SECRET, SANDBOX_ID)
    const b = await sealPrompt(prompt, SECRET, SANDBOX_ID)
    assert.notStrictEqual(a, b)
  })

  it('returns plaintext unchanged (passthrough)', async () => {
    const plain = 'no encryption prefix here'
    const result = await openPrompt(plain, SECRET, SANDBOX_ID)
    assert.strictEqual(result, plain)
  })

  it('returns malformed sealed as plaintext', async () => {
    const malformed = 'v1:nodothere'
    const result = await openPrompt(malformed, SECRET, SANDBOX_ID)
    assert.strictEqual(result, malformed)
  })

  it('throws on cross-sandbox decryption (wrong sandboxId)', async () => {
    const sealed = await sealPrompt('secret prompt', SECRET, SANDBOX_ID)
    await assert.rejects(() => openPrompt(sealed, SECRET, 'different-sandbox-id'))
  })
})

describe('signPayload / verifySignature', () => {
  it('verifies a freshly signed payload', async () => {
    const sig = await signPayload('hello', SECRET)
    assert.strictEqual(await verifySignature('hello', sig, SECRET), true)
  })

  it('rejects a tampered payload', async () => {
    const sig = await signPayload('hello', SECRET)
    assert.strictEqual(await verifySignature('world', sig, SECRET), false)
  })

  it('rejects a wrong secret', async () => {
    const sig = await signPayload('hello', SECRET)
    assert.strictEqual(await verifySignature('hello', sig, 'wrong-secret'), false)
  })

  it('rejects a truncated signature', async () => {
    const sig = await signPayload('hello', SECRET)
    assert.strictEqual(await verifySignature('hello', sig.slice(0, -2), SECRET), false)
  })
})
```

---

### TEST-6: `requireAccess` fail-open behavior (access.ts)

**Risk:** Documents the SEC-01 finding in test form — any change to auth behavior appears in the diff.

This requires a minimal mock for `Env`. Add to `src/lib/access.test.ts`:

```typescript
import { requireAccess } from './access.ts'

describe('requireAccess — fail-open when CF Access not configured', () => {
  it('returns deny:null when CF_ACCESS_AUD is absent', async () => {
    const req = new Request('https://example.com/api/vault', { method: 'POST' })
    const env = { CF_ACCESS_AUD: '', CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com' } as any
    const result = await requireAccess(req, env)
    assert.strictEqual(result.deny, null)
    assert.strictEqual(result.identity, null)
  })

  it('returns deny:null when CF_ACCESS_TEAM_DOMAIN is absent', async () => {
    const req = new Request('https://example.com/api/vault', { method: 'POST' })
    const env = { CF_ACCESS_AUD: 'aud-value', CF_ACCESS_TEAM_DOMAIN: '' } as any
    const result = await requireAccess(req, env)
    assert.strictEqual(result.deny, null)
  })

  it('returns 401 when token is missing and CF Access is configured', async () => {
    const req = new Request('https://example.com/api/vault', { method: 'POST' })
    const env = { CF_ACCESS_AUD: 'aud-value', CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com' } as any
    const result = await requireAccess(req, env)
    assert.notStrictEqual(result.deny, null)
    assert.strictEqual(result.deny?.status, 401)
  })
})
```

---

## Summary Table

| Test | File | New/Append | Tests Added | Risk Covered |
|------|------|------------|-------------|--------------|
| TEST-1 `isProtectedRequest` | `src/lib/access.test.ts` | New | ~13 | Auth routing correctness |
| TEST-2 `parseWebhookUrl` | `src/lib/schema.test.ts` | Append | ~10 | SSRF prevention regression |
| TEST-3 `parseRunSandboxRequest` | `src/lib/schema.test.ts` | Append | ~7 | Path traversal in sessionId |
| TEST-4 `parseEnvironmentRequest` | `src/lib/schema.test.ts` | Append | ~9 | envType enum validation |
| TEST-5 `sealPrompt`/`openPrompt` | `src/lib/vault.test.ts` | New | ~9 | Encryption correctness |
| TEST-6 `requireAccess` | `src/lib/access.test.ts` | Append | ~3 | SEC-01 fail-open documented |

**Total: ~51 new tests across 2 new files and 1 existing file.**

---

## Out of Scope (deliberate)

The following are known gaps but are NOT recommended for pre-launch effort:

- **Route-level integration tests** — require Workers runtime (`miniflare`) or live deployment. High setup cost; Cloudflare's own integration test tooling is the right vehicle.
- **SandboxDO / AppBuilderDO tests** — Durable Object lifecycle tests require a Workers test runtime. Not feasible without a build step.
- **Full schema parser coverage** — 32 untested parsers. The 6 tests above cover the ones with real security implications. The remaining parsers (sweep, ablation, archaeology, etc.) validate inputs that don't touch auth, crypto, or SSRF paths — lower priority.
- **E2E / browser tests** — Not applicable to a Cloudflare Workers deployment in this pre-launch phase.

---

## How to Run Tests

```bash
node --import tsx/esm --test 'src/**/*.test.ts'
```

Or via the npm script alias:

```bash
npm test
```

All tests are synchronous-compatible and use the Node.js built-in test runner — no external framework.

---

_All proposed tests above require your approval before any files are created or modified._
