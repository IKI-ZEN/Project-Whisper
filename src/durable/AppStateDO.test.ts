import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AppStateDO } from './AppStateDO'
import { mockDOStorage, makeEnv } from '../test/mockEnv'
import { MAX_APP_STATE_KEY_LEN, MAX_APP_STATE_VALUE_LEN, MAX_APP_STATE_KEYS } from '../lib/constants'

// AppStateDO is a plain class (state + env constructor), so it is driven directly
// through its fetch() with a Map-backed storage double.
function makeDO() {
  const storage = mockDOStorage()
  // Only `storage` is read by AppStateDO; cast the partial state to the full type.
  const state = { storage } as unknown as DurableObjectState
  return { do: new AppStateDO(state, makeEnv()), storage }
}

const put = (key: string, body: unknown) =>
  new Request(`https://do/kv/${encodeURIComponent(key)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

describe('AppStateDO', () => {
  it('round-trips a value through PUT then GET', async () => {
    const { do: d } = makeDO()
    const pr = await d.fetch(put('greeting', { value: 'hello' }))
    assert.equal(pr.status, 200)
    const gr = await d.fetch(new Request('https://do/kv/greeting'))
    assert.equal(gr.status, 200)
    const body = await gr.json() as { ok: boolean; data: { value: string } }
    assert.equal(body.data.value, 'hello')
  })

  it('404s on a missing key', async () => {
    const { do: d } = makeDO()
    const r = await d.fetch(new Request('https://do/kv/absent'))
    assert.equal(r.status, 404)
  })

  it('rejects an over-long key with 422', async () => {
    const { do: d } = makeDO()
    const longKey = 'a'.repeat(MAX_APP_STATE_KEY_LEN + 1)
    const r = await d.fetch(put(longKey, { value: 'x' }))
    assert.equal(r.status, 422)
  })

  it('rejects keys with illegal characters (regex) with 422', async () => {
    const { do: d } = makeDO()
    const r = await d.fetch(put('bad key!', { value: 'x' }))
    assert.equal(r.status, 422)
  })

  it('rejects an over-long value with 422', async () => {
    const { do: d } = makeDO()
    const r = await d.fetch(put('k', { value: 'v'.repeat(MAX_APP_STATE_VALUE_LEN + 1) }))
    assert.equal(r.status, 422)
  })

  it('rejects a non-string value with 422', async () => {
    const { do: d } = makeDO()
    const r = await d.fetch(put('k', { value: 42 }))
    assert.equal(r.status, 422)
  })

  it('rejects invalid JSON with 400', async () => {
    const { do: d } = makeDO()
    const r = await d.fetch(new Request('https://do/kv/k', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{not json',
    }))
    assert.equal(r.status, 400)
  })

  it('lists entries and reports truncation at the cap', async () => {
    const { do: d } = makeDO()
    for (let i = 0; i < MAX_APP_STATE_KEYS + 5; i++) await d.fetch(put('k' + i, { value: String(i) }))
    const r = await d.fetch(new Request('https://do/kv'))
    const body = await r.json() as { data: { entries: unknown[]; truncated: boolean } }
    assert.equal(body.data.entries.length, MAX_APP_STATE_KEYS)
    assert.equal(body.data.truncated, true)
  })

  it('DELETE on a key removes it', async () => {
    const { do: d } = makeDO()
    await d.fetch(put('k', { value: 'v' }))
    await d.fetch(new Request('https://do/kv/k', { method: 'DELETE' }))
    const r = await d.fetch(new Request('https://do/kv/k'))
    assert.equal(r.status, 404)
  })

  it('clearAll wipes only the kv/ prefix', async () => {
    const { do: d, storage } = makeDO()
    await d.fetch(put('k', { value: 'v' }))
    storage.map.set('meta/internal', 'keep')   // simulate non-user DO metadata
    await d.fetch(new Request('https://do/', { method: 'DELETE' }))
    assert.equal(storage.map.has('meta/internal'), true)
    const r = await d.fetch(new Request('https://do/kv/k'))
    assert.equal(r.status, 404)
  })
})
