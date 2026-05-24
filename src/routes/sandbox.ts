import type { Env } from '../types/env'
import type { Handler, Params } from '../lib/http'
import { json, ok, err, readJson, sseResponse } from '../lib/http'
import { parseCreateSandboxRequest, parseRunSandboxRequest, type SandboxConfig } from '../lib/schema'
import { newId, now } from '../lib/utils'
import { SANDBOX_KEY_PREFIX, SANDBOX_TTL } from '../lib/constants'

// ── KV metadata shape (stored with each sandbox key) ─────────────────────────

export interface SandboxMeta {
  id: string
  name: string
  description: string
  model: string
  createdAt: number
  fromVibe?: boolean
}

// ── Internal DO dispatch ──────────────────────────────────────────────────────

export function stub(env: Env, sandboxId: string): DurableObjectStub {
  return env.SANDBOX.get(env.SANDBOX.idFromName(sandboxId))
}

export async function doFetch(
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

export async function sandboxExists(env: Env, id: string): Promise<boolean> {
  return (await env.SANDBOX_REGISTRY.get(`${SANDBOX_KEY_PREFIX}${id}`)) !== null
}

// ── KV helper — stores rich metadata for gallery listing ──────────────────────

export async function registerSandbox(
  env: Env,
  meta: SandboxMeta,
): Promise<void> {
  await env.SANDBOX_REGISTRY.put(
    `${SANDBOX_KEY_PREFIX}${meta.id}`,
    meta.id,   // value is the id — existence check remains simple
    { expirationTtl: SANDBOX_TTL, metadata: meta },
  )
}

// ── Handlers ──────────────────────────────────────────────────────────────────

const list: Handler = async (_req, env) => {
  const result = await env.SANDBOX_REGISTRY.list<SandboxMeta>({ prefix: SANDBOX_KEY_PREFIX })
  const apps = result.keys
    .filter(k => k.metadata != null)
    .map(k => k.metadata as SandboxMeta)
    .sort((a, b) => b.createdAt - a.createdAt)
  return json(ok({ apps, total: apps.length, complete: result.list_complete }))
}

const create: Handler = async (req, env) => {
  let body: unknown
  try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
  let parsed
  try { parsed = parseCreateSandboxRequest(body) } catch (e) { return json(err(String(e)), 422) }

  const id = newId()
  const ts = now()

  const config: SandboxConfig = { ...parsed, id, memory: [], createdAt: ts, updatedAt: ts }

  await doFetch(stub(env, id), 'init', 'POST', config)

  await registerSandbox(env, {
    id,
    name:        config.name,
    description: config.description,
    model:       config.model,
    createdAt:   ts,
  })

  await env.DB.prepare(
    'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)',
  ).bind(id, 'created', JSON.stringify({ name: config.name }), ts).run()

  return json(ok({
    id,
    name:      config.name,
    appUrl:    `/app/${id}`,
    shortLink: `/s/${id}`,
    api:       { run: `/s/${id}/run`, stream: `/s/${id}/stream` },
  }), 201)
}

const getConfig: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
  return doFetch(stub(env, id), 'config', 'GET')
}

const patchConfig: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
  let body: unknown
  try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
  return doFetch(stub(env, id), 'config', 'PATCH', body)
}

export const runHandler: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
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

export const streamHandler: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
  let body: unknown
  try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
  let parsed
  try { parsed = parseRunSandboxRequest(body) } catch (e) { return json(err(String(e)), 422) }

  const doRes = await doFetch(stub(env, id), 'stream', 'POST', { message: parsed.message })
  return sseResponse(doRes.body as ReadableStream)
}

const history: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
  return doFetch(stub(env, id), 'history', 'GET')
}

const del: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
  await doFetch(stub(env, id), '/', 'DELETE')
  await env.SANDBOX_REGISTRY.delete(`${SANDBOX_KEY_PREFIX}${id}`)
  await env.DB.prepare(
    'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)',
  ).bind(id, 'deleted', '{}', now()).run()
  return json(ok({ deleted: true }))
}

export const sandboxRoutes: Array<[string, string, Handler]> = [
  ['GET',    '/api/sandbox',              list],
  ['POST',   '/api/sandbox',              create],
  ['GET',    '/api/sandbox/:id',          getConfig],
  ['PATCH',  '/api/sandbox/:id',          patchConfig],
  ['POST',   '/api/sandbox/:id/run',      runHandler],
  ['POST',   '/api/sandbox/:id/stream',   streamHandler],
  ['GET',    '/api/sandbox/:id/history',  history],
  ['DELETE', '/api/sandbox/:id',          del],
]
