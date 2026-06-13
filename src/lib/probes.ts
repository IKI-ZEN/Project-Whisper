import type { Env } from '../types/env'
import { newId, isUUID, now } from './utils'
import { PROBE_WEBHOOK_TIMEOUT_MS, WEBHOOK_SIGNATURE_VERSION } from './constants'
import { signPayload } from './vault'
import {
  complete, embed, estimateEntropy, runCoTProbe,
  generatePromptVariants, computeSimilarityMatrix,
  MODELS,
} from './ai'
import { resolveAnalysisContext, extractMetrics } from './toolRun'
import { executePipeline } from './pipeline'
import type { PipelineNode } from './schema'

// ── Constants ─────────────────────────────────────────────────────────────────

export const VALID_TOOLS     = ['entropy', 'sweep', 'sensitivity', 'cot', 'pipeline', 'guard-rate'] as const
export const VALID_SCHEDULES = ['hourly', 'daily', 'weekly'] as const

export type ProbeTool     = typeof VALID_TOOLS[number]
export type ProbeSchedule = typeof VALID_SCHEDULES[number]

interface PipelineRow {
  id:       string
  nodes:    string
  entry_id: string
}

// ── D1 row types ──────────────────────────────────────────────────────────────

export interface ProbeRow {
  id:          string
  name:        string
  description: string
  prompt:      string
  tool:        ProbeTool
  params:      string  // JSON
  model:       string
  schedule:    ProbeSchedule
  threshold:   string  // JSON
  sandbox_id:     string | null
  environment_id: string | null
  created_at:     number
  last_run_at:    number | null
  webhook_url:    string | null
}

export interface ProbeRunRow {
  id:           string
  probe_id:     string
  tool:         string
  result:       string  // JSON
  metric_value: number | null
  metrics_json: string | null
  run_at:       number
}

// ── Metric extraction ─────────────────────────────────────────────────────────

// Backwards-compatible single-scalar extraction (kept for existing probe_runs rows).
export function extractMetricValue(tool: ProbeTool, result: unknown): number | null {
  const metrics = extractMetrics(tool, result)
  if (tool === 'entropy')     return metrics.entropy       ?? null
  if (tool === 'sensitivity') return metrics.avgSimilarity ?? null
  if (tool === 'sweep')       return metrics.latencyMs     ?? null
  if (tool === 'cot')         return metrics.avgLatencyMs  ?? null
  if (tool === 'guard-rate')  return metrics.count         ?? null
  return null
}

// ── Tool runner ───────────────────────────────────────────────────────────────

