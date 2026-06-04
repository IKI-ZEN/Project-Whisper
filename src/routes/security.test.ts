import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { securityRoutes } from './security'
import { makeEnv, mockD1, findHandler } from '../test/mockEnv'
import { MAX_CSP_REPORT_BYTES } from '../lib/constants'

const cspReport = findHandler(securityRoutes, 'POST', '/api/csp-report')

describe('csp-report', () => {
  it('always responds 204', async () => {
    const env = makeEnv({ DB: mockD1() })
    const res = await cspReport(new Request('https://x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report' },
      body: JSON.stringify({ 'csp-report': { 'violated-directive': 'script-src' } }),
    }), env, {})
    assert.equal(res.status, 204)
  })

  it('logs a violation under the size cap', async () => {
    const DB = mockD1()
    const env = makeEnv({ DB })
    await cspReport(new Request('https://x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report', 'Content-Length': '50' },
      body: JSON.stringify({ a: 1 }),
    }), env, {})
    assert.equal(DB.calls.length, 1)
    assert.match(DB.calls[0].sql, /INSERT INTO sandbox_events/)
  })

  it('skips logging (and reads no body) when over the size cap', async () => {
    const DB = mockD1()
    const env = makeEnv({ DB })
    const res = await cspReport(new Request('https://x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report', 'Content-Length': String(MAX_CSP_REPORT_BYTES + 1) },
      body: 'x',
    }), env, {})
    assert.equal(res.status, 204)
    assert.equal(DB.calls.length, 0)
  })
})
