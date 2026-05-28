/**
 * Shared analysis utilities — used by probes, assertions, and whisperer handlers.
 *
 * Three concerns that every analysis system shares but previously duplicated or skipped:
 *   resolveAnalysisContext — fetch effective model + systemPrompt from a sandbox
 *   saveToVault            — persist a tool result to vault_records without an HTTP hop
 *   extractMetrics         — turn rich tool results into a named scalar map
 */

import type { Env } from '../types/env'
import { newId } from './utils.ts'
import { VAULT_AUTO_RESULT_MAX_BYTES } from './constants.ts'

// ── Context resolution ────────────────────────────────────────────────────────

/**
 * Fetch the effective model + systemPrompt for a given sandbox.
 * Returns empty strings (no override) if the sandbox is unreachable or deleted.
 */
export async function resolveAnalysisContext(
  sandboxId: string,
  env: Env,
): Promise<{ model: string; systemPrompt: string }> {
  try {
    const stub = env.SANDBOX.get(env.SANDBOX.idFromName(sandboxId))
    const res = await stub.fetch('https://do/config', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await res.json() as { ok?: boolean; data?: { model?: string; systemPrompt?: string } }
    if (data.ok && data.data) {
      return {
        model:        data.data.model        ?? '',
        systemPrompt: data.data.systemPrompt ?? '',
      }
    }
  } catch { /* sandbox deleted, expired, or unavailable — probe keeps running */ }
  return { model: '', systemPrompt: '' }
}

// ── Vault persistence ─────────────────────────────────────────────────────────

/**
 * Write a tool result directly to vault_records (D1 INSERT, no HTTP hop).
 * Silently swallows all errors — vault writes must never break a tool response.
 */
export async function saveToVault(env: Env, record: {
  prompt: string
  response: unknown
  model: string
  systemPrompt?: string
  tool: string
  sandboxId?: string | null
  tags?: string[]
}): Promise<void> {
  const responseStr = typeof record.response === 'string'
    ? record.response
    : JSON.stringify(record.response)
  if (responseStr.length > VAULT_AUTO_RESULT_MAX_BYTES) return

  const id = newId()
  const tags: string[] = [
    ...(record.tags ?? []),
    'auto-vault',
    `tool:${record.tool}`,
    ...(record.sandboxId ? [`sandbox:${record.sandboxId}`] : []),
  ]

  try {
    await env.DB.prepare(
      `INSERT INTO vault_records
         (id, prompt, response, model, temperature, system_prompt, tool, metadata, tags, sandbox_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      record.prompt.slice(0, 10_000),
      responseStr,
      record.model,
      0.7,
      record.systemPrompt ?? '',
      record.tool,
      '{}',
      JSON.stringify(tags),
      record.sandboxId ?? null,
      Date.now(),
    ).run()
  } catch { /* ignore — vault write failure must never surface to caller */ }
}

// ── Metric extraction ─────────────────────────────────────────────────────────

/**
 * Extract all meaningful scalar metrics from a probe tool result.
 * Replaces the single-scalar extractMetricValue() used in probes.ts.
 */
export function extractMetrics(tool: string, result: unknown): Record<string, number> {
  if (typeof result !== 'object' || result === null) return {}
  const r = result as Record<string, unknown>

  if (tool === 'entropy') {
    const metrics: Record<string, number> = {}
    if (typeof r.entropy            === 'number') metrics.entropy             = r.entropy
    if (typeof r.avgCosineSimilarity === 'number') metrics.avgCosineSimilarity = r.avgCosineSimilarity
    if (typeof r.latencyMs          === 'number') metrics.latencyMs           = r.latencyMs
    if (Array.isArray(r.samples))                 metrics.sampleCount         = r.samples.length
    return metrics
  }

  if (tool === 'sensitivity') {
    const matrix = r.similarityMatrix
    if (!Array.isArray(matrix) || matrix.length === 0) return {}
    const values: number[] = []
    for (let i = 0; i < matrix.length; i++) {
      if (!Array.isArray(matrix[i])) continue
      for (let j = 0; j < (matrix[i] as number[]).length; j++) {
        if (i !== j) values.push((matrix[i] as number[])[j])
      }
    }
    if (values.length === 0) return {}
    const sum = values.reduce((a, b) => a + b, 0)
    const metrics: Record<string, number> = {
      avgSimilarity: sum / values.length,
      minSimilarity: Math.min(...values),
      maxSimilarity: Math.max(...values),
    }
    if (typeof r.latencyMs === 'number') metrics.latencyMs = r.latencyMs
    if (Array.isArray(r.variants)) metrics.variantCount = r.variants.length
    return metrics
  }

  if (tool === 'sweep') {
    const results = Array.isArray(r.results) ? (r.results as Record<string, unknown>[]) : []
    const metrics: Record<string, number> = { temperatureCount: results.length }
    const lat0 = results[0]
    if (lat0 && typeof lat0.latencyMs === 'number') metrics.latencyMs = lat0.latencyMs
    return metrics
  }

  if (tool === 'cot') {
    if (!Array.isArray(result) || result.length === 0) return {}
    const items = result as Record<string, unknown>[]
    const latencies = items.map(i => typeof i.latencyMs === 'number' ? i.latencyMs : 0)
    const sum = latencies.reduce((a, b) => a + b, 0)
    return {
      cotStyleCount: items.length,
      avgLatencyMs:  sum / items.length,
      minLatencyMs:  Math.min(...latencies),
      maxLatencyMs:  Math.max(...latencies),
    }
  }

  if (tool === 'pipeline') {
    const metrics: Record<string, number> = {}
    if (Array.isArray(r.trace)) metrics.traceLength = (r.trace as unknown[]).length
    const latencies = Array.isArray(r.trace)
      ? (r.trace as Record<string, unknown>[]).map(t => typeof t.latencyMs === 'number' ? t.latencyMs : 0)
      : []
    if (latencies.length > 0) {
      metrics.totalLatencyMs = latencies.reduce((a, b) => a + b, 0)
      metrics.avgNodeLatencyMs = metrics.totalLatencyMs / latencies.length
    }
    return metrics
  }

  return {}
}
