import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { whispererRoutes } from './whisperer'
import { makeEnv, findHandler } from '../test/mockEnv'

const post = (path: string, body: unknown) => new Request(`https://x${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// piiScan is the one fully AI-free research endpoint — test it end-to-end.
describe('POST /api/ai/pii-scan', () => {
  const piiScan = findHandler(whispererRoutes, 'POST', '/api/ai/pii-scan')

  it('rejects a missing text field with 422', async () => {
    const res = await piiScan(post('/api/ai/pii-scan', {}), makeEnv(), {})
    assert.equal(res.status, 422)
  })

  it('rejects unknown PII types with 422', async () => {
    const res = await piiScan(post('/api/ai/pii-scan', { text: 'x', types: ['blood-type'] }), makeEnv(), {})
    assert.equal(res.status, 422)
  })

  it('detects an email address and reports its span', async () => {
    const res = await piiScan(post('/api/ai/pii-scan', { text: 'mail me at jo@example.com please' }), makeEnv(), {})
    assert.equal(res.status, 200)
    const body = await res.json() as { data: { count: number; matches: Array<{ type: string }> } }
    assert.equal(body.data.count, 1)
    assert.equal(body.data.matches[0].type, 'email')
  })

  it('redact:true returns the redacted text', async () => {
    const res = await piiScan(post('/api/ai/pii-scan', { text: 'jo@example.com', redact: true }), makeEnv(), {})
    const body = await res.json() as { data: { redacted?: string } }
    assert.ok(body.data.redacted)
    assert.ok(!body.data.redacted.includes('jo@example.com'))
  })
})

// The AI-backed endpoints all parse before touching env.AI, so their
// validation branches are testable without any model mock.
describe('whisperer request validation (pre-AI)', () => {
  it('POST /api/ai/think without a prompt → 422', async () => {
    const think = findHandler(whispererRoutes, 'POST', '/api/ai/think')
    const res = await think(post('/api/ai/think', {}), makeEnv(), {})
    assert.equal(res.status, 422)
  })

  it('POST /api/ai/think with a non-JSON body → 400', async () => {
    const think = findHandler(whispererRoutes, 'POST', '/api/ai/think')
    const res = await think(new Request('https://x/api/ai/think', { method: 'POST', body: 'nope' }), makeEnv(), {})
    assert.equal(res.status, 400)
  })

  it('POST /api/ai/entropy without a prompt → 422', async () => {
    const entropy = findHandler(whispererRoutes, 'POST', '/api/ai/entropy')
    const res = await entropy(post('/api/ai/entropy', {}), makeEnv(), {})
    assert.equal(res.status, 422)
  })
})
