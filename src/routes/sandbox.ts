import type { Env } from '../types/env'
import type { Handler, Params } from '../lib/http'
import { json, ok, err, readJson } from '../lib/http'
import { parseCreateSandboxRequest, parseRunSandboxRequest, type SandboxConfig } from '../lib/schema'
import { newId, now } from '../lib/utils'

// ── Internal DO dispatch ──────────────────────────────────────────────────────

function stub(env: Env, sandboxId: string): DurableObjectStub {
  return env.SANDBOX.get(env.SANDBOX.idFromName(sandboxId))
}

async function doFetch(
  s: DurableObjectStub,
  path: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  return s.fetch(`https://do/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function exists(env: Env, id: string): Promise<boolean> {
  return (await env.SANDBOX_REGISTRY.get(`sandbox:${id}`)) !== null
}

// ── Handlers ──────────────────────────────────────────────────────────────────

const create: Handler = async (req, env) => {
  let body: unknown
  try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
  let parsed
  try { parsed = parseCreateSandboxRequest(body) } catch (e) { return json(err(String(e)), 422) }

  const id = newId()
  const ts = now()

  const config: SandboxConfig = { ...parsed, id, memory: [], createdAt: ts, updatedAt: ts }

  // Initialise the Durable Object
  await doFetch(stub(env, id), 'init', 'POST', config)

  // Register in KV (7-day TTL)
  await env.SANDBOX_REGISTRY.put(
    `sandbox:${id}`,
    JSON.stringify({ id, name: config.name, createdAt: ts }),
    { expirationTtl: 604800 },
  )

  // Audit log
  await env.DB.prepare(
    'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)',
  ).bind(id, 'created', JSON.stringify({ name: config.name }), ts).run()

  return json(ok({ id, name: config.name, endpoint: `/api/sandbox/${id}` }), 201)
}

const getConfig: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await exists(env, id)) return json(err('Sandbox not found'), 404)
  return doFetch(stub(env, id), 'config', 'GET')
}

const patchConfig: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await exists(env, id)) return json(err('Sandbox not found'), 404)
  let body: unknown
  try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
  return doFetch(stub(env, id), 'config', 'PATCH', body)
}

const run: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await exists(env, id)) return json(err('Sandbox not found'), 404)
  let body: unknown
  try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
  let parsed
  try { parsed = parseRunSandboxRequest(body) } catch (e) { return json(err(String(e)), 422) }

  const res = await doFetch(stub(env, id), 'run', 'POST', { message: parsed.message })

  await env.DB.prepare(
    'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)',
  ).bind(id, 'run', '{}', now()).run()

  return res
}

const stream: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await exists(env, id)) return json(err('Sandbox not found'), 404)
  let body: unknown
  try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
  let parsed
  try { parsed = parseRunSandboxRequest(body) } catch (e) { return json(err(String(e)), 422) }

  // Forward the SSE stream from the DO directly
  const doRes = await stub(env, id).fetch(`https://do/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: parsed.message }),
  })

  return new Response(doRes.body, {
    status: doRes.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

const history: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await exists(env, id)) return json(err('Sandbox not found'), 404)
  return doFetch(stub(env, id), 'history', 'GET')
}

const del: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await exists(env, id)) return json(err('Sandbox not found'), 404)
  await doFetch(stub(env, id), '/', 'DELETE')
  await env.SANDBOX_REGISTRY.delete(`sandbox:${id}`)
  await env.DB.prepare(
    'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)',
  ).bind(id, 'deleted', '{}', now()).run()
  return json(ok({ deleted: true }))
}

export const sandboxRoutes: Array<[string, string, Handler]> = [
  ['POST',   '/api/sandbox',              create],
  ['GET',    '/api/sandbox/:id',          getConfig],
  ['PATCH',  '/api/sandbox/:id',          patchConfig],
  ['POST',   '/api/sandbox/:id/run',      run],
  ['POST',   '/api/sandbox/:id/stream',   stream],
  ['GET',    '/api/sandbox/:id/history',  history],
  ['DELETE', '/api/sandbox/:id',          del],
]
