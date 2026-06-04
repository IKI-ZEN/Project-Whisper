import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { appstateRoutes } from './appstate'
import { makeEnv, mockR2, mockDONamespace, findHandler } from '../test/mockEnv'
import { IMAGE_MAX_BYTES } from '../lib/constants'

const BAD_ID  = 'not-a-uuid'
const GOOD_ID = '11111111-1111-4111-8111-111111111111'

const req = (url: string, init?: RequestInit) => new Request(url, init)

describe('appstate routes — id validation', () => {
  // Every state/image/email handler must reject a non-UUID :id with 422.
  const cases: Array<[string, string, Record<string, string>]> = [
    ['GET',    '/api/app/:id/state',           { id: BAD_ID }],
    ['GET',    '/api/app/:id/state/:key',      { id: BAD_ID, key: 'k' }],
    ['PUT',    '/api/app/:id/state/:key',      { id: BAD_ID, key: 'k' }],
    ['DELETE', '/api/app/:id/state/:key',      { id: BAD_ID, key: 'k' }],
    ['DELETE', '/api/app/:id/state',           { id: BAD_ID }],
    ['POST',   '/api/app/:id/images',          { id: BAD_ID }],
    ['GET',    '/api/app/:id/images',          { id: BAD_ID }],
    ['GET',    '/api/app/:id/images/:imageId', { id: BAD_ID, imageId: GOOD_ID }],
    ['DELETE', '/api/app/:id/images/:imageId', { id: BAD_ID, imageId: GOOD_ID }],
    ['POST',   '/api/app/:id/email',           { id: BAD_ID }],
  ]
  for (const [method, pattern, params] of cases) {
    it(`${method} ${pattern} rejects bad id`, async () => {
      const h = findHandler(appstateRoutes, method, pattern)
      // Email handler checks SEND_EMAIL config first; give it one so we reach id validation.
      const env = makeEnv(pattern.endsWith('/email')
        ? { SEND_EMAIL: { send: async () => {} }, EMAIL_FROM_ADDRESS: 'noreply@example.test' }
        : {})
      const res = await h(req('https://x' + pattern, { method }), env, params)
      assert.equal(res.status, 422)
    })
  }
})

describe('appstate image upload', () => {
  const upload = findHandler(appstateRoutes, 'POST', '/api/app/:id/images')

  it('rejects an unsupported mime type with 422', async () => {
    const form = new FormData()
    form.set('file', new File(['xx'], 'a.txt', { type: 'text/plain' }))
    const res = await upload(req('https://x', { method: 'POST', body: form }), makeEnv(), { id: GOOD_ID })
    assert.equal(res.status, 422)
  })

  it('rejects an oversized image with 422', async () => {
    const form = new FormData()
    const big = new Uint8Array(IMAGE_MAX_BYTES + 1)
    form.set('file', new File([big], 'a.png', { type: 'image/png' }))
    const res = await upload(req('https://x', { method: 'POST', body: form }), makeEnv(), { id: GOOD_ID })
    assert.equal(res.status, 422)
  })

  it('stores a valid image and returns its url', async () => {
    const FILES = mockR2()
    const form = new FormData()
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }))
    const res = await upload(req('https://x', { method: 'POST', body: form }), makeEnv({ FILES }), { id: GOOD_ID })
    assert.equal(res.status, 200)
    const body = await res.json() as { ok: boolean; data: { imageId: string; url: string } }
    assert.equal(body.ok, true)
    assert.ok(body.data.url.startsWith(`/api/app/${GOOD_ID}/images/`))
    assert.equal(FILES.store.size, 1)
  })
})

describe('appstate listImages paginates R2 (listAllR2)', () => {
  it('returns every image even past one R2 page', async () => {
    const FILES = mockR2(10)   // tiny page size to force pagination
    for (let i = 0; i < 25; i++) {
      await FILES.put(`apps/${GOOD_ID}/images/img${i}`, new Uint8Array([0]).buffer, { customMetadata: { name: `img${i}` } })
    }
    const list = findHandler(appstateRoutes, 'GET', '/api/app/:id/images')
    const res = await list(req('https://x', { method: 'GET' }), makeEnv({ FILES }), { id: GOOD_ID })
    const body = await res.json() as { data: { images: unknown[]; total: number } }
    assert.equal(body.data.total, 25)
  })
})

describe('appstate email gating', () => {
  const sendEmail = findHandler(appstateRoutes, 'POST', '/api/app/:id/email')

  it('503s when SEND_EMAIL is not configured', async () => {
    const res = await sendEmail(req('https://x', { method: 'POST' }), makeEnv(), { id: GOOD_ID })
    assert.equal(res.status, 503)
  })

  it('503s when EMAIL_FROM_ADDRESS is missing', async () => {
    const env = makeEnv({ SEND_EMAIL: { send: async () => {} } })
    const body = { to: 'a@example.test', subject: 'hi', text: 'hello' }
    const res = await sendEmail(
      req('https://x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      env, { id: GOOD_ID },
    )
    assert.equal(res.status, 503)
  })
})
