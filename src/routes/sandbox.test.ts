import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sandboxRoutes } from './sandbox'
import { makeEnv, mockKV, findHandler } from '../test/mockEnv'
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
