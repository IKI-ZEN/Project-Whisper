import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { atlasRoutes } from './atlas'
import { makeEnv, mockD1, findHandler } from '../test/mockEnv'

const get = (url: string) => new Request(url, { method: 'GET' })

describe('atlas listPrompts', () => {
  const list = findHandler(atlasRoutes, 'GET', '/api/atlas/library')

  it('returns parsed prompts with total', async () => {
    const DB = mockD1(() => [
      { id: 'p1', text: 't', label: 'l', tags: '["x"]', environment_id: null, created_at: 1 },
    ])
    const res = await list(get('https://x/api/atlas/library'), makeEnv({ DB }), {})
    assert.equal(res.status, 200)
    const body = await res.json() as { data: { prompts: Array<{ tags: string[] }>; total: number } }
    assert.equal(body.data.total, 1)
    assert.deepEqual(body.data.prompts[0].tags, ['x'])
  })

  it('adds a WHERE clause when filtering by tag', async () => {
    const DB = mockD1(() => [])
    await list(get('https://x/api/atlas/library?tag=foo'), makeEnv({ DB }), {})
    assert.match(DB.calls[0].sql, /WHERE/)
    assert.match(DB.calls[0].sql, /tags LIKE/)
  })

  it('500s when D1 throws', async () => {
    const DB = mockD1(() => { throw new Error('boom') })
    const res = await list(get('https://x/api/atlas/library'), makeEnv({ DB }), {})
    assert.equal(res.status, 500)
  })
})

describe('atlas getPrompt validation', () => {
  const getOne = findHandler(atlasRoutes, 'GET', '/api/atlas/library/:id')

  it('rejects a non-UUID id with 422', async () => {
    const res = await getOne(get('https://x/api/atlas/library/nope'), makeEnv(), { id: 'nope' })
    assert.equal(res.status, 422)
  })
})
