import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { signPayload, verifySignature, sealPrompt, openPrompt } from './vault.ts'

const SECRET = 'test-signing-secret-0123456789'

describe('signPayload + verifySignature — round trip', () => {
  it('verifies a signature it produced', async () => {
    const sig = await signPayload('hello world', SECRET)
    assert.equal(await verifySignature('hello world', sig, SECRET), true)
  })

  it('produces lowercase hex of even length (SHA-256 → 64 chars)', async () => {
    const sig = await signPayload('x', SECRET)
    assert.match(sig, /^[0-9a-f]+$/)
    assert.equal(sig.length, 64)
  })

  it('is deterministic for the same payload + secret', async () => {
    const a = await signPayload('same', SECRET)
    const b = await signPayload('same', SECRET)
    assert.equal(a, b)
  })
})

describe('verifySignature — rejections', () => {
  it('rejects a tampered payload', async () => {
    const sig = await signPayload('original', SECRET)
    assert.equal(await verifySignature('TAMPERED', sig, SECRET), false)
  })

  it('rejects a signature made with a different secret', async () => {
    const sig = await signPayload('hello', 'other-secret')
    assert.equal(await verifySignature('hello', sig, SECRET), false)
  })

  it('rejects non-hex signatures', async () => {
    assert.equal(await verifySignature('hello', 'zzzznothex', SECRET), false)
  })

  it('rejects odd-length hex signatures', async () => {
    assert.equal(await verifySignature('hello', 'abc', SECRET), false)
  })

  it('rejects an empty signature', async () => {
    assert.equal(await verifySignature('hello', '', SECRET), false)
  })

  it('rejects a single flipped hex byte', async () => {
    const sig = await signPayload('hello', SECRET)
    const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1)
    assert.equal(await verifySignature('hello', flipped, SECRET), false)
  })

  it('accepts uppercase hex (case-insensitive decode)', async () => {
    const sig = await signPayload('hello', SECRET)
    assert.equal(await verifySignature('hello', sig.toUpperCase(), SECRET), true)
  })
})

describe('sealPrompt + openPrompt — AES-GCM envelope', () => {
  const SANDBOX = 'sandbox-abc'

  it('round-trips a prompt', async () => {
    const sealed = await sealPrompt('secret system prompt', SECRET, SANDBOX)
    assert.match(sealed, /^v1:/)
    assert.equal(await openPrompt(sealed, SECRET, SANDBOX), 'secret system prompt')
  })

  it('produces a different ciphertext each time (random IV)', async () => {
    const a = await sealPrompt('same', SECRET, SANDBOX)
    const b = await sealPrompt('same', SECRET, SANDBOX)
    assert.notEqual(a, b)
  })

  it('returns plaintext unchanged when value has no v1: prefix', async () => {
    assert.equal(await openPrompt('just plaintext', SECRET, SANDBOX), 'just plaintext')
  })

  it('treats a malformed v1: value (no dot) as plaintext', async () => {
    assert.equal(await openPrompt('v1:garbage-no-dot', SECRET, SANDBOX), 'v1:garbage-no-dot')
  })

  it('fails to decrypt with the wrong sandbox id (key is salted by sandboxId)', async () => {
    const sealed = await sealPrompt('secret', SECRET, SANDBOX)
    await assert.rejects(() => openPrompt(sealed, SECRET, 'different-sandbox'))
  })

  it('fails to decrypt with the wrong secret', async () => {
    const sealed = await sealPrompt('secret', SECRET, SANDBOX)
    await assert.rejects(() => openPrompt(sealed, 'wrong-secret', SANDBOX))
  })
})
