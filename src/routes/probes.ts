import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, parseBody } from '../lib/http'
import {
  complete, embed, estimateEntropy, runCoTProbe,
  generatePromptVariants, computeSimilarityMatrix,
} from '../lib/ai'
import { MODELS } from '../lib/ai'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_NAME_LEN        = 128
const MAX_DESC_LEN        = 512
const MAX_PROMPT_LEN      = 10_000
const VALID_TOOLS         = ['entropy', 'sweep', 'sensitivity', 'cot'] as const
const VALID_SCHEDULES     = ['hourly', 'daily', 'weekly'] as const
const DEFAULT_HISTORY_LIMIT = 50
const MAX_HISTORY_LIMIT   = 200

type ProbeTool     = typeof VALID_TOOLS[number]
type ProbeSchedule = typeof VALID_SCHEDULES[number]

// ── D1 row types ──────────────────────────────────────────────────────────────

interface ProbeRow {
  id:          string
  name:        string
  description: string
  prompt:      string
  tool:        ProbeTool
  params:      string  // JSON
  model:       string
  schedule:    ProbeSchedule
  threshold:   string  // JSON
  created_at:  number
  last_run_at: number | null
}

interface ProbeRunRow {
  id:           string
  probe_id:     string
  tool:         string
  result:       string  // JSON
  metric_value: number | null
  run_at:       number
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseCreateProbe(body: unknown): {
  name: string
  description: string
  prompt: string
  tool: ProbeTool
  params: Record<string, unknown>
  model: string
  schedule: ProbeSchedule
  threshold: Record<string, unknown>
} {
  if (typeof body !== 'object' || body === null) throw new Error('Body must be an object')
  const b = body as Record<string, unknown>

  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) throw new Error('name is required')
  if (name.length > MAX_NAME_LEN) throw new Error(`name exceeds ${MAX_NAME_LEN} characters`)

  const description = typeof b.description === 'string' ? b.description.slice(0, MAX_DESC_LEN) : ''

  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : ''
  if (!prompt) throw new Error('prompt is required')
  if (prompt.length > MAX_PROMPT_LEN) throw new Error(`prompt exceeds ${MAX_PROMPT_LEN} characters`)

  const tool = typeof b.tool === 'string' ? b.tool : ''
  if (!(VALID_TOOLS as readonly string[]).includes(tool)) {
    throw new Error(`tool must be one of: ${VALID_TOOLS.join(', ')}`)
  }

  const params = (typeof b.params === 'object' && b.params !== null && !Array.isArray(b.params))
    ? (b.params as Record<string, unknown>)
    : {}

  const model = typeof b.model === 'string' ? b.model : ''

  const schedule = typeof b.schedule === 'string' ? b.schedule : 'daily'
  if (!(VALID_SCHEDULES as readonly string[]).includes(schedule)) {
    throw new Error(`schedule must be one of: ${VALID_SCHEDULES.join(', ')}`)
  }

  const threshold = (typeof b.threshold === 'object' && b.threshold !== null && !Array.isArray(b.threshold))
    ? (b.threshold as Record<string, unknown>)
    : {}

  return {
    name,
    description,
    prompt,
    tool: tool as ProbeTool,
    params,
    model,
    schedule: schedule as ProbeSchedule,
    threshold,
  }
}

function parsePatchProbe(body: unknown): Partial<{
  name: string
  description: string
  prompt: string
  tool: ProbeTool
  params: Record<string, unknown>
  model: string
  schedule: ProbeSchedule
  threshold: Record<string, unknown>
}> {
  if (typeof body !== 'object' || body === null) throw new Error('Body must be an object')
  const b = body as Record<string, unknown>
  const out: ReturnType<typeof parsePatchProbe> = {}

  if (b.name !== undefined) {
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) throw new Error('name cannot be empty')
    if (name.length > MAX_NAME_LEN) throw new Error(`name exceeds ${MAX_NAME_LEN} characters`)
    out.name = name
  }
  if (b.description !== undefined) {
    out.description = typeof b.description === 'string' ? b.description.slice(0, MAX_DESC_LEN) : ''
  }
  if (b.prompt !== undefined) {
    const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : ''
    if (!prompt) throw new Error('prompt cannot be empty')
    if (prompt.length > MAX_PROMPT_LEN) throw new Error(`prompt exceeds ${MAX_PROMPT_LEN} characters`)
    out.prompt = prompt
  }
  if (b.tool !== undefined) {
    const tool = typeof b.tool === 'string' ? b.tool : ''
    if (!(VALID_TOOLS as readonly string[]).includes(tool)) {
      throw new Error(`tool must be one of: ${VALID_TOOLS.join(', ')}`)
    }
    out.tool = tool as ProbeTool
  }
  if (b.params !== undefined) {
    out.params = (typeof b.params === 'object' && b.params !== null && !Array.isArray(b.params))
      ? (b.params as Record<string, unknown>)
      : {}
  }
  if (b.model !== undefined) {
    out.model = typeof b.model === 'string' ? b.model : ''
  }
  if (b.schedule !== undefined) {
    const schedule = typeof b.schedule === 'string' ? b.schedule : ''
    if (!(VALID_SCHEDULES as readonly string[]).includes(schedule)) {
      throw new Error(`schedule must be one of: ${VALID_SCHEDULES.join(', ')}`)
    }
    out.schedule = schedule as ProbeSchedule
  }
  if (b.threshold !== undefined) {
    out.threshold = (typeof b.threshold === 'object' && b.threshold !== null && !Array.isArray(b.threshold))
      ? (b.threshold as Record<string, unknown>)
      : {}
  }
  return out
}