export async function runProbeTool(
  tool: ProbeTool,
  prompt: string,
  model: string | undefined,
  params: Record<string, unknown>,
  env: Env,
): Promise<unknown> {
  const effectiveModel = model || undefined

  if (tool === 'entropy') {
    const samples   = typeof params.samples === 'number' ? Math.max(1, Math.min(10, params.samples)) : 5
    const temperature = typeof params.temperature === 'number' ? params.temperature : 1.0
    const maxTokens  = typeof params.maxTokens === 'number' ? params.maxTokens : undefined
    const systemPrompt = typeof params.systemPrompt === 'string' ? params.systemPrompt : undefined
    return estimateEntropy(env.AI, env, { prompt, model: effectiveModel, systemPrompt, temperature, maxTokens }, samples)
  }

  if (tool === 'sweep') {
    // Reproduce the sweep logic from ai.ts route handler
    const temperatures: number[] = Array.isArray(params.temperatures)
      ? (params.temperatures as number[]).filter(t => typeof t === 'number' && t >= 0 && t <= 2).slice(0, 8)
      : [0.0, 0.4, 0.8, 1.2]
    const samples  = typeof params.samples === 'number' ? Math.max(1, Math.min(3, params.samples)) : 1
    const maxTokens = typeof params.maxTokens === 'number' ? params.maxTokens : undefined
    const systemPrompt = typeof params.systemPrompt === 'string' ? params.systemPrompt : undefined

    const results = await Promise.all(temperatures.map(async temperature => {
      const start = now()
      const responses = await Promise.all(
        Array.from({ length: samples }, () =>
          complete(env.AI, env, { prompt, model: effectiveModel, systemPrompt, maxTokens, temperature })
            .catch(e => `[error: ${String(e)}]`),
        ),
      )
      return { temperature, responses, latencyMs: now() - start }
    }))
    return { results, model: effectiveModel ?? MODELS.text }
  }

  if (tool === 'sensitivity') {
    const variants = typeof params.variants === 'number' ? Math.max(2, Math.min(8, params.variants)) : 3
    const temperature = typeof params.temperature === 'number' ? params.temperature : undefined
    const maxTokens  = typeof params.maxTokens === 'number' ? params.maxTokens : undefined
    const systemPrompt = typeof params.systemPrompt === 'string' ? params.systemPrompt : undefined

    const t0 = now()
    const variantPrompts = await generatePromptVariants(env.AI, env, prompt, variants)
    const responses = await Promise.all(
      variantPrompts.map(vp => complete(env.AI, env, { model: effectiveModel, prompt: vp, systemPrompt, temperature, maxTokens })),
    )
    const embeddings = await embed(env.AI, responses, undefined, env)
    const similarityMatrix = computeSimilarityMatrix(embeddings)
    return {
      variants: variantPrompts.map((vp, i) => ({ prompt: vp, response: responses[i] })),
      similarityMatrix,
      latencyMs: now() - t0,
    }
  }

  if (tool === 'cot') {
    const samples   = typeof params.samples === 'number' ? Math.max(1, Math.min(5, params.samples)) : 3
    const temperature = typeof params.temperature === 'number' ? params.temperature : undefined
    const maxTokens  = typeof params.maxTokens === 'number' ? params.maxTokens : undefined
    const systemPrompt = typeof params.systemPrompt === 'string' ? params.systemPrompt : undefined
    return runCoTProbe(env.AI, env, { prompt, model: effectiveModel, systemPrompt, temperature, maxTokens }, samples)
  }

  if (tool === 'pipeline') {
    const pipelineId = typeof params.pipelineId === 'string' ? params.pipelineId : ''
    if (!pipelineId) throw new Error('pipeline tool requires params.pipelineId')
    const row = await env.DB.prepare('SELECT id, nodes, entry_id FROM pipelines WHERE id = ?')
      .bind(pipelineId).first<PipelineRow>()
    if (!row) throw new Error(`Pipeline "${pipelineId}" not found`)
    const nodes = JSON.parse(row.nodes) as PipelineNode[]
    return executePipeline(env.AI, env, prompt, nodes, row.entry_id)
  }

  if (tool === 'guard-rate') {
    // Counts guard events in a time window for the probe's sandbox.
    // params.windowMs: lookback window in ms (default: 1 hour)
    // params.eventType: event type filter (default: 'guard_flag')
    const windowMs   = typeof params.windowMs   === 'number' ? Math.max(60_000, params.windowMs) : 3_600_000
    const eventType  = typeof params.eventType  === 'string' ? params.eventType : 'guard_flag'
    const since      = now() - windowMs
    // Attempt to scope to sandbox_id from probe params; fall back to unscoped count
    const sandboxId  = typeof params.sandboxId === 'string' ? params.sandboxId : null
    let countRow: { count: number } | null
    if (sandboxId) {
      countRow = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM sandbox_events WHERE event_type = ? AND sandbox_id = ? AND created_at >= ?',
      ).bind(eventType, sandboxId, since).first<{ count: number }>()
    } else {
      countRow = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM sandbox_events WHERE event_type = ? AND created_at >= ?',
      ).bind(eventType, since).first<{ count: number }>()
    }
    const count = countRow?.count ?? 0
    return { count, windowMs, eventType, sandboxId }
  }

  throw new Error(`Unknown tool: ${String(tool)}`)
}

// ── Threshold evaluation + webhook dispatch ────────────────────────────────────

export function isThresholdBreached(threshold: Record<string, unknown>, metrics: Record<string, number>): boolean {
  const metric = typeof threshold.metric === 'string' ? threshold.metric : null
  const op     = typeof threshold.op     === 'string' ? threshold.op     : null
  const limit  = typeof threshold.value  === 'number' ? threshold.value  : null
  if (!metric || !op || limit === null) return false
  const actual = metrics[metric]
  if (typeof actual !== 'number') return false
  if (op === '>')  return actual >  limit
  if (op === '<')  return actual <  limit
  if (op === '>=') return actual >= limit
  if (op === '<=') return actual <= limit
  return false
}

