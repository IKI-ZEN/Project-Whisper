import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err } from '../lib/http'
import { MAX_BUILD_DESCRIPTION_LEN, MAX_NAME_LEN } from '../lib/constants'

// ── DO stub helpers ───────────────────────────────────────────────────────────

function buildStub(env: Env, id: string): DurableObjectStub {
  return env.APP_BUILDER.get(env.APP_BUILDER.idFromName(id))
}

function doBuild(stub: DurableObjectStub, path: string, method = 'GET', body?: unknown): Promise<Response> {
  return stub.fetch(new Request(`http://do${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  }))
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// POST /api/v2/build
export const createBuildHandler: Handler = async (req, env) => {
  let body: { description?: unknown; name?: unknown; sandboxId?: unknown; model?: unknown }
  try { body = await req.json() } catch { return json(err('Invalid JSON body'), 400) }

  if (typeof body.description !== 'string' || !body.description.trim()) {
    return json(err('description is required'), 422)
  }

  const description = body.description.trim().slice(0, MAX_BUILD_DESCRIPTION_LEN)
  const name      = typeof body.name      === 'string' ? body.name.slice(0, MAX_NAME_LEN) : undefined
  const sandboxId = typeof body.sandboxId === 'string' ? body.sandboxId : undefined
  const model     = typeof body.model     === 'string' ? body.model     : undefined

  const id   = crypto.randomUUID()
  const stub = buildStub(env, id)

  const initRes  = await doBuild(stub, '/init', 'POST', { id, description, name, sandboxId, model })
  const initData = await initRes.json() as { ok: boolean; error?: string }
  if (!initData.ok) return json(err(initData.error ?? 'Failed to initialise build'), 500)

  return json(ok({ buildId: id, wsUrl: `/api/v2/build/${id}/ws`, appUrl: `/build/${id}`, status: 'idle' }))
}

// GET /api/v2/build/:id
export const getBuildHandler: Handler = async (_req, env, params) => {
  const id   = params.id ?? ''
  const res  = await doBuild(buildStub(env, id), '/status')
  const data = await res.json() as { ok: boolean; data?: unknown; error?: string }
  if (!data.ok) return json(err(data.error ?? 'Build not found'), 404)
  return json(ok(data.data))
}

// GET /api/v2/build/:id/files
export const listBuildFilesHandler: Handler = async (_req, env, params) => {
  const id   = params.id ?? ''
  const res  = await doBuild(buildStub(env, id), '/files')
  const data = await res.json() as { ok: boolean; data?: unknown; error?: string }
  if (!data.ok) return json(err(data.error ?? 'Build not found'), 404)
  return json(ok(data.data))
}

// GET /api/v2/build/:id/files/:filename
export const getBuildFileHandler: Handler = async (_req, env, params) => {
  const id       = params.id ?? ''
  const filename = params.filename ?? 'index.html'
  const res = await doBuild(buildStub(env, id), `/files/${encodeURIComponent(filename)}`)
  if (!res.ok) return json(err('File not found'), 404)
  // Return the raw file response (already has correct Content-Type from the DO)
  return res
}

// DELETE /api/v2/build/:id
export const deleteBuildHandler: Handler = async (_req, env, params) => {
  const id   = params.id ?? ''
  const res  = await doBuild(buildStub(env, id), '/', 'DELETE')
  const data = await res.json() as { ok: boolean; error?: string }
  if (!data.ok) return json(err(data.error ?? 'Delete failed'), 500)
  return json(ok({ deleted: true }))
}

// ── Route table ───────────────────────────────────────────────────────────────

export const buildRoutes: Array<[string, string, Handler]> = [
  ['POST',   '/api/v2/build',                     createBuildHandler],
  ['GET',    '/api/v2/build/:id',                 getBuildHandler],
  ['GET',    '/api/v2/build/:id/files',           listBuildFilesHandler],
  ['GET',    '/api/v2/build/:id/files/:filename', getBuildFileHandler],
  ['DELETE', '/api/v2/build/:id',                 deleteBuildHandler],
]
