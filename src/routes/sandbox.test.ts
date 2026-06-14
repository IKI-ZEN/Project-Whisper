import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sandboxRoutes } from './sandbox'
import { makeEnv, mockKV, mockDONamespace, findHandler } from '../test/mockEnv'
import { signPayload } from '../lib/vault'
import { now } from '../lib/utils'
import { SANDBOX_KEY_PREFIX } from '../lib/constants'

const req = (url = 'https://x/api/sandbox', init?: RequestInit) => new Request(url, init)

// Seed the registry with sandbox metadata (stored as KV value metadata).
function seedRegistry(metas: Array<{ id: string; fromEnv?: boolean; fromLab?: boolean; fromDashboard?: boolean; createdAt: number }>) {
  const SANDBOX_REGISTRY = mockKV()
  for (const m of metas) {
    void SANDBOX_REGISTRY.put(`${SANDBOX_KEY_PREFIX}${m.id}`, m.id, {
      metadata: { name: m.id, description: '', model: 'x', createdAt: m.createdAt, ...m },
    })
  }
  return makeEnv({ SANDBOX_REGISTRY })
}

describe('sandbox list', () => {
  const list = findHandler(sandboxRoutes, 'GET', '/api/sandbox')

  it('returns an empty list when the registry is empty', async () => {
    const res = await list(req(), makeEnv(), {})
    assert.equal(res.status, 200)
    const body = await res.json() as { ok: boolean; data: { apps: unknown[]; total: number } }
    assert.equal(body.ok, true)
    assert.equal(body.data.total, 0)
  })

  it('returns entries newest-first', async () => {
    const env = seedRegistry([
      { id: '11111111-1111-4111-8111-111111111111', createdAt: 100 },
      { id: '22222222-2222-4222-8222-222222222222', createdAt: 300 },
      { id: '33333333-3333-4333-8333-333333333333', createdAt: 200 },
    ])
    const res = await list(req(), env, {})
    const body = await res.json() as { data: { apps: Array<{ createdAt: number }>; total: number } }
    assert.equal(body.data.total, 3)
    assert.deepEqual(body.data.apps.map(a => a.createdAt), [300, 200, 100])
  })

  it('filters to envs only with ?only=envs', async () => {
    const env = seedRegistry([
      { id: '11111111-1111-4111-8111-111111111111', createdAt: 100 },
      { id: '22222222-2222-4222-8222-222222222222', createdAt: 200, fromEnv: true },
    ])
    const res = await list(req('https://x/api/sandbox?only=envs'), env, {})
    const body = await res.json() as { data: { total: number } }
    assert.equal(body.data.total, 1)
  })

  it('filters to labs only with ?only=labs', async () => {
    const env = seedRegistry([
      { id: '11111111-1111-4111-8111-111111111111', createdAt: 100 },
      { id: '22222222-2222-4222-8222-222222222222', createdAt: 200, fromLab: true },
      { id: '33333333-3333-4333-8333-333333333333', createdAt: 300, fromEnv: true },
    ])
    const res = await list(req('https://x/api/sandbox?only=labs'), env, {})
    const body = await res.json() as { data: { total: number } }
    assert.equal(body.data.total, 1)
  })

  it('?only=apps excludes labs, environments, and dashboards', async () => {
    const env = seedRegistry([
      { id: '11111111-1111-4111-8111-111111111111', createdAt: 100 },
      { id: '22222222-2222-4222-8222-222222222222', createdAt: 200, fromLab: true },
      { id: '33333333-3333-4333-8333-333333333333', createdAt: 300, fromEnv: true },
      { id: '44444444-4444-4444-8444-444444444444', createdAt: 400, fromDashboard: true },
    ])
    const res = await list(req('https://x/api/sandbox?only=apps'), env, {})
    const body = await res.json() as { data: { total: number } }
    assert.equal(body.data.total, 1)
  })
})

describe('sandbox id-validated handlers reject bad ids', () => {
  // getConfig validates the :id and 404s/422s before touching any binding.
  const getConfig = findHandler(sandboxRoutes, 'GET', '/api/sandbox/:id')
  it('GET /api/sandbox/:id rejects a non-UUID id', async () => {
    const res = await getConfig(req('https://x/api/sandbox/nope'), makeEnv(), { id: 'nope' })
    assert.ok(res.status === 422 || res.status === 404)
  })
})

// ── Session token (Signal B) — issuance + validation ──────────────────────────

const SID    = '11111111-1111-4111-8111-111111111111'
const SECRET = 'test-signing-secret'
const issue   = findHandler(sandboxRoutes, 'POST', '/api/sandbox/:id/session')
const history = findHandler(sandboxRoutes, 'GET',  '/api/sandbox/:id/history')

