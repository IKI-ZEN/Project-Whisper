import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pipelineRoutes } from './pipelines'
import { makeEnv, mockD1, findHandler } from '../test/mockEnv'

const get = (url: string) => new Request(url, { method: 'GET' })

describe('pipelines list', () => {
  const list = findHandler(pipelineRoutes, 'GET', '/api/pipelines')

  it('shapes rows and returns total', async () => {
    const DB = mockD1((sql) =>
      sql.startsWith('SELECT COUNT')
        ? { total: 1 }
        : [{ id: 'p1', name: 'Flow', description: '', nodes: '[]', entry_id: 'n1', created_at: 1, updated_at: 2 }])
    const res = await list(get('https://x/api/pipelines'), makeEnv({ DB }), {})
    assert.equal(res.status, 200)
    const body = await res.json() as { data: { pipelines: Array<{ id: string; entryId: string }>; total: number } }
    assert.equal(body.data.total, 1)
    assert.equal(body.data.pipelines[0].entryId, 'n1')   // snake_case → camelCase shaping
  })

  it('500s when D1 throws', async () => {
    const DB = mockD1(() => { throw new Error('boom') })
    const res = await list(get('https://x/api/pipelines'), makeEnv({ DB }), {})
    assert.equal(res.status, 500)
  })
})

describe('pipelines getPipeline', () => {
  const getOne = findHandler(pipelineRoutes, 'GET', '/api/pipelines/:id')

  it('rejects a non-UUID id with 422', async () => {
    const res = await getOne(get('https://x/api/pipelines/nope'), makeEnv(), { id: 'nope' })
    assert.equal(res.status, 422)
  })

  it('404s when the pipeline is absent', async () => {
    const DB = mockD1(() => undefined)
    const res = await getOne(get('https://x'), makeEnv({ DB }), { id: '11111111-1111-4111-8111-111111111111' })
    assert.equal(res.status, 404)
  })
})
