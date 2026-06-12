import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { monitorRoutes } from './monitor'
import { makeEnv, findHandler } from '../test/mockEnv'
import { reportError } from '../lib/events'
import type { Env } from '../types/env'

// The monitor endpoints expose the audit trail (including operator identities)
// and guard telemetry, so all three are fail-closed behind Cloudflare Access
// (regression: they previously had no gate at all).

const stream   = findHandler(monitorRoutes, 'GET', '/api/monitor/stream')
const audit    = findHandler(monitorRoutes, 'GET', '/api/monitor/audit')
const patterns = findHandler(monitorRoutes, 'GET', '/api/monitor/patterns')

function accessEnv(): Env {
  return makeEnv({
    CF_ACCESS_AUD:         'test-aud',
    CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.test',
  } as Partial<Env>)
}

const req = (path: string) => new Request(`https://x${path}`)

describe('monitor endpoints require Cloudflare Access', () => {
  it('GET /api/monitor/stream without an Access identity → 401', async () => {
    const res = await stream(req('/api/monitor/stream'), accessEnv(), {})
    assert.equal(res.status, 401)
  })

  it('GET /api/monitor/audit without an Access identity → 401', async () => {
    const res = await audit(req('/api/monitor/audit'), accessEnv(), {})
    assert.equal(res.status, 401)
  })

  it('GET /api/monitor/patterns without an Access identity → 401', async () => {
    const res = await patterns(req('/api/monitor/patterns'), accessEnv(), {})
    assert.equal(res.status, 401)
  })

  it('Access not configured → handlers fall through to the DB (200)', async () => {
    const res = await audit(req('/api/monitor/audit'), makeEnv(), {})
    assert.equal(res.status, 200)
  })
})

describe('reportError ANALYTICS binding', () => {
  it('does not throw when ANALYTICS is absent (optional binding)', () => {
    const env = makeEnv()
    assert.equal(env.ANALYTICS, undefined)
    assert.doesNotThrow(() => reportError(env, 'test-context', new Error('test')))
  })
})
