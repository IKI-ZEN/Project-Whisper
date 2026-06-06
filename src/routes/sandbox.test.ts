import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sandboxRoutes } from './sandbox'
import { makeEnv, mockKV, mockDONamespace, findHandler } from '../test/mockEnv'
import { signPayload } from '../lib/vault'
import { now } from '../lib/utils'
import { SANDBOX_KEY_PREFIX } from '../lib/constants'

const req = (url = 'https://x/api/sandbox', init?: RequestInit) => new Request(url, init)

// Seed the registry with sandbox metadata (stored as KV value metadata).
function seedRegistry(metas: Array<{ id: string; fromEnv?: boolean; createdAt: number }>) {
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

describe('session token validation on GET /history (header, not URL)', () => {
  it('fail-open: a request with no token is allowed through to the DO', async () => {
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
