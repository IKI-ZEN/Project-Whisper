import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { probesRoutes } from './probes'
import { makeEnv, mockD1, findHandler } from '../test/mockEnv'

// Node has no Workers cache API; embed() consults caches.default before the AI
// call, so give it an always-miss stub.
if (!('caches' in globalThis)) {
  ;(globalThis as Record<string, unknown>).caches = {
    default: { match: async () => undefined, put: async () => undefined },
  }
}

const PID = '11111111-1111-4111-8111-111111111111'

const post = (body: unknown) => new Request('https://x/api/probes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const createProbe = findHandler(probesRoutes, 'POST', '/api/probes')

describe('probe creation validation', () => {
  it('rejects a missing name with 422', async () => {
    const res = await createProbe(post({ prompt: 'p', tool: 'entropy' }), makeEnv(), {})
    assert.equal(res.status, 422)
  })

  it('rejects an unknown tool with 422', async () => {
    const res = await createProbe(post({ name: 'n', prompt: 'p', tool: 'rm-rf' }), makeEnv(), {})
    assert.equal(res.status, 422)
  })

  it('creates a probe and binds the webhook URL', async () => {
    const DB = mockD1()
    const res = await createProbe(
      post({ name: 'n', prompt: 'p', tool: 'entropy', webhookUrl: 'https://hooks.example.com/x' }),
      makeEnv({ DB }), {})
    assert.equal(res.status, 200)
    const insert = DB.calls.find(c => c.sql.startsWith('INSERT INTO probes'))!
    assert.ok(insert.binds.includes('https://hooks.example.com/x'))
  })
})

// Route-level enforcement of the SSRF guard (parseWebhookUrl). The ranges
// themselves are unit-tested in lib/schema; this locks the guard to the route.
describe('probe webhook URL SSRF guard at the route', () => {
  const cases = [
    ['plain http', 'http://example.com/x'],
    ['loopback /8 beyond 127.0.0.1', 'https://127.0.0.2/x'],
    ['CGNAT 100.64.0.0/10', 'https://100.64.0.1/x'],
    ['.internal hostname', 'https://metadata.internal/x'],
    ['link-local metadata IP', 'https://169.254.169.254/x'],
  ] as const

  for (const [label, url] of cases) {
    it(`rejects ${label} with 422`, async () => {
      const res = await createProbe(post({ name: 'n', prompt: 'p', tool: 'entropy', webhookUrl: url }), makeEnv(), {})
      assert.equal(res.status, 422)
    })
  }
})

describe('probe id-validated handlers', () => {
  it('GET /api/probes/:id rejects a non-UUID with 422', async () => {
    const getProbe = findHandler(probesRoutes, 'GET', '/api/probes/:id')
    const res = await getProbe(new Request('https://x'), makeEnv(), { id: 'nope' })
    assert.equal(res.status, 422)
  })

  it('GET /api/probes/:id 404s when the probe does not exist', async () => {
    const getProbe = findHandler(probesRoutes, 'GET', '/api/probes/:id')
    const res = await getProbe(new Request('https://x'), makeEnv(), { id: PID })
    assert.equal(res.status, 404)
  })

  it('PATCH /api/probes/:id with no fields → 400', async () => {
    const patchProbe = findHandler(probesRoutes, 'PATCH', '/api/probes/:id')
    const res = await patchProbe(new Request('https://x', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }), makeEnv(), { id: PID })
    assert.equal(res.status, 400)
  })

  it('DELETE /api/probes/:id rejects a non-UUID with 422', async () => {
    const deleteProbe = findHandler(probesRoutes, 'DELETE', '/api/probes/:id')
    const res = await deleteProbe(new Request('https://x', { method: 'DELETE' }), makeEnv(), { id: 'nope' })
    assert.equal(res.status, 422)
  })
})

// ── Webhook dispatch on threshold breach ──────────────────────────────────────
// Drives POST /api/probes/:id/run end-to-end with a mocked AI binding and a
// captured global fetch, asserting the dispatch contract: manual redirects
// (SSRF — a redirecting receiver must not bounce the POST past the URL
// validation done at creation time) and the v1 HMAC signature headers.

interface CapturedFetch { url: string; init: RequestInit }

function probeRow(threshold: Record<string, unknown>) {
  return {
    id: PID, name: 'n', description: '', prompt: 'p', tool: 'entropy',
    params: '{}', model: '', schedule: 'daily',
    threshold: JSON.stringify(threshold),
    sandbox_id: null, environment_id: null,
    webhook_url: 'https://hooks.example.com/alert',
    created_at: 1, last_run_at: null,
  }
}

// AI mock: embeds return one unit vector per input; completions are identical
// strings, so the entropy metric is deterministically 0.
const mockAI = {
  run: async (_model: string, inputs: Record<string, unknown>) =>
    Array.isArray(inputs.text)
      ? { data: (inputs.text as string[]).map(() => [1, 0, 0]) }
      : { response: 'stable' },
} as unknown as Ai

async function runWithCapturedFetch(threshold: Record<string, unknown>): Promise<{ status: number; captured: CapturedFetch[] }> {
  const runProbe = findHandler(probesRoutes, 'POST', '/api/probes/:id/run')
  const DB = mockD1((sql) => (sql.startsWith('SELECT * FROM probes') ? probeRow(threshold) : undefined))
  const env = makeEnv({ DB, AI: mockAI, SIGNING_SECRET: 'test-secret' } as Partial<Parameters<typeof runProbe>[1]>)

  const captured: CapturedFetch[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} })
    return new Response(null, { status: 200 })
  }) as typeof fetch
  try {
    const res = await runProbe(new Request('https://x', { method: 'POST' }), env, { id: PID })
    return { status: res.status, captured }
  } finally {
    globalThis.fetch = realFetch
  }
}

describe('probe run webhook dispatch', () => {
  it('breached threshold → signed POST with redirect: manual', async () => {
    // entropy of identical samples is 0, so 0 >= 0 breaches
    const { status, captured } = await runWithCapturedFetch({ metric: 'entropy', op: '>=', value: 0 })
    assert.equal(status, 200)
    assert.equal(captured.length, 1)
    assert.equal(captured[0].url, 'https://hooks.example.com/alert')
    assert.equal(captured[0].init.redirect, 'manual')
    const headers = captured[0].init.headers as Record<string, string>
    assert.match(headers['X-Whisper-Signature'], /^v1,sha256=[0-9a-f]{64}$/)
    assert.match(headers['X-Whisper-Timestamp'], /^\d+$/)
    const body = JSON.parse(String(captured[0].init.body)) as { probeId: string }
    assert.equal(body.probeId, PID)
  })

  it('unbreached threshold → no webhook fired', async () => {
    const { status, captured } = await runWithCapturedFetch({ metric: 'entropy', op: '>', value: 5 })
    assert.equal(status, 200)
    assert.equal(captured.length, 0)
  })
})
