import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { estimateCost } from './pricing.ts'

describe('estimateCost', () => {
  describe('known model — exact calculation', () => {
    test('gpt-4o-mini: 1000 input + 1000 output', () => {
      // inputPer1k: 0.00015, outputPer1k: 0.0006
      const cost = estimateCost('gpt-4o-mini', 1000, 1000)
      assert.ok(Math.abs(cost - 0.00075) < 1e-10)
    })

    test('gpt-4o: 2000 input + 500 output', () => {
      // inputPer1k: 0.0025, outputPer1k: 0.01
      const cost = estimateCost('gpt-4o', 2000, 500)
      const expected = 2 * 0.0025 + 0.5 * 0.01
      assert.ok(Math.abs(cost - expected) < 1e-10)
    })

    test('deepseek-chat: 4000 input + 1200 output', () => {
      // inputPer1k: 0.00014, outputPer1k: 0.00028
      const cost = estimateCost('deepseek-chat', 4000, 1200)
      const expected = 4 * 0.00014 + 1.2 * 0.00028
      assert.ok(Math.abs(cost - expected) < 1e-10)
    })
  })

  describe('provider prefix stripping', () => {
    test('openai:gpt-4o resolves to gpt-4o pricing', () => {
      const bare  = estimateCost('gpt-4o', 1000, 1000)
      const prefixed = estimateCost('openai:gpt-4o', 1000, 1000)
      assert.equal(bare, prefixed)
    })

    test('anthropic:claude-sonnet-4-6 resolves to claude pricing', () => {
      const bare  = estimateCost('claude-sonnet-4-6', 1000, 1000)
      const prefixed = estimateCost('anthropic:claude-sonnet-4-6', 1000, 1000)
      assert.equal(bare, prefixed)
    })

    test('groq:llama-3.1-8b-instant resolves correctly', () => {
      const bare  = estimateCost('llama-3.1-8b-instant', 1000, 0)
      const prefixed = estimateCost('groq:llama-3.1-8b-instant', 1000, 0)
      assert.equal(bare, prefixed)
    })
  })

  describe('unknown model falls back to default pricing', () => {
    test('unknown model uses 0.0001/0.0001 fallback', () => {
      // FALLBACK: { inputPer1k: 0.0001, outputPer1k: 0.0001 }
      const cost = estimateCost('some-unknown-model-xyz', 1000, 1000)
      assert.ok(Math.abs(cost - 0.0002) < 1e-10)
    })

    test('unknown prefixed model uses fallback', () => {
      const cost = estimateCost('someProvider:totally-unknown', 500, 500)
      assert.ok(Math.abs(cost - 0.0001) < 1e-10)
    })
  })

  describe('zero tokens', () => {
    test('zero input and output = 0', () => {
      assert.equal(estimateCost('gpt-4o', 0, 0), 0)
    })

    test('zero output only charges input', () => {
      const cost = estimateCost('gpt-4o', 1000, 0)
      assert.ok(Math.abs(cost - 0.0025) < 1e-10)
    })

    test('zero input only charges output', () => {
      const cost = estimateCost('gpt-4o', 0, 1000)
      assert.ok(Math.abs(cost - 0.01) < 1e-10)
    })
  })

  describe('embed / image models (output-only billing)', () => {
    test('embed model has zero output cost', () => {
      // @cf/baai/bge-base-en-v1.5: outputPer1k: 0
      const cost = estimateCost('@cf/baai/bge-base-en-v1.5', 1000, 9999)
      assert.ok(Math.abs(cost - 0.00001) < 1e-10)
    })

    test('image model has zero input cost', () => {
      // @cf/black-forest-labs/flux-1-schnell: inputPer1k: 0, outputPer1k: 0.00008
      const cost = estimateCost('@cf/black-forest-labs/flux-1-schnell', 9999, 1000)
      assert.ok(Math.abs(cost - 0.00008) < 1e-10)
    })
  })

  describe('linearity', () => {
    test('doubling tokens doubles cost', () => {
      const c1 = estimateCost('mistral-large-latest', 1000, 1000)
      const c2 = estimateCost('mistral-large-latest', 2000, 2000)
      assert.ok(Math.abs(c2 - 2 * c1) < 1e-10)
    })
  })
})
