import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { vaultRoutes } from './vault'
import { makeEnv, mockD1, findHandler } from '../test/mockEnv'
import { LIST_LIMIT_MAX } from '../lib/constants'

const get = (url: string) => new Request(url, { method: 'GET' })

describe('vault list', () => {
  const list = findHandler(vaultRoutes, 'GET', '/api/vault')

  it('returns records and total from D1', async () => {
    const DB = mockD1((sql) =>
      sql.startsWith('SELECT COUNT')
        ? { total: 2 }
        : [
            { id: 'a', prompt: 'p', response: 'r', metadata: '{}', tags: '[]', created_at: 2 },
            { id: 'b', prompt: 'p', response: 'r', metadata: '{}', tags: '[]', created_at: 1 },
          ])
    const res = await list(get('https://x/api/vault'), makeEnv({ DB }), {})
    assert.equal(res.status, 200)
    const body = await res.json() as { data: { records: unknown[]; total: number } }
    assert.equal(body.data.total, 2)
    assert.equal(body.data.records.length, 2)
  })

  it('clamps limit to LIST_LIMIT_MAX (via parseQueryInt) in the SQL bind', async () => {
    const DB = mockD1((sql) => (sql.startsWith('SELECT COUNT') ? { total: 0 } : []))
    await list(get(`https://x/api/vault?limit=99999`), makeEnv({ DB }), {})
    // The data query binds [...filters, limit, offset]; limit is the 2nd-to-last bind.
    const dataCall = DB.calls.find(c => c.sql.includes('FROM vault_records') && !c.sql.includes('COUNT'))!
    const limitBind = dataCall.binds[dataCall.binds.length - 2]
    assert.equal(limitBind, LIST_LIMIT_MAX)
  })

  it('500s when D1 throws', async () => {
    const DB = mockD1(() => { throw new Error('boom') })
    const res = await list(get('https://x/api/vault'), makeEnv({ DB }), {})
    assert.equal(res.status, 500)
  })
})

describe('vault id-validated handlers', () => {
  it('DELETE /api/vault/:id rejects a non-UUID with 422', async () => {
    const remove = findHandler(vaultRoutes, 'DELETE', '/api/vault/:id')
    const res = await remove(new Request('https://x', { method: 'DELETE' }), makeEnv(), { id: 'nope' })
    assert.equal(res.status, 422)
  })

  it('POST /api/vault/:id/tags rejects a non-UUID with 422', async () => {
    const updateTags = findHandler(vaultRoutes, 'POST', '/api/vault/:id/tags')
    const res = await updateTags(new Request('https://x', { method: 'POST' }), makeEnv(), { id: 'nope' })
    assert.equal(res.status, 422)
  })

  it('DELETE /api/vault/:id 404s when no row was deleted', async () => {
    const remove = findHandler(vaultRoutes, 'DELETE', '/api/vault/:id')
    const DB = mockD1(() => ({ changes: 0 }))
    const res = await remove(new Request('https://x', { method: 'DELETE' }), makeEnv({ DB }),
      { id: '11111111-1111-4111-8111-111111111111' })
    assert.equal(res.status, 404)
  })
})
