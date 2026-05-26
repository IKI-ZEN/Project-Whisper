import type { Env } from '../types/env'
import type { Handler, Params } from '../lib/http'
import { json, ok, err, readJson, sseResponse, parseBody, listAllKV } from '../lib/http'
import { parseCreateSandboxRequest, parseRunSandboxRequest, type SandboxConfig } from '../lib/schema'
import { newId, now } from '../lib/utils'
import { SANDBOX_KEY_PREFIX, SANDBOX_TTL } from '../lib/constants'

// ── HMAC helpers ──────────────────────────────────────────────────────────────

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  )
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  const key = await importHmacKey(secret)
  const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  const expectedHex = [...new Uint8Array(expected)].map(b => b.toString(16).padStart(2, '0')).join('')
  return expectedHex === signature
}

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
  const keys = await listAllKV<SandboxMeta>(env.SANDBOX_REGISTRY, SANDBOX_KEY_PREFIX)
  const apps = keys
    .filter(k => k.metadata != null)
    .map(k => k.metadata as SandboxMeta)
    .sort((a, b) => b.createdAt - a.createdAt)
  return json(ok({ apps, total: apps.length }))
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
  const entry = await env.SANDBOX_REGISTRY.getWithMetadata<SandboxMeta>(`${SANDBOX_KEY_PREFIX}${id}`)
  if (!entry.value) return json(err('Sandbox not found'), 404)
  // Refresh TTL on every read — sliding expiry keeps active sandboxes alive
  void env.SANDBOX_REGISTRY.put(`${SANDBOX_KEY_PREFIX}${id}`, id, {
    expirationTtl: SANDBOX_TTL,
    metadata: entry.metadata ?? undefined,
  })
  return doFetch(stub(env, id), 'config', 'GET')
}

const fingerprint: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
  const res = await doFetch(stub(env, id), 'config', 'GET')
  const body = await res.json() as { ok: boolean; data: { integrityHash?: string; tampered: boolean } }
  if (!body.ok) return json(err('Failed to load config'), 500)
  return json(ok({ integrityHash: body.data.integrityHash ?? null, tampered: body.data.tampered }))
}

const patchConfig: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
  let body: unknown
  try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
  const res = await doFetch(stub(env, id), 'config', 'PATCH', body)

  // Keep KV listing metadata in sync when display fields change
  if (res.ok) {
    const patch = body as Partial<{ name: string; description: string; model: string }>
    if (patch.name !== undefined || patch.description !== undefined || patch.model !== undefined) {
      const existing = await env.SANDBOX_REGISTRY.getWithMetadata<SandboxMeta>(`${SANDBOX_KEY_PREFIX}${id}`)
      if (existing.metadata) {
        const meta: SandboxMeta = { ...existing.metadata }
        if (patch.name        !== undefined) meta.name        = patch.name
        if (patch.description !== undefined) meta.description = patch.description
        if (patch.model       !== undefined) meta.model       = patch.model
        void env.SANDBOX_REGISTRY.put(`${SANDBOX_KEY_PREFIX}${id}`, id, { expirationTtl: SANDBOX_TTL, metadata: meta })
      }
    }
  }

  return res
}

const metrics: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)

  const summary = await env.DB.prepare(
    'SELECT COUNT(*) as totalRuns, SUM(tokens_in) as totalTokensIn, SUM(tokens_out) as totalTokensOut, AVG(latency_ms) as avgLatencyMs FROM usage_metrics WHERE sandbox_id = ?',
  ).bind(id).first<{ totalRuns: number; totalTokensIn: number | null; totalTokensOut: number | null; avgLatencyMs: number | null }>()

  const breakdown = await env.DB.prepare(
    'SELECT model, COUNT(*) as runs, SUM(tokens_in) as tokensIn, SUM(tokens_out) as tokensOut FROM usage_metrics WHERE sandbox_id = ? GROUP BY model',
  ).bind(id).all<{ model: string; runs: number; tokensIn: number; tokensOut: number }>()

  return json(ok({
    totalRuns:      summary?.totalRuns      ?? 0,
    totalTokensIn:  summary?.totalTokensIn  ?? 0,
    totalTokensOut: summary?.totalTokensOut ?? 0,
    avgLatencyMs:   Math.round(summary?.avgLatencyMs ?? 0),
    modelBreakdown: breakdown.results,
  }))
}

