import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertionRoutes } from './assertions'
import { makeEnv, mockD1, findHandler } from '../test/mockEnv'

const SID = '11111111-1111-4111-8111-111111111111'

const post = (body: unknown) => new Request('https://x/api/assertions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const createSuite = findHandler(assertionRoutes, 'POST', '/api/assertions')

describe('assertion suite creation validation', () => {
  it('rejects a missing name with 422', async () => {
    const res = await createSuite(post({ cases: [] }), makeEnv(), {})
    assert.equal(res.status, 422)
  })

  it('rejects an unknown assertion type with 422', async () => {
    const res = await createSuite(post({
      name: 'n',
      cases: [{ prompt: 'p', assertions: [{ type: 'explodes' }] }],
    }), makeEnv(), {})
    assert.equal(res.status, 422)
  })

  it('rejects more than 10 assertions in a case with 422', async () => {
    const res = await createSuite(post({
      name: 'n',
      cases: [{ prompt: 'p', assertions: Array.from({ length: 11 }, () => ({ type: 'guard-clean' })) }],
    }), makeEnv(), {})
    assert.equal(res.status, 422)
  })

  it('rejects more than 50 cases with 422', async () => {
    const res = await createSuite(post({
      name: 'n',
      cases: Array.from({ length: 51 }, () => ({ prompt: 'p', assertions: [] })),
    }), makeEnv(), {})
    assert.equal(res.status, 422)
  })

  it('creates a valid suite (200) and inserts it', async () => {
    const DB = mockD1()
    const res = await createSuite(post({
      name: 'smoke',
      cases: [{ prompt: 'p', assertions: [{ type: 'contains', value: 'x' }] }],
    }), makeEnv({ DB }), {})
    assert.equal(res.status, 200)
    assert.ok(DB.calls.some(c => c.sql.startsWith('INSERT INTO assertion_suites')))
  })
})

describe('assertion suite id-validated handlers', () => {
  it('GET /api/assertions/:id rejects a non-UUID with 422', async () => {
    const getSuite = findHandler(assertionRoutes, 'GET', '/api/assertions/:id')
    const res = await getSuite(new Request('https://x'), makeEnv(), { id: 'nope' })
    assert.equal(res.status, 422)
  })

  it('GET /api/assertions/:id 404s when the suite does not exist', async () => {
    const getSuite = findHandler(assertionRoutes, 'GET', '/api/assertions/:id')
    const res = await getSuite(new Request('https://x'), makeEnv(), { id: SID })
    assert.equal(res.status, 404)
  })

  it('DELETE /api/assertions/:id rejects a non-UUID with 422', async () => {
    const deleteSuite = findHandler(assertionRoutes, 'DELETE', '/api/assertions/:id')
    const res = await deleteSuite(new Request('https://x', { method: 'DELETE' }), makeEnv(), { id: 'nope' })
    assert.equal(res.status, 422)
  })
})
