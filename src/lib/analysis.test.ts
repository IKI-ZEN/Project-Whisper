import { describe, it, expect } from 'vitest'
import { extractMetrics } from './analysis'

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
      expect(metrics.entropy).toBe(0.42)
      expect(metrics.avgCosineSimilarity).toBe(0.91)
      expect(metrics.latencyMs).toBe(1234)
      expect(metrics.sampleCount).toBe(3)
    })

    it('omits missing optional fields gracefully', () => {
      const result = { entropy: 0.5, samples: ['x', 'y'] }
      const metrics = extractMetrics('entropy', result)
      expect(metrics.entropy).toBe(0.5)
      expect(metrics.sampleCount).toBe(2)
      expect('avgCosineSimilarity' in metrics).toBe(false)
      expect('latencyMs' in metrics).toBe(false)
    })

    it('returns {} when samples is not an array', () => {
      const metrics = extractMetrics('entropy', { entropy: 0.1, samples: null })
      expect('sampleCount' in metrics).toBe(false)
    })
  })

  describe('sensitivity tool', () => {
    it('computes avg, min, max similarity from matrix', () => {
      const matrix = [[1, 0.8], [0.8, 1]]
      const result = { similarityMatrix: matrix, variants: ['a', 'b'], latencyMs: 500 }
      const metrics = extractMetrics('sensitivity', result)
      expect(metrics.avgSimilarity).toBeCloseTo(0.8)
      expect(metrics.minSimilarity).toBe(0.8)
      expect(metrics.maxSimilarity).toBe(0.8)
      expect(metrics.latencyMs).toBe(500)
      expect(metrics.variantCount).toBe(2)
    })

    it('returns {} when similarityMatrix is empty', () => {
      const metrics = extractMetrics('sensitivity', { similarityMatrix: [] })
      expect(Object.keys(metrics)).toHaveLength(0)
    })

    it('returns {} when matrix rows are not arrays', () => {
      const metrics = extractMetrics('sensitivity', { similarityMatrix: [null, null] })
      expect(Object.keys(metrics)).toHaveLength(0)
    })

    it('returns {} when off-diagonal values are absent', () => {
      // 1×1 matrix — no off-diagonal elements
      const metrics = extractMetrics('sensitivity', { similarityMatrix: [[1]] })
      expect(Object.keys(metrics)).toHaveLength(0)
    })
  })

  describe('sweep tool', () => {
    it('extracts temperatureCount and latencyMs from first result', () => {
      const result = { results: [{ latencyMs: 800 }, { latencyMs: 900 }] }
      const metrics = extractMetrics('sweep', result)
      expect(metrics.temperatureCount).toBe(2)
      expect(metrics.latencyMs).toBe(800)
    })

    it('handles empty results array', () => {
      const metrics = extractMetrics('sweep', { results: [] })
      expect(metrics.temperatureCount).toBe(0)
      expect('latencyMs' in metrics).toBe(false)
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
      expect(metrics.cotStyleCount).toBe(3)
      expect(metrics.avgLatencyMs).toBeCloseTo(200)
      expect(metrics.minLatencyMs).toBe(100)
      expect(metrics.maxLatencyMs).toBe(300)
    })

    it('returns {} for empty array', () => {
      const metrics = extractMetrics('cot', [])
      expect(Object.keys(metrics)).toHaveLength(0)
    })

    it('treats non-number latencyMs as 0', () => {
      const metrics = extractMetrics('cot', [{ latencyMs: 'bad' }, { latencyMs: 200 }])
      expect(metrics.minLatencyMs).toBe(0)
      expect(metrics.maxLatencyMs).toBe(200)
    })
  })

  describe('unknown / edge cases', () => {
    it('returns {} for unknown tool name', () => {
      expect(Object.keys(extractMetrics('unknown-tool', { foo: 1 }))).toHaveLength(0)
    })

    it('returns {} for null result', () => {
      expect(Object.keys(extractMetrics('entropy', null))).toHaveLength(0)
    })

    it('returns {} for primitive result', () => {
      expect(Object.keys(extractMetrics('entropy', 42))).toHaveLength(0)
    })

    it('returns {} for string result', () => {
      expect(Object.keys(extractMetrics('entropy', 'text'))).toHaveLength(0)
    })
  })
})
