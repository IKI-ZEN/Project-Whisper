import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseQueryInt, checkRateLimit, stripTrustHeaders } from './http.ts'
import type { Env } from '../types/env.ts'

// ── parseQueryInt ─────────────────────────────────────────────────────────────

describe('parseQueryInt', () => {
  function params(obj: Record<string, string>): URLSearchParams {
    return new URLSearchParams(obj)
  }

  it('returns fallback when key is absent', () => {
    assert.strictEqual(parseQueryInt(params({}), 'limit', 50), 50)
  })

  it('parses a valid integer', () => {
    assert.strictEqual(parseQueryInt(params({ limit: '25' }), 'limit', 50), 25)
  })

  it('returns fallback for non-numeric string', () => {
    assert.strictEqual(parseQueryInt(params({ limit: 'abc' }), 'limit', 50), 50)
  })

  it('returns fallback for empty string', () => {
    assert.strictEqual(parseQueryInt(params({ limit: '' }), 'limit', 50), 50)
  })

  it('clamps to min', () => {
    assert.strictEqual(parseQueryInt(params({ limit: '0' }), 'limit', 50, 1, 200), 1)
  })

  it('clamps to max', () => {
    assert.strictEqual(parseQueryInt(params({ limit: '999' }), 'limit', 50, 1, 200), 200)
  })

  it('accepts value exactly at min', () => {
    assert.strictEqual(parseQueryInt(params({ limit: '1' }), 'limit', 50, 1, 200), 1)
  })

  it('accepts value exactly at max', () => {
    assert.strictEqual(parseQueryInt(params({ limit: '200' }), 'limit', 50, 1, 200), 200)
  })

  it('returns fallback for float string (parseInt truncates, but still valid int)', () => {
    // parseInt('3.5') === 3 — valid finite int, not a fallback
    assert.strictEqual(parseQueryInt(params({ n: '3.5' }), 'n', 10), 3)
  })

  it('returns fallback for Infinity string', () => {
    // parseInt('Infinity') is NaN
    assert.strictEqual(parseQueryInt(params({ n: 'Infinity' }), 'n', 10), 10)
  })

  it('handles negative numbers within bounds', () => {
    assert.strictEqual(parseQueryInt(params({ offset: '-5' }), 'offset', 0, -100, 100), -5)
  })
})

// ── checkRateLimit ────────────────────────────────────────────────────────────

function makeMockKV(): KVNamespace {
  const store = new Map<string, string>()
  return {
    async get(key: string, type?: string) {
      const v = store.get(key)
      if (v === undefined) return null
      if (type === 'json') return JSON.parse(v)
      return v
    },
    async put(key: string, value: string, _opts?: unknown) {
      store.set(key, value)
    },
    async delete(key: string) { store.delete(key) },
    async list() { return { keys: [], list_complete: true, cursor: '' } },
    async getWithMetadata() { return { value: null, metadata: null } },
  } as unknown as KVNamespace
}

function makeEnv(kv: KVNamespace): Env {
  return { RATE_LIMITS: kv } as unknown as Env
}

describe('checkRateLimit', () => {
  it('returns null (allow) on first call', async () => {
    const env = makeEnv(makeMockKV())
    const res = await checkRateLimit('rl:test:1', 3, 60_000, env)
    assert.strictEqual(res, null)
  })

  it('returns null while under the limit', async () => {
    const kv  = makeMockKV()
    const env = makeEnv(kv)
    const key = 'rl:test:2'
    // Make 2 calls with max=3 — both should pass
    assert.strictEqual(await checkRateLimit(key, 3, 60_000, env), null)
    assert.strictEqual(await checkRateLimit(key, 3, 60_000, env), null)
  })

  it('returns 429 when limit is exceeded', async () => {
    const kv  = makeMockKV()
    const env = makeEnv(kv)
    const key = 'rl:test:3'
    const max = 2
    // Exhaust the limit
    await checkRateLimit(key, max, 60_000, env)
    await checkRateLimit(key, max, 60_000, env)
    // Third call should be blocked
    const res = await checkRateLimit(key, max, 60_000, env)
    assert.ok(res instanceof Response)
    assert.strictEqual(res.status, 429)
  })

  it('returns 429 with JSON body', async () => {
    const kv  = makeMockKV()
    const env = makeEnv(kv)
    const key = 'rl:test:4'
    await checkRateLimit(key, 1, 60_000, env)
    const res = await checkRateLimit(key, 1, 60_000, env)
    assert.ok(res instanceof Response)
    const body = await res.json() as { ok: boolean; error: string }
    assert.strictEqual(body.ok, false)
    assert.ok(typeof body.error === 'string')
  })

  it('uses custom message in 429 body', async () => {
    const kv  = makeMockKV()
    const env = makeEnv(kv)
    const key = 'rl:test:5'
    await checkRateLimit(key, 1, 60_000, env, 'Custom limit message')
    const res = await checkRateLimit(key, 1, 60_000, env, 'Custom limit message')
    assert.ok(res instanceof Response)
    const body = await res.json() as { error: string }
    assert.ok(body.error.includes('Custom limit message'))
  })

  it('separate keys have independent counters', async () => {
    const kv  = makeMockKV()
    const env = makeEnv(kv)
    // Fill key A to limit
    await checkRateLimit('rl:a', 1, 60_000, env)
    const blocked = await checkRateLimit('rl:a', 1, 60_000, env)
    assert.ok(blocked instanceof Response)
    // Key B should still be allowed
    const allowed = await checkRateLimit('rl:b', 1, 60_000, env)
    assert.strictEqual(allowed, null)
  })
})

// ── stripTrustHeaders: forged trust headers never reach handlers ────────────────

describe('stripTrustHeaders', () => {
  it('removes a client-supplied X-Whisper-Identity', () => {
    const out = stripTrustHeaders(new Request('https://x/run', {
      method: 'POST', headers: { 'X-Whisper-Identity': 'attacker@evil.com' },
    }))
    assert.strictEqual(out.headers.get('X-Whisper-Identity'), null)
  })

  it('removes a client-supplied X-Whisper-App-Id', () => {
    const out = stripTrustHeaders(new Request('https://x/run', {
      headers: { 'X-Whisper-App-Id': 'some-app' },
    }))
    assert.strictEqual(out.headers.get('X-Whisper-App-Id'), null)
  })

  it('preserves unrelated headers', () => {
    const out = stripTrustHeaders(new Request('https://x/run', {
      headers: { 'X-Whisper-Identity': 'evil', 'Content-Type': 'application/json', 'X-App-Token': 'tok' },
    }))
    assert.strictEqual(out.headers.get('X-Whisper-Identity'), null)
    assert.strictEqual(out.headers.get('Content-Type'), 'application/json')
    assert.strictEqual(out.headers.get('X-App-Token'), 'tok')
  })

  it('returns the same request unchanged when no trust headers are present', () => {
    const req = new Request('https://x/run', { headers: { 'Content-Type': 'application/json' } })
    assert.strictEqual(stripTrustHeaders(req), req)
  })
})