// Fire-and-forget POST of a breach alert. When SIGNING_SECRET is configured the
// payload is signed (HMAC-SHA256 over `${timestamp}.${body}`) so receivers can
// verify the alert genuinely came from this platform — the standard
// Stripe/GitHub webhook scheme. Verify with:
//   sig === `${WEBHOOK_SIGNATURE_VERSION},sha256=` + HMAC(secret, `${X-Whisper-Timestamp}.${rawBody}`)
export async function dispatchWebhook(
  env: Env,
  webhookUrl: string,
  payload: { probeId: string; runId?: string; probeName: string; metricValue: number | null; metrics: Record<string, number>; breachedAt: number },
): Promise<void> {
  const body = JSON.stringify(payload)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (env.SIGNING_SECRET) {
    const ts  = now()
    const sig = await signPayload(`${ts}.${body}`, env.SIGNING_SECRET)
    headers['X-Whisper-Timestamp'] = String(ts)
    headers['X-Whisper-Signature'] = `${WEBHOOK_SIGNATURE_VERSION},sha256=${sig}`
  }
  // Hash the URL before storing — webhook URL may contain embedded secrets.
  const urlHashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(webhookUrl))
  const urlHash    = Array.from(new Uint8Array(urlHashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')

  let statusCode: number | null = null
  await fetch(webhookUrl, {
    method:  'POST',
    headers,
    body,
    signal:  AbortSignal.timeout(PROBE_WEBHOOK_TIMEOUT_MS),
    // The URL was validated against private ranges at creation time; following a
    // redirect would let the receiver bounce the request past that check (SSRF).
    redirect: 'manual',
  }).then(r => { statusCode = r.status }).catch(() => { /* network error — statusCode stays null */ })

  // Write delivery receipt so operators can see whether alerts reached receivers.
  env.DB.prepare(
    'INSERT INTO webhook_deliveries (id, probe_id, run_id, url_hash, status_code, delivered_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(newId(), payload.probeId, payload.runId ?? '', urlHash, statusCode, now()).run()
    .catch(() => { /* receipt write must not throw */ })
}

// ── Shape a probe row for API responses ────────────────────────────────────────

export function shapeProbe(row: ProbeRow & { run_count?: number }): Record<string, unknown> {
  return {
    id:             row.id,
    name:           row.name,
    description:    row.description,
    prompt:         row.prompt,
    tool:           row.tool,
    params:         (() => { try { return JSON.parse(row.params) as Record<string, unknown> } catch { return {} } })(),
    model:          row.model,
    schedule:       row.schedule,
    threshold:      (() => { try { return JSON.parse(row.threshold) as Record<string, unknown> } catch { return {} } })(),
    sandbox_id:     row.sandbox_id     ?? null,
    environment_id: row.environment_id ?? null,
    webhook_url:    row.webhook_url    ?? null,
    created_at:     row.created_at,
    last_run_at:    row.last_run_at    ?? null,
    ...(row.run_count !== undefined ? { run_count: row.run_count } : {}),
  }
}

// ── Cron-callable runner ──────────────────────────────────────────────────────

export async function runProbeById(id: string, env: Env): Promise<void> {
  const probe = await env.DB.prepare('SELECT * FROM probes WHERE id = ?').bind(id).first<ProbeRow>()
  if (!probe) return
  const probeParams = (() => {
    try { return JSON.parse(probe.params) as Record<string, unknown> } catch { return {} }
  })()

  // Resolve sandbox context if this probe is scoped to a specific app
  let effectiveModel = probe.model || undefined
  if (probe.sandbox_id) {
    const ctx = await resolveAnalysisContext(probe.sandbox_id, env)
    if (!probe.model && ctx.model) effectiveModel = ctx.model
    if (!probeParams.systemPrompt && ctx.systemPrompt) probeParams.systemPrompt = ctx.systemPrompt
  }

  const result = await runProbeTool(probe.tool, probe.prompt, effectiveModel, probeParams, env)
  const metricValue = extractMetricValue(probe.tool, result)
  const metricsJson = extractMetrics(probe.tool, result)
  const runId = newId()
  const ts = now()
  await env.DB.prepare(
    'INSERT INTO probe_runs (id, probe_id, tool, result, metric_value, metrics_json, run_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(runId, probe.id, probe.tool, JSON.stringify(result), metricValue, JSON.stringify(metricsJson), ts).run()
  await env.DB.prepare('UPDATE probes SET last_run_at = ? WHERE id = ?').bind(ts, probe.id).run()

  const threshold = (() => { try { return JSON.parse(probe.threshold) as Record<string, unknown> } catch { return {} } })()
  if (probe.webhook_url && isThresholdBreached(threshold, metricsJson)) {
    // Awaited for the same reason as the run handler — see dispatchWebhook.
    await dispatchWebhook(env, probe.webhook_url, { probeId: probe.id, runId, probeName: probe.name, metricValue, metrics: metricsJson, breachedAt: ts })
  }
}
