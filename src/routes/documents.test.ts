import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { documentRoutes } from './documents'
import { makeEnv, mockKV, mockR2, findHandler } from '../test/mockEnv'
import { SANDBOX_KEY_PREFIX } from '../lib/constants'

const SID = '11111111-1111-4111-8111-111111111111'
const req = (init?: RequestInit) => new Request('https://x', init)

// Seed SANDBOX_REGISTRY so sandboxExists() passes for SID.
function envWithSandbox(filesPageSize?: number) {
  const SANDBOX_REGISTRY = mockKV()
  void SANDBOX_REGISTRY.put(`${SANDBOX_KEY_PREFIX}${SID}`, SID)
  const FILES = mockR2(filesPageSize)
  return { env: makeEnv({ SANDBOX_REGISTRY, FILES }), FILES }
}

describe('documents list — validation', () => {
  const list = findHandler(documentRoutes, 'GET', '/api/sandbox/:id/documents')

  it('rejects a bad sandbox id with 400', async () => {
    const res = await list(req(), makeEnv(), { id: 'nope' })
    assert.equal(res.status, 400)
  })

  it('404s when the sandbox does not exist', async () => {
    const res = await list(req(), makeEnv(), { id: SID })
    assert.equal(res.status, 404)
  })
})

describe('documents list — listAllR2 pagination (A1 regression)', () => {
  it('returns every document even when there are more than one R2 page', async () => {
    const { env, FILES } = envWithSandbox(10)  // 10/page forces multi-page paging
    const TOTAL = 25
    for (let i = 0; i < TOTAL; i++) {
      await FILES.put(`sandboxes/${SID}/documents/doc${i}`, new Uint8Array([0]).buffer, {
        customMetadata: { name: `doc${i}`, mimeType: 'text/plain', status: 'indexed' },
      })
    }
    const list = findHandler(documentRoutes, 'GET', '/api/sandbox/:id/documents')
    const res = await list(req(), env, { id: SID })
    assert.equal(res.status, 200)
    const body = await res.json() as { data: { docs: unknown[]; total: number } }
    // A single FILES.list() would have stopped at 10 — listAllR2 must return all 25.
    assert.equal(body.data.total, TOTAL)
  })
})

describe('documents delete — validation', () => {
  const del = findHandler(documentRoutes, 'DELETE', '/api/sandbox/:id/documents/:docId')

  it('rejects a bad sandbox id with 400', async () => {
    const res = await del(req({ method: 'DELETE' }), makeEnv(), { id: 'nope', docId: SID })
    assert.equal(res.status, 400)
  })

  it('rejects a bad document id with 422', async () => {
    const res = await del(req({ method: 'DELETE' }), makeEnv(), { id: SID, docId: 'nope' })
    assert.equal(res.status, 422)
  })

  it('404s when the document is absent', async () => {
    const { env } = envWithSandbox()
    const res = await del(req({ method: 'DELETE' }), env, { id: SID, docId: SID })
    assert.equal(res.status, 404)
  })
})
