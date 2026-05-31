import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeConfigHash } from './integrity.ts'
import type { SandboxConfig } from './schema.ts'

function baseConfig(): SandboxConfig {
  return {
    id:           'id-1',
    name:         'Test',
    description:  'desc',
    systemPrompt: 'You are helpful.',
    tools:        [],
    model:        '@cf/meta/llama-3.1-8b-instruct',
    temperature:  0.7,
    maxTokens:    1024,
    memory:       [],
    createdAt:    1000,
    updatedAt:    1000,
  }
}

describe('computeConfigHash', () => {
  it('produces a 64-char lowercase hex SHA-256 string', async () => {
    const h = await computeConfigHash(baseConfig())
    assert.match(h, /^[0-9a-f]{64}$/)
  })

  it('is deterministic for identical config', async () => {
    const a = await computeConfigHash(baseConfig())
    const b = await computeConfigHash(baseConfig())
    assert.equal(a, b)
  })

  it('changes when a hashed field changes', async () => {
    const a = await computeConfigHash(baseConfig())
    const c = baseConfig()
    c.systemPrompt = 'You are different.'
    assert.notEqual(await computeConfigHash(c), a)
  })

  it('changes with conversation length (message-count salt)', async () => {
    const a = await computeConfigHash(baseConfig())
    const c = baseConfig()
    c.memory = [{ role: 'user', content: 'hi' }]
    assert.notEqual(await computeConfigHash(c), a)
  })

  it('ignores fields not part of the fingerprint (e.g. updatedAt)', async () => {
    const a = await computeConfigHash(baseConfig())
    const c = baseConfig()
    c.updatedAt = 9999
    assert.equal(await computeConfigHash(c), a)
  })
})