// ── Metric extraction ─────────────────────────────────────────────────────────

function extractMetricValue(tool: ProbeTool, result: unknown): number | null {
  if (typeof result !== 'object' || result === null) return null
  const r = result as Record<string, unknown>

  if (tool === 'entropy') {
    // estimateEntropy returns { entropy, samples, avgCosineSimilarity, latencyMs }
    return typeof r.entropy === 'number' ? r.entropy : null
  }

  if (tool === 'sweep') {
    // sweep returns { results: [{ temperature, responses, latencyMs }], model }
    const results = Array.isArray(r.results) ? r.results : []
    if (results.length === 0) return null
    const first = results[0] as Record<string, unknown>
    return typeof first.latencyMs === 'number' ? first.latencyMs : null
  }

  if (tool === 'sensitivity') {
    // sensitivity returns { variants, similarityMatrix, latencyMs }
    const matrix = r.similarityMatrix
    if (!Array.isArray(matrix) || matrix.length === 0) return null
    let sum = 0
    let count = 0
    for (let i = 0; i < matrix.length; i++) {
      if (!Array.isArray(matrix[i])) continue
      for (let j = 0; j < (matrix[i] as number[]).length; j++) {
        if (i !== j) {
          sum += (matrix[i] as number[])[j]
          count++
        }
      }
    }
    return count > 0 ? sum / count : null
  }

  if (tool === 'cot') {
    // runCoTProbe returns an array of CoTResult: [{ style, response, latencyMs }]
    if (!Array.isArray(result) || result.length === 0) return null
    const first = (result as Record<string, unknown>[])[0]
    return typeof first.latencyMs === 'number' ? first.latencyMs : null
  }

  return null
}

// ── Tool runner ───────────────────────────────────────────────────────────────

async function runProbeTool(
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
      const start = Date.now()
      const responses = await Promise.all(
        Array.from({ length: samples }, () =>
          complete(env.AI, env, { prompt, model: effectiveModel, systemPrompt, maxTokens, temperature })
            .catch(e => `[error: ${String(e)}]`),
        ),
      )
      return { temperature, responses, latencyMs: Date.now() - start }
    }))
    return { results, model: effectiveModel ?? MODELS.text }
  }

  if (tool === 'sensitivity') {
    const variants = typeof params.variants === 'number' ? Math.max(2, Math.min(8, params.variants)) : 3
    const temperature = typeof params.temperature === 'number' ? params.temperature : undefined
    const maxTokens  = typeof params.maxTokens === 'number' ? params.maxTokens : undefined
    const systemPrompt = typeof params.systemPrompt === 'string' ? params.systemPrompt : undefined

    const t0 = Date.now()
    const variantPrompts = await generatePromptVariants(env.AI, env, prompt, variants)
    const responses = await Promise.all(
      variantPrompts.map(vp => complete(env.AI, env, { model: effectiveModel, prompt: vp, systemPrompt, temperature, maxTokens })),
    )
    const embeddings = await embed(env.AI, responses)
    const similarityMatrix = computeSimilarityMatrix(embeddings)
    return {
      variants: variantPrompts.map((vp, i) => ({ prompt: vp, response: responses[i] })),
      similarityMatrix,
      latencyMs: Date.now() - t0,
    }
  }

  if (tool === 'cot') {
    const samples   = typeof params.samples === 'number' ? Math.max(1, Math.min(5, params.samples)) : 3
    const temperature = typeof params.temperature === 'number' ? params.temperature : undefined
    const maxTokens  = typeof params.maxTokens === 'number' ? params.maxTokens : undefined
    const systemPrompt = typeof params.systemPrompt === 'string' ? params.systemPrompt : undefined
    return runCoTProbe(env.AI, env, { prompt, model: effectiveModel, systemPrompt, temperature, maxTokens }, samples)
  }

  throw new Error(`Unknown tool: ${String(tool)}`)
}

