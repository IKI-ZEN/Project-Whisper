import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractMetrics } from './toolRun.ts'

describe('extractMetrics', () => {
  describe('entropy tool', () => {
    it('extracts all four metrics when present', () => {
      const result = {
        entropy: 0.42,
        avgCosineSimilarity: 0.91,
        latencyMs: 1234,
        samples: ['a', 'b', 'c'],
      }
      const metrics = extractMetrics('entropy', result)
      assert.strictEqual(metrics.entropy, 0.42)
      assert.strictEqual(metrics.avgCosineSimilarity, 0.91)
      assert.strictEqual(metrics.latencyMs, 1234)
      assert.strictEqual(metrics.sampleCount, 3)
    })

    it('omits missing optional fields gracefully', () => {
      const result = { entropy: 0.5, samples: ['x', 'y'] }
      const metrics = extractMetrics('entropy', result)
      assert.strictEqual(metrics.entropy, 0.5)
      assert.strictEqual(metrics.sampleCount, 2)
      assert.strictEqual('avgCosineSimilarity' in metrics, false)
      assert.strictEqual('latencyMs' in metrics, false)
    })

    it('returns {} when samples is not an array', () => {
      const metrics = extractMetrics('entropy', { entropy: 0.1, samples: null })
      assert.strictEqual('sampleCount' in metrics, false)
    })
  })

  describe('sensitivity tool', () => {
    it('computes avg, min, max similarity from matrix', () => {
      const matrix = [[1, 0.8], [0.8, 1]]
      const result = { similarityMatrix: matrix, variants: ['a', 'b'], latencyMs: 500 }
      const metrics = extractMetrics('sensitivity', result)
      assert.ok(Math.abs(metrics.avgSimilarity - 0.8) < 0.005, 'avgSimilarity close to 0.8')
      assert.strictEqual(metrics.minSimilarity, 0.8)
      assert.strictEqual(metrics.maxSimilarity, 0.8)
      assert.strictEqual(metrics.latencyMs, 500)
      assert.strictEqual(metrics.variantCount, 2)
    })

    it('returns {} when similarityMatrix is empty', () => {
      const metrics = extractMetrics('sensitivity', { similarityMatrix: [] })
      assert.strictEqual(Object.keys(metrics).length, 0)
    })

    it('returns {} when matrix rows are not arrays', () => {
      const metrics = extractMetrics('sensitivity', { similarityMatrix: [null, null] })
      assert.strictEqual(Object.keys(metrics).length, 0)
    })

    it('returns {} when off-diagonal values are absent', () => {
      // 1×1 matrix — no off-diagonal elements
      const metrics = extractMetrics('sensitivity', { similarityMatrix: [[1]] })
      assert.strictEqual(Object.keys(metrics).length, 0)
    })
  })

  describe('sweep tool', () => {
    it('extracts temperatureCount and latencyMs from first result', () => {
      const result = { results: [{ latencyMs: 800 }, { latencyMs: 900 }] }
      const metrics = extractMetrics('sweep', result)
      assert.strictEqual(metrics.temperatureCount, 2)
      assert.strictEqual(metrics.latencyMs, 800)
    })

    it('handles empty results array', () => {
      const metrics = extractMetrics('sweep', { results: [] })
      assert.strictEqual(metrics.temperatureCount, 0)
      assert.strictEqual('latencyMs' in metrics, false)
    })
  })

  describe('cot tool', () => {
    it('extracts cotStyleCount and latency stats', () => {
      const result = [
        { latencyMs: 100 },
        { latencyMs: 200 },
        { latencyMs: 300 },
      ]
      const metrics = extractMetrics('cot', result)
      assert.strictEqual(metrics.cotStyleCount, 3)
      assert.ok(Math.abs(metrics.avgLatencyMs - 200) < 0.005, 'avgLatencyMs close to 200')
      assert.strictEqual(metrics.minLatencyMs, 100)
      assert.strictEqual(metrics.maxLatencyMs, 300)
    })

    it('returns {} for empty array', () => {
      const metrics = extractMetrics('cot', [])
      assert.strictEqual(Object.keys(metrics).length, 0)
    })

    it('treats non-number latencyMs as 0', () => {
      const metrics = extractMetrics('cot', [{ latencyMs: 'bad' }, { latencyMs: 200 }])
      assert.strictEqual(metrics.minLatencyMs, 0)
      assert.strictEqual(metrics.maxLatencyMs, 200)
    })
  })

  describe('unknown / edge cases', () => {
    it('returns {} for unknown tool name', () => {
      assert.strictEqual(Object.keys(extractMetrics('unknown-tool', { foo: 1 })).length, 0)
    })

    it('returns {} for null result', () => {
      assert.strictEqual(Object.keys(extractMetrics('entropy', null)).length, 0)
    })

    it('returns {} for primitive result', () => {
      assert.strictEqual(Object.keys(extractMetrics('entropy', 42)).length, 0)
    })

    it('returns {} for string result', () => {
      assert.strictEqual(Object.keys(extractMetrics('entropy', 'text')).length, 0)
    })
  })
})
