import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isProtectedRequest } from './access.ts'

describe('isProtectedRequest — non-mutation methods are always public', () => {
  for (const m of ['GET', 'HEAD', 'OPTIONS']) {
    it(`${m} is never protected`, () => {
      assert.equal(isProtectedRequest(m, '/api/sandbox'), false)
      assert.equal(isProtectedRequest(m, '/api/sandbox/abc'), false)
    })
  }
})

describe('isProtectedRequest — mutations under /api are protected', () => {
  for (const m of ['POST', 'PATCH', 'DELETE', 'PUT']) {
    it(`${m} /api/sandbox is protected`, () => {
      assert.equal(isProtectedRequest(m, '/api/sandbox'), true)
    })
    it(`${m} /api/vault is protected`, () => {
      assert.equal(isProtectedRequest(m, '/api/vault'), true)
    })
  }

  it('non-/api mutation paths are not protected', () => {
    assert.equal(isProtectedRequest('POST', '/login'), false)
  })
})

describe('isProtectedRequest — public allowlist (embed / widget endpoints)', () => {
  it('short public API under /s/ is public', () => {
    assert.equal(isProtectedRequest('POST', '/s/abc/run'), false)
    assert.equal(isProtectedRequest('POST', '/s/abc/stream'), false)
  })

  it('csp-report sink is public', () => {
    assert.equal(isProtectedRequest('POST', '/api/csp-report'), false)
  })

  it('core sandbox run/stream are public', () => {
    assert.equal(isProtectedRequest('POST', '/api/sandbox/abc/run'), false)
    assert.equal(isProtectedRequest('POST', '/api/sandbox/abc/stream'), false)
  })

  it('but other sandbox mutations remain protected', () => {
    assert.equal(isProtectedRequest('POST', '/api/sandbox/abc/fork'), true)
    assert.equal(isProtectedRequest('DELETE', '/api/sandbox/abc'), true)
    assert.equal(isProtectedRequest('PATCH', '/api/sandbox/abc'), true)
  })

  it('generated-app images/email endpoints are public', () => {
    assert.equal(isProtectedRequest('POST', '/api/app/abc/images'), false)
    assert.equal(isProtectedRequest('POST', '/api/app/abc/email'), false)
  })
})