// ── Shape a probe row for API responses ────────────────────────────────────────

function shapeProbe(row: ProbeRow & { run_count?: number }): Record<string, unknown> {
  return {
    id:          row.id,
    name:        row.name,
    description: row.description,
    prompt:      row.prompt,
    tool:        row.tool,
    params:      (() => { try { return JSON.parse(row.params) as Record<string, unknown> } catch { return {} } })(),
    model:       row.model,
    schedule:    row.schedule,
    threshold:   (() => { try { return JSON.parse(row.threshold) as Record<string, unknown> } catch { return {} } })(),
    created_at:  row.created_at,
    last_run_at: row.last_run_at ?? null,
    ...(row.run_count !== undefined ? { run_count: row.run_count } : {}),
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

const createProbe: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parseCreateProbe)
  if (!p.ok) return p.response
  const { name, description, prompt, tool, params, model, schedule, threshold } = p.data
  const id = crypto.randomUUID()
  const created_at = Date.now()
  try {
    await env.DB.prepare(
      'INSERT INTO probes (id, name, description, prompt, tool, params, model, schedule, threshold, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, name, description, prompt, tool, JSON.stringify(params), model, schedule, JSON.stringify(threshold), created_at).run()
    return json(ok({ id, name, description, prompt, tool, params, model, schedule, threshold, created_at, last_run_at: null }))
  } catch (e) {
    return json(err('Failed to create probe', String(e)), 500)
  }
}

const listProbes: Handler = async (_req: Request, env: Env) => {
  try {
    const result = await env.DB.prepare(
      'SELECT p.*, (SELECT COUNT(*) FROM probe_runs WHERE probe_id = p.id) as run_count FROM probes p ORDER BY created_at DESC LIMIT 100',
    ).all<ProbeRow & { run_count: number }>()
    const probes = (result.results ?? []).map(r => shapeProbe(r))
    return json(ok({ probes, total: probes.length }))
  } catch (e) {
    return json(err('Failed to list probes', String(e)), 500)
  }
}

const getProbe: Handler = async (_req: Request, env: Env, params) => {
  const id = params.id
  if (!id) return json(err('Missing id'), 400)
  try {
    const probe = await env.DB.prepare('SELECT * FROM probes WHERE id = ?').bind(id).first<ProbeRow>()
    if (!probe) return json(err('Probe not found'), 404)

    const runsResult = await env.DB.prepare(
      'SELECT id, run_at, metric_value, tool FROM probe_runs WHERE probe_id = ? ORDER BY run_at DESC LIMIT 10',
    ).bind(id).all<Pick<ProbeRunRow, 'id' | 'run_at' | 'metric_value' | 'tool'>>()
    const runs = runsResult.results ?? []

    return json(ok({
      ...shapeProbe(probe),
      recent_runs: runs,
    }))
  } catch (e) {
    return json(err('Failed to get probe', String(e)), 500)
  }
}

const patchProbe: Handler = async (req: Request, env: Env, params) => {
  const id = params.id
  if (!id) return json(err('Missing id'), 400)

  const p = await parseBody(req, parsePatchProbe)
  if (!p.ok) return p.response
  const patch = p.data

  if (Object.keys(patch).length === 0) return json(err('No fields to update'), 400)

  try {
    const existing = await env.DB.prepare('SELECT * FROM probes WHERE id = ?').bind(id).first<ProbeRow>()
    if (!existing) return json(err('Probe not found'), 404)

    const setClauses: string[] = []
    const bindings: (string | number | null)[] = []

    if (patch.name !== undefined)        { setClauses.push('name = ?');        bindings.push(patch.name) }
    if (patch.description !== undefined) { setClauses.push('description = ?'); bindings.push(patch.description) }
    if (patch.prompt !== undefined)      { setClauses.push('prompt = ?');      bindings.push(patch.prompt) }
    if (patch.tool !== undefined)        { setClauses.push('tool = ?');        bindings.push(patch.tool) }
    if (patch.params !== undefined)      { setClauses.push('params = ?');      bindings.push(JSON.stringify(patch.params)) }
    if (patch.model !== undefined)       { setClauses.push('model = ?');       bindings.push(patch.model) }
    if (patch.schedule !== undefined)    { setClauses.push('schedule = ?');    bindings.push(patch.schedule) }
    if (patch.threshold !== undefined)   { setClauses.push('threshold = ?');   bindings.push(JSON.stringify(patch.threshold)) }

    bindings.push(id)
    await env.DB.prepare(`UPDATE probes SET ${setClauses.join(', ')} WHERE id = ?`).bind(...bindings).run()

    const updated = await env.DB.prepare('SELECT * FROM probes WHERE id = ?').bind(id).first<ProbeRow>()
    return json(ok(shapeProbe(updated!)))
  } catch (e) {
    return json(err('Failed to update probe', String(e)), 500)
  }
}

const deleteProbe: Handler = async (_req: Request, env: Env, params) => {
  const id = params.id
  if (!id) return json(err('Missing id'), 400)
  try {
    await env.DB.prepare('DELETE FROM probe_runs WHERE probe_id = ?').bind(id).run()
    await env.DB.prepare('DELETE FROM probes WHERE id = ?').bind(id).run()
    return json(ok({ deleted: true }))
  } catch (e) {
    return json(err('Failed to delete probe', String(e)), 500)
  }
}

const runProbe: Handler = async (_req: Request, env: Env, params) => {
  const id = params.id
  if (!id) return json(err('Missing id'), 400)
  try {
    const probe = await env.DB.prepare('SELECT * FROM probes WHERE id = ?').bind(id).first<ProbeRow>()
    if (!probe) return json(err('Probe not found'), 404)

    const probeParams = (() => {
      try { return JSON.parse(probe.params) as Record<string, unknown> } catch { return {} }
    })()

    const result = await runProbeTool(
      probe.tool,
      probe.prompt,
      probe.model || undefined,
      probeParams,
      env,
    )

    const metricValue = extractMetricValue(probe.tool, result)
    const runId = crypto.randomUUID()
    const now = Date.now()

    await env.DB.prepare(
      'INSERT INTO probe_runs (id, probe_id, tool, result, metric_value, run_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(runId, probe.id, probe.tool, JSON.stringify(result), metricValue, now).run()

    await env.DB.prepare('UPDATE probes SET last_run_at = ? WHERE id = ?').bind(now, probe.id).run()

    return json(ok({ runId, metricValue, result }))
  } catch (e) {
    return json(err('Probe run failed', String(e)), 500)
  }
}

const getProbeHistory: Handler = async (req: Request, env: Env, params) => {
  const id = params.id
  if (!id) return json(err('Missing id'), 400)

  const url = new URL(req.url)
  const limit = Math.min(
    Math.max(1, parseInt(url.searchParams.get('limit') ?? String(DEFAULT_HISTORY_LIMIT), 10) || DEFAULT_HISTORY_LIMIT),
    MAX_HISTORY_LIMIT,
  )

  try {
    const probe = await env.DB.prepare('SELECT * FROM probes WHERE id = ?').bind(id).first<ProbeRow>()
    if (!probe) return json(err('Probe not found'), 404)

    const runsResult = await env.DB.prepare(
      'SELECT id, run_at, metric_value, tool FROM probe_runs WHERE probe_id = ? ORDER BY run_at DESC LIMIT ?',
    ).bind(id, limit).all<Pick<ProbeRunRow, 'id' | 'run_at' | 'metric_value' | 'tool'>>()

    const threshold = (() => {
      try { return JSON.parse(probe.threshold) as Record<string, unknown> } catch { return {} }
    })()

    return json(ok({
      probe_id: id,
      name:     probe.name,
      tool:     probe.tool,
      threshold,
      runs:     runsResult.results ?? [],
      total:    (runsResult.results ?? []).length,
    }))
  } catch (e) {
    return json(err('Failed to get probe history', String(e)), 500)
  }
}

// ── Cron-callable runner ──────────────────────────────────────────────────────

export async function runProbeById(id: string, env: Env): Promise<void> {
  const probe = await env.DB.prepare('SELECT * FROM probes WHERE id = ?').bind(id).first<ProbeRow>()
  if (!probe) return
  const probeParams = (() => {
    try { return JSON.parse(probe.params) as Record<string, unknown> } catch { return {} }
  })()
  const result = await runProbeTool(probe.tool, probe.prompt, probe.model || undefined, probeParams, env)
  const metricValue = extractMetricValue(probe.tool, result)
  const runId = crypto.randomUUID()
  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO probe_runs (id, probe_id, tool, result, metric_value, run_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(runId, probe.id, probe.tool, JSON.stringify(result), metricValue, now).run()
  await env.DB.prepare('UPDATE probes SET last_run_at = ? WHERE id = ?').bind(now, probe.id).run()
}

// ── Route table ───────────────────────────────────────────────────────────────

export const probesRoutes: Array<[string, string, Handler]> = [
  ['POST',   '/api/probes',             createProbe],
  ['GET',    '/api/probes',             listProbes],
  ['GET',    '/api/probes/:id',         getProbe],
  ['PATCH',  '/api/probes/:id',         patchProbe],
  ['DELETE', '/api/probes/:id',         deleteProbe],
  ['POST',   '/api/probes/:id/run',     runProbe],
  ['GET',    '/api/probes/:id/history', getProbeHistory],
]
