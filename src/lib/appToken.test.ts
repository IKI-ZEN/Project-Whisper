import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { issueAppToken, verifyAppToken, extractAppToken, isAppScopedPath } from './appToken.ts'

const SECRET = 'test-secret-key-32-bytes-long!!'

describe('isAppScopedPath', () => {
  test('matches /api/app/{id}/ prefix', () => {
    assert.equal(isAppScopedPath('/api/app/abc-123/state', 'abc-123'), true)
  })

  test('matches /api/app/{id}/ with nested path', () => {
    assert.equal(isAppScopedPath('/api/app/abc-123/session/x', 'abc-123'), true)
  })

  test('does not match /api/app/{id} without trailing slash', () => {
    assert.equal(isAppScopedPath('/api/app/abc-123', 'abc-123'), false)
  })

  test('does not match different app id', () => {
    assert.equal(isAppScopedPath('/api/app/other-id/state', 'abc-123'), false)
  })

  test('matches /s/{id}/run exactly', () => {
    assert.equal(isAppScopedPath('/s/abc-123/run', 'abc-123'), true)
  })

  test('matches /s/{id}/stream exactly', () => {
    assert.equal(isAppScopedPath('/s/abc-123/stream', 'abc-123'), true)
  })

  test('does not match /s/{id}/other', () => {
    assert.equal(isAppScopedPath('/s/abc-123/other', 'abc-123'), false)
  })

  test('does not match /s/{id}/run with wrong id', () => {
    assert.equal(isAppScopedPath('/s/other/run', 'abc-123'), false)
  })

  test('empty path returns false', () => {
    assert.equal(isAppScopedPath('', 'abc-123'), false)
  })
})

describe('extractAppToken', () => {
  test('returns token from X-App-Token header', () => {
    const req = new Request('https://example.com/', {
      headers: { 'X-App-Token': 'tok.abc123' },
    })
    assert.equal(extractAppToken(req), 'tok.abc123')
  })

  test('returns null when header is absent', () => {
    const req = new Request('https://example.com/')
    assert.equal(extractAppToken(req), null)
  })

  test('returns empty string when header is present but empty', () => {
    const req = new Request('https://example.com/', {
      headers: { 'X-App-Token': '' },
    })
    assert.equal(extractAppToken(req), '')
  })
})

describe('issueAppToken + verifyAppToken', () => {
  test('issued token verifies successfully and returns appId', async () => {
    const token = await issueAppToken('my-app', SECRET)
    const result = await verifyAppToken(token, SECRET)
    assert.equal(result, 'my-app')
  })

  test('token with wrong secret fails verification', async () => {
    const token = await issueAppToken('my-app', SECRET)
    const result = await verifyAppToken(token, 'wrong-secret')
    assert.equal(result, null)
  })

  test('tampered payload fails verification', async () => {
    const token = await issueAppToken('my-app', SECRET)
    // Replace the appId portion in the payload
    const tampered = token.replace('app:my-app:', 'app:evil-app:')
    const result = await verifyAppToken(tampered, SECRET)
    assert.equal(result, null)
  })

  test('token with no dot separator returns null', async () => {
    const result = await verifyAppToken('nodothere', SECRET)
    assert.equal(result, null)
  })

  test('token with wrong prefix format returns null', async () => {
    const result = await verifyAppToken('notapp:x:12345.fakesig', SECRET)
    assert.equal(result, null)
  })

  test('token with too few colon-separated parts returns null', async () => {
    const result = await verifyAppToken('app:only-two.fakesig', SECRET)
    assert.equal(result, null)
  })

  test('token format: {payload}.{hex-sig}', async () => {
    const token = await issueAppToken('test-id', SECRET)
    const dot = token.lastIndexOf('.')
    assert.ok(dot > 0, 'token should contain a dot')
    const payload = token.slice(0, dot)
    const sig     = token.slice(dot + 1)
    assert.ok(payload.startsWith('app:test-id:'), 'payload starts with app:{id}:')
    assert.match(sig, /^[0-9a-f]+$/, 'signature is hex')
  })

  test('different appIds produce different tokens', async () => {
    const t1 = await issueAppToken('app-one', SECRET)
    const t2 = await issueAppToken('app-two', SECRET)
    assert.notEqual(t1, t2)
  })
})
