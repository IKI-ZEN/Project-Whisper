import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseCompleteRequest, parseCreateSandboxRequest } from './schema.ts'

// bool() is private — tested indirectly via parsers that use it (zdr, groundingEnabled,
// collectLogPayload, ragEnabled).

describe('parseCompleteRequest — valid input', () => {
  it('accepts prompt-only body', () => {
    const r = parseCompleteRequest({ prompt: 'hello' })
    assert.strictEqual(r.prompt, 'hello')
    assert.strictEqual(r.zdr, false)
    assert.strictEqual(r.groundingEnabled, false)
  })

  it('accepts boolean true for zdr', () => {
    const r = parseCompleteRequest({ prompt: 'x', zdr: true })
    assert.strictEqual(r.zdr, true)
  })

  it('accepts boolean false for zdr', () => {
    const r = parseCompleteRequest({ prompt: 'x', zdr: false })
    assert.strictEqual(r.zdr, false)
  })

  it('defaults zdr to false when absent', () => {
    const r = parseCompleteRequest({ prompt: 'x' })
    assert.strictEqual(r.zdr, false)
  })

  it('accepts boolean true for groundingEnabled', () => {
    const r = parseCompleteRequest({ prompt: 'x', groundingEnabled: true })
    assert.strictEqual(r.groundingEnabled, true)
  })

  it('collectLogPayload true is preserved', () => {
    const r = parseCompleteRequest({ prompt: 'x', collectLogPayload: true })
    assert.strictEqual(r.collectLogPayload, true)
  })

  it('collectLogPayload false is preserved', () => {
    const r = parseCompleteRequest({ prompt: 'x', collectLogPayload: false })
    assert.strictEqual(r.collectLogPayload, false)
  })

  it('collectLogPayload absent → undefined (not false)', () => {
    const r = parseCompleteRequest({ prompt: 'x' })
    assert.strictEqual(r.collectLogPayload, undefined)
  })
})

describe('parseCompleteRequest — bool() type validation', () => {
  it('throws 422-worthy error when zdr is a string', () => {
    assert.throws(
      () => parseCompleteRequest({ prompt: 'x', zdr: 'yes' }),
      /zdr must be a boolean/,
    )
  })

  it('throws when zdr is a number', () => {
    assert.throws(
      () => parseCompleteRequest({ prompt: 'x', zdr: 1 }),
      /zdr must be a boolean/,
    )
  })

  it('throws when groundingEnabled is a string', () => {
    assert.throws(
      () => parseCompleteRequest({ prompt: 'x', groundingEnabled: 'true' }),
      /groundingEnabled must be a boolean/,
    )
  })

  it('throws when collectLogPayload is a number', () => {
    assert.throws(
      () => parseCompleteRequest({ prompt: 'x', collectLogPayload: 0 }),
      /collectLogPayload must be a boolean/,
    )
  })
})

describe('parseCompleteRequest — missing required fields', () => {
  it('throws when neither prompt nor messages provided', () => {
    assert.throws(
      () => parseCompleteRequest({ model: '@cf/meta/llama-3.1-8b-instruct' }),
      /prompt or messages is required/,
    )
  })

  it('throws when body is not an object', () => {
    assert.throws(() => parseCompleteRequest('hello'), /must be a JSON object/)
    assert.throws(() => parseCompleteRequest(null),    /must be a JSON object/)
    assert.throws(() => parseCompleteRequest(42),      /must be a JSON object/)
  })
})

describe('parseCreateSandboxRequest — bool() on ragEnabled', () => {
  const base = {
    name: 'Test', description: 'desc', systemPrompt: 'sp',
    tools: [], model: '@cf/meta/llama-3.1-8b-instruct',
    temperature: 0.7, maxTokens: 1024,
  }

  it('accepts ragEnabled: true', () => {
    const r = parseCreateSandboxRequest({ ...base, ragEnabled: true })
    assert.strictEqual(r.ragEnabled, true)
  })

  it('defaults ragEnabled to false when absent', () => {
    const r = parseCreateSandboxRequest(base)
    assert.strictEqual(r.ragEnabled, false)
  })

  it('throws when ragEnabled is a number', () => {
    assert.throws(
      () => parseCreateSandboxRequest({ ...base, ragEnabled: 1 }),
      /ragEnabled must be a boolean/,
    )
  })

  it('throws when ragEnabled is a string', () => {
    assert.throws(
      () => parseCreateSandboxRequest({ ...base, ragEnabled: 'yes' }),
      /ragEnabled must be a boolean/,
    )
  })
})
