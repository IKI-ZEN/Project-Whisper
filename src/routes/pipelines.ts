import type { Env } from '../types/env'
import type { Handler, Params } from '../lib/http'
import { json, ok, err, parseBody, checkRateLimit, parseQueryInt } from '../lib/http'
import { newId, isUUID, now } from '../lib/utils'
import type { PipelineNode } from '../lib/schema'
import { parseCreatePipeline, parsePatchPipeline, parsePipelineRunRequest } from '../lib/schema'
import { executePipeline } from '../lib/pipeline'
import { PIPELINE_WRITE_RATE_LIMIT_MAX, PIPELINE_WRITE_RATE_LIMIT_WINDOW, PIPELINE_RUN_RATE_LIMIT_MAX, PIPELINE_RUN_RATE_LIMIT_WINDOW, LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX } from '../lib/constants'

// ── D1 row type ───────────────────────────────────────────────────────────────

interface PipelineRow {
  id:          string
  name:        string
  description: string
  nodes:       string  // JSON: PipelineNode[]
  entry_id:    string
  created_at:  number
  updated_at:  number
}

function shapeRow(row: PipelineRow) {
  let nodes: unknown[] = []
  try { nodes = JSON.parse(row.nodes) as unknown[] } catch { /* ignore */ }
  return {
    id:          row.id,
    name:        row.name,
    description: row.description,
    nodes,
    entryId:     row.entry_id,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// POST /api/pipelines
const createPipeline: Handler = async (req, env) => {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
  const rl = await checkRateLimit(`rl:pipeline-write:${ip}`, PIPELINE_WRITE_RATE_LIMIT_MAX, PIPELINE_WRITE_RATE_LIMIT_WINDOW, env)
  if (rl) return rl
  const p = await parseBody(req, parseCreatePipeline)
  if (!p.ok) return p.response
  const { name, description, nodes, entryId } = p.data
  const id  = newId()
  const ts  = now()
  try {
    await env.DB.prepare(
      'INSERT INTO pipelines (id, name, description, nodes, entry_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, name, description, JSON.stringify(nodes), entryId, ts, ts).run()
    return json(ok({ id, name, description, nodes, entryId, createdAt: ts, updatedAt: ts }), 201)
  } catch (e) {
    return json(err('Failed to create pipeline', String(e)), 500)
  }
}

// GET /api/pipelines
const listPipelines: Handler = async (req, env) => {
  const url    = new URL(req.url)
  const limit  = parseQueryInt(url.searchParams, 'limit', LIST_LIMIT_DEFAULT, 1, LIST_LIMIT_MAX)
  const offset = parseQueryInt(url.searchParams, 'offset', 0)
  try {
    const [data, count] = await Promise.all([
      env.DB.prepare('SELECT * FROM pipelines ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(limit, offset).all<PipelineRow>(),
      env.DB.prepare('SELECT COUNT(*) as total FROM pipelines').first<{ total: number }>(),
    ])
    return json(ok({ pipelines: (data.results ?? []).map(shapeRow), total: count?.total ?? 0, limit, offset }))
  } catch (e) {
    return json(err('Failed to list pipelines', String(e)), 500)
  }
}

// GET /api/pipelines/:id
const getPipeline: Handler = async (_req, env, params: Params) => {
  const id = params.id
  if (!id) return json(err('Missing id'), 400)
  if (!isUUID(id)) return json(err('Invalid id'), 422)
  try {
    const row = await env.DB.prepare('SELECT * FROM pipelines WHERE id = ?').bind(id).first<PipelineRow>()
    if (!row) return json(err('Pipeline not found'), 404)
    return json(ok(shapeRow(row)))
  } catch (e) {
    return json(err('Failed to get pipeline', String(e)), 500)
  }
}

// PATCH /api/pipelines/:id
const patch: Handler = async (req, env, params: Params) => {
  const id = params.id
  if (!id) return json(err('Missing id'), 400)
  if (!isUUID(id)) return json(err('Invalid id'), 422)
  const p = await parseBody(req, parsePatchPipeline)
  if (!p.ok) return p.response
  const patch = p.data
  if (Object.keys(patch).length === 0) return json(err('No fields to update'), 400)

  try {
    const existing = await env.DB.prepare('SELECT id FROM pipelines WHERE id = ?').bind(id).first<{ id: string }>()
    if (!existing) return json(err('Pipeline not found'), 404)

    const setClauses: string[] = ['updated_at = ?']
    const bindings: (string | number)[] = [now()]

    if (patch.name        !== undefined) { setClauses.push('name = ?');        bindings.push(patch.name) }
    if (patch.description !== undefined) { setClauses.push('description = ?'); bindings.push(patch.description) }
    if (patch.nodes       !== undefined) { setClauses.push('nodes = ?');       bindings.push(JSON.stringify(patch.nodes)) }
    if (patch.entryId     !== undefined) { setClauses.push('entry_id = ?');    bindings.push(patch.entryId) }

    bindings.push(id)
    await env.DB.prepare(`UPDATE pipelines SET ${setClauses.join(', ')} WHERE id = ?`).bind(...bindings).run()

    const updated = await env.DB.prepare('SELECT * FROM pipelines WHERE id = ?').bind(id).first<PipelineRow>()
    return json(ok(shapeRow(updated!)))
  } catch (e) {
    return json(err('Failed to update pipeline', String(e)), 500)
  }
}

// DELETE /api/pipelines/:id
const deletePipeline: Handler = async (_req, env, params: Params) => {
  const id = params.id
  if (!id) return json(err('Missing id'), 400)
  if (!isUUID(id)) return json(err('Invalid id'), 422)
  try {
    const result = await env.DB.prepare('DELETE FROM pipelines WHERE id = ?').bind(id).run()
    if ((result.meta?.changes ?? 0) === 0) return json(err('Pipeline not found'), 404)
    return json(ok({ deleted: true }))
  } catch (e) {
    return json(err('Failed to delete pipeline', String(e)), 500)
  }
}

// POST /api/pipelines/:id/run
const run: Handler = async (req, env, params: Params) => {
  const id = params.id
  if (!id) return json(err('Missing id'), 400)
  if (!isUUID(id)) return json(err('Invalid id'), 422)
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
  const rl = await checkRateLimit(`rl:pipeline-run:${ip}`, PIPELINE_RUN_RATE_LIMIT_MAX, PIPELINE_RUN_RATE_LIMIT_WINDOW, env)
  if (rl) return rl
  const p = await parseBody(req, parsePipelineRunRequest)
  if (!p.ok) return p.response

  try {
    const row = await env.DB.prepare('SELECT * FROM pipelines WHERE id = ?').bind(id).first<PipelineRow>()
    if (!row) return json(err('Pipeline not found'), 404)

    const nodes = JSON.parse(row.nodes) as PipelineNode[]
    const result = await executePipeline(env.AI, env, p.data.input, nodes, row.entry_id)
    return json(ok(result))
  } catch (e) {
    return json(err('Pipeline execution failed', String(e)), 500)
  }
}

// ── Route table ───────────────────────────────────────────────────────────────

export const pipelineRoutes: Array<[string, string, Handler]> = [
  ['POST',   '/api/pipelines',         createPipeline],
  ['GET',    '/api/pipelines',         listPipelines],
  ['GET',    '/api/pipelines/:id',     getPipeline],
  ['PATCH',  '/api/pipelines/:id',     patch],
  ['DELETE', '/api/pipelines/:id',     deletePipeline],
  ['POST',   '/api/pipelines/:id/run', run],
]
