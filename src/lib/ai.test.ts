import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseGateway } from './ai.ts'

describe('parseGateway — provider:model parsing', () => {
  it('returns null for a bare model with no provider prefix', () => {
    assert.equal(parseGateway('@cf/meta/llama-3.1-8b-instruct'), null)
  })

  it('returns null for an unknown provider', () => {
    assert.equal(parseGateway('notaprovider:some-model'), null)
  })

  it('parses a known provider and model id', () => {
    const r = parseGateway('openai:gpt-4o-mini')
    assert.ok(r)
    assert.equal(r.provider, 'openai')
    assert.equal(r.id, 'gpt-4o-mini')
  })

  it('splits only on the first colon (preserves colons in the id)', () => {
    const r = parseGateway('bedrock:anthropic.claude-v1:0')
    assert.ok(r)
    assert.equal(r.provider, 'bedrock')
    assert.equal(r.id, 'anthropic.claude-v1:0')
  })

  it('allows slashes in the id (Azure/OpenRouter/Baseten style)', () => {
    const r = parseGateway('openrouter:anthropic/claude-3.5-sonnet')
    assert.ok(r)
    assert.equal(r.id, 'anthropic/claude-3.5-sonnet')
  })
})

describe('parseGateway — injection / traversal guards', () => {
  it('rejects an id containing ".." (path traversal)', () => {
    assert.equal(parseGateway('openai:../../secret'), null)
  })

  it('rejects an id that does not start alphanumeric', () => {
    assert.equal(parseGateway('openai:-leading-dash'), null)
    assert.equal(parseGateway('openai:/leading-slash'), null)
  })

  it('rejects an empty id', () => {
    assert.equal(parseGateway('openai:'), null)
  })

  it('rejects ids with disallowed characters', () => {
    assert.equal(parseGateway('openai:has space'), null)
    assert.equal(parseGateway('openai:has$dollar'), null)
  })
})