// Env where the sandbox exists and the DO returns a canned history payload, so a
// request that passes session-token validation reaches the DO and 200s.
function sessionEnv() {
  const SANDBOX_REGISTRY = mockKV()
  void SANDBOX_REGISTRY.put(`${SANDBOX_KEY_PREFIX}${SID}`, SID, { metadata: { id: SID, name: SID, createdAt: 1 } })
  const SANDBOX = mockDONamespace(async () =>
    new Response(JSON.stringify({ ok: true, data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  return makeEnv({ SANDBOX_REGISTRY, SANDBOX, SIGNING_SECRET: SECRET })
}

const histReq = (token?: string) =>
  new Request(`https://x/api/sandbox/${SID}/history?sessionId=s1`,
    token ? { headers: { 'X-Session-Token': token } } : undefined)

describe('session token issuance', () => {
  it('issues a token of the form {expiresAt}.{hmac} (expiry embedded, CWE-613)', async () => {
    const res = await issue(new Request(`https://x/api/sandbox/${SID}/session`, { method: 'POST' }), sessionEnv(), { id: SID })
    assert.equal(res.status, 200)
    const body = await res.json() as { data: { sessionId: string; token: string } }
    assert.match(body.data.token, /^\d+\.[0-9a-f]{64}$/)
  })
})

// Env where signing is set but Cloudflare Access is NOT configured — requireAccess
// is a no-op, so the read gate falls back to token-only (token still optional).
describe('session token validation on GET /history (header, not URL)', () => {
  it('no token + Access not configured → allowed through to the DO', async () => {
    const res = await history(histReq(), sessionEnv(), { id: SID })
    assert.equal(res.status, 200)
  })

  it('rejects a malformed token (no dot) with 401', async () => {
    const res = await history(histReq('deadbeef'), sessionEnv(), { id: SID })
    assert.equal(res.status, 401)
  })

  it('rejects an expired but correctly-signed token with 401', async () => {
    const past = 1   // 1970 — long expired
    const sig  = await signPayload(`${SID}:s1:${past}`, SECRET)
    const res  = await history(histReq(`${past}.${sig}`), sessionEnv(), { id: SID })
    assert.equal(res.status, 401)
  })

  it('rejects a tampered token (future expiry, wrong signature) with 401', async () => {
    const future = now() + 1_000_000
    const res = await history(histReq(`${future}.${'0'.repeat(64)}`), sessionEnv(), { id: SID })
    assert.equal(res.status, 401)
  })

  it('accepts a freshly issued token and reaches the DO (200)', async () => {
    const env = sessionEnv()
    const issued = await issue(
      new Request(`https://x/api/sandbox/${SID}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 's1' }) }),
      env, { id: SID },
    )
    const { data } = await issued.json() as { data: { token: string } }
    const res = await history(histReq(data.token), env, { id: SID })
    assert.equal(res.status, 200)
  })
})

// With Cloudflare Access configured, GET /history is fail-closed: a request with
// neither a session token nor an Access identity (no Cf-Access-Jwt-Assertion) is
// rejected, closing the unauthenticated default-thread read.
describe('GET /history read gate when Cloudflare Access is configured', () => {
  function accessEnv() {
    const env = sessionEnv() as unknown as Record<string, unknown>
    env.CF_ACCESS_AUD         = 'test-aud'
    env.CF_ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.test'
    return env as unknown as Parameters<typeof history>[1]
  }

  it('no token and no Access identity → 401', async () => {
    const res = await history(histReq(), accessEnv(), { id: SID })
    assert.equal(res.status, 401)
  })

  it('a valid session token bypasses the Access requirement → 200', async () => {
    const env = accessEnv()
    const issued = await issue(
      new Request(`https://x/api/sandbox/${SID}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 's1' }) }),
      env, { id: SID },
    )
    const { data } = await issued.json() as { data: { token: string } }
    const res = await history(histReq(data.token), env, { id: SID })
    assert.equal(res.status, 200)
  })
})

// /export-session returns the same conversation data as /history and must share
// the same fail-closed gate (regression: it previously had no gate at all).
describe('GET /export-session shares the conversation read gate', () => {
  const exportSession = findHandler(sandboxRoutes, 'GET', '/api/sandbox/:id/export-session')
  function exportAccessEnv() {
    const env = sessionEnv() as unknown as Record<string, unknown>
    env.CF_ACCESS_AUD         = 'test-aud'
    env.CF_ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.test'
    return env as unknown as Parameters<typeof exportSession>[1]
  }
  const expReq = (token?: string) =>
    new Request(`https://x/api/sandbox/${SID}/export-session?sessionId=s1`,
      token ? { headers: { 'X-Session-Token': token } } : undefined)

  it('rejects a non-UUID id with 422', async () => {
    const res = await exportSession(new Request('https://x/api/sandbox/nope/export-session'), sessionEnv(), { id: 'nope' })
    assert.equal(res.status, 422)
  })

  it('no token and no Access identity → 401', async () => {
    const res = await exportSession(expReq(), exportAccessEnv(), { id: SID })
    assert.equal(res.status, 401)
  })

  it('a valid session token is accepted (not 401)', async () => {
    const env = exportAccessEnv()
    const issued = await issue(
      new Request(`https://x/api/sandbox/${SID}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 's1' }) }),
      env, { id: SID },
    )
    const { data } = await issued.json() as { data: { token: string } }
    const res = await exportSession(expReq(data.token), env, { id: SID })
    assert.notEqual(res.status, 401)
  })
})

// /export returns the plaintext systemPrompt (unsealed by the DO), so it must
// require an Access identity (regression: it previously had no gate at all,
// making the at-rest encryption and the getConfig redaction moot).
describe('GET /export requires Cloudflare Access', () => {
  const exportConfig = findHandler(sandboxRoutes, 'GET', '/api/sandbox/:id/export')
  function exportEnv(withAccess: boolean) {
    const env = sessionEnv() as unknown as Record<string, unknown>
    if (withAccess) {
      env.CF_ACCESS_AUD         = 'test-aud'
      env.CF_ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.test'
    }
    return env as unknown as Parameters<typeof exportConfig>[1]
  }

  it('no Access identity when Access is configured → 401', async () => {
    const res = await exportConfig(new Request(`https://x/api/sandbox/${SID}/export`), exportEnv(true), { id: SID })
    assert.equal(res.status, 401)
  })

  it('Access not configured → falls through to the DO (200)', async () => {
    const res = await exportConfig(new Request(`https://x/api/sandbox/${SID}/export`), exportEnv(false), { id: SID })
    assert.equal(res.status, 200)
  })
})

describe('sandbox fork preserves type flags', () => {
  const fork = findHandler(sandboxRoutes, 'POST', '/api/sandbox/:id/fork')

  // DO that answers a config GET with a canned SandboxConfig and ok's everything else.
  function forkEnv(meta: Record<string, unknown>) {
    const SANDBOX_REGISTRY = mockKV()
    void SANDBOX_REGISTRY.put(`${SANDBOX_KEY_PREFIX}${SID}`, SID, {
      metadata: { id: SID, name: 'Source', description: 'd', model: 'm', createdAt: 1, ...meta },
    })
    const SANDBOX = mockDONamespace(async (r: Request) => {
      if (r.url.endsWith('/config') && r.method === 'GET') {
        return new Response(JSON.stringify({ ok: true, data: {
          id: SID, name: 'Source', description: 'd', systemPrompt: 's', tools: [],
          model: 'm', temperature: 0.7, maxTokens: 1024, memory: [], createdAt: 1, updatedAt: 1,
        } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    return { env: makeEnv({ SANDBOX_REGISTRY, SANDBOX }), SANDBOX_REGISTRY }
  }

  const forkReq = () => new Request(`https://x/api/sandbox/${SID}/fork`, { method: 'POST' })

  it('an environment fork lands at /env/:id and keeps fromEnv + whispererFeatures', async () => {
    const { env, SANDBOX_REGISTRY } = forkEnv({ fromEnv: true, fromVibe: true, whispererFeatures: ['sensitivity', 'entropy'] })
    const res = await fork(forkReq(), env, { id: SID })
    assert.equal(res.status, 201)
    const body = await res.json() as { data: { id: string; appUrl: string } }
    assert.match(body.data.appUrl, /^\/env\//, 'env fork must return an /env/ URL')

    const entry = await SANDBOX_REGISTRY.getWithMetadata(`${SANDBOX_KEY_PREFIX}${body.data.id}`)
    const m = entry.metadata as { fromEnv?: boolean; fromVibe?: boolean; whispererFeatures?: string[] }
    assert.equal(m.fromEnv, true)
    assert.equal(m.fromVibe, true)
    assert.deepEqual(m.whispererFeatures, ['sensitivity', 'entropy'])
  })

  it('a plain app fork lands at /app/:id and carries no env flags', async () => {
    const { env, SANDBOX_REGISTRY } = forkEnv({})
    const res = await fork(forkReq(), env, { id: SID })
    assert.equal(res.status, 201)
    const body = await res.json() as { data: { id: string; appUrl: string } }
    assert.match(body.data.appUrl, /^\/app\//, 'app fork must return an /app/ URL')

    const entry = await SANDBOX_REGISTRY.getWithMetadata(`${SANDBOX_KEY_PREFIX}${body.data.id}`)
    const m = entry.metadata as { fromEnv?: boolean }
    assert.notEqual(m.fromEnv, true)
  })
})