export const runHandler: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
  let body: unknown
  try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
  let parsed
  try { parsed = parseRunSandboxRequest(body) } catch (e) { return json(err(String(e)), 422) }

  const res = await doFetch(stub(env, id), 'run', 'POST', { message: parsed.message, sessionId: parsed.sessionId })

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

  const doRes = await doFetch(stub(env, id), 'stream', 'POST', { message: parsed.message, sessionId: parsed.sessionId })
  return sseResponse(doRes.body as ReadableStream)
}

const history: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
  // Forward sessionId query param to DO
  const sessionId = new URL(req.url).searchParams.get('sessionId')
  const doUrl = sessionId ? `history?sessionId=${encodeURIComponent(sessionId)}` : 'history'
  return doFetch(stub(env, id), doUrl, 'GET')
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

const exportConfig: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
  const res = await doFetch(stub(env, id), 'config', 'GET')
  const body = await res.json() as { ok: boolean; data: Omit<SandboxConfig, 'memory'> }
  if (!body.ok) return json(err('Failed to load config'), 500)
  const { name, description, systemPrompt, tools, model, temperature, maxTokens } = body.data

  // Canonical field order — must match the import verification exactly
  const canonPayload = JSON.stringify({ version: 1, name, description, systemPrompt, tools, model, temperature, maxTokens })
  const signature = env.SIGNING_SECRET ? await signPayload(canonPayload, env.SIGNING_SECRET) : undefined

  return json(ok({ version: 1 as const, name, description, systemPrompt, tools, model, temperature, maxTokens, signature }))
}

const importConfig: Handler = async (req, env) => {
  let raw: unknown
  try { raw = await readJson(req) } catch (e) { return json(err(String(e)), 400) }

  // Verify HMAC signature when SIGNING_SECRET is configured.
  // Canonical field order must match the export handler exactly — prevents
  // field-reordering attacks that produce a valid signature on different content.
  if (env.SIGNING_SECRET && typeof raw === 'object' && raw !== null) {
    const r = raw as Record<string, unknown>
    if (typeof r.signature === 'string') {
      const canonPayload = JSON.stringify({
        version:      r.version,
        name:         r.name,
        description:  r.description,
        systemPrompt: r.systemPrompt,
        tools:        r.tools,
        model:        r.model,
        temperature:  r.temperature,
        maxTokens:    r.maxTokens,
      })
      const valid = await verifySignature(canonPayload, r.signature, env.SIGNING_SECRET)
      if (!valid) return json(err('Import rejected: invalid export signature'), 422)
    }
  }

  const p = await parseBody(new Request(req.url, { method: 'POST', body: JSON.stringify(raw), headers: { 'Content-Type': 'application/json' } }), parseCreateSandboxRequest)
  if (!p.ok) return p.response

  const id = newId()
  const ts = now()
  const config: SandboxConfig = { ...p.data, id, memory: [], createdAt: ts, updatedAt: ts }

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
  ).bind(id, 'imported', JSON.stringify({ name: config.name }), ts).run()

  return json(ok({
    id,
    name:      config.name,
    appUrl:    `/app/${id}`,
    shortLink: `/s/${id}`,
    api:       { run: `/s/${id}/run`, stream: `/s/${id}/stream` },
  }), 201)
}

export const sandboxRoutes: Array<[string, string, Handler]> = [
  ['GET',    '/api/sandbox',                    list],
  ['POST',   '/api/sandbox',                    create],
  ['POST',   '/api/sandbox/import',             importConfig],
  ['GET',    '/api/sandbox/:id',                getConfig],
  ['GET',    '/api/sandbox/:id/export',         exportConfig],
  ['GET',    '/api/sandbox/:id/fingerprint',    fingerprint],
  ['GET',    '/api/sandbox/:id/metrics',        metrics],
  ['PATCH',  '/api/sandbox/:id',                patchConfig],
  ['POST',   '/api/sandbox/:id/run',            runHandler],
  ['POST',   '/api/sandbox/:id/stream',         streamHandler],
  ['GET',    '/api/sandbox/:id/history',        history],
  ['DELETE', '/api/sandbox/:id',                del],
]
