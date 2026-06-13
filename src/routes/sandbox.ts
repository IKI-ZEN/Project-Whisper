import type { Env } from '../types/env'
import type { Handler, Params } from '../lib/http'
import { json, ok, err, readJson, sseResponse, parseBody, parseBodyOptional, listAllKV, rateLimitByIp, readIdentity } from '../lib/http'
import { parseCreateSandboxRequest, parseRunSandboxRequest, parseSessionBody, parsePatchSandboxRequest, type SandboxConfig } from '../lib/schema'
import { newId, now, isUUID } from '../lib/utils'
import { SANDBOX_KEY_PREFIX, SANDBOX_TTL, SANDBOX_CREATE_RATE_LIMIT_MAX, SANDBOX_CREATE_RATE_LIMIT_WINDOW, SECURITY_REPORT_WINDOW_MS, SESSION_TOKEN_TTL_MS } from '../lib/constants'
import { signPayload, verifySignature } from '../lib/vault'
import { requireAccess } from '../lib/access'
import { extractAppToken, verifyAppToken } from '../lib/appToken'
import { saveToVault } from '../lib/toolRun'
import { logSandboxEvent } from '../lib/events'
import { scan } from '../lib/guard'
import { stub, doFetch, identityHeader, sandboxExists, registerSandbox, type SandboxMeta } from '../lib/do'

// Validate session token when SIGNING_SECRET is set and a token is supplied.
// Missing token is always allowed (backwards compatible — token is opt-in).
// The token is read from the X-Session-Token header (never the URL query string,
// which would leak into browser history and access logs — CWE-598).
// Format: "{expiresAt}.{hmac}" over "{sandboxId}:{sessionId}:{expiresAt}". The
// embedded expiry bounds the replay window of any leaked token (CWE-613). On a
// 401 the client reissues, so long-lived threads keep working transparently.
async function validateSessionToken(
  sandboxId: string,
  sessionId: string | undefined,
  req: Request,
  env: Env,
): Promise<Response | null> {
  if (!env.SIGNING_SECRET || !sessionId) return null
  const token = req.headers.get('X-Session-Token')
  if (!token) return null
  const dot = token.indexOf('.')
  if (dot < 0) return json(err('Invalid session token'), 401)
  const expiresAt = parseInt(token.slice(0, dot), 10)
  const sig       = token.slice(dot + 1)
  if (isNaN(expiresAt) || now() > expiresAt) return json(err('Session token expired'), 401)
  const valid = await verifySignature(`${sandboxId}:${sessionId}:${expiresAt}`, sig, env.SIGNING_SECRET)
  if (!valid) return json(err('Invalid session token'), 401)
  return null
}

// Fail-closed read gate for conversation data (GET /history and /export-session).
// Reading a conversation requires EITHER a valid session token — the capability
// the app client holds and auto-reissues — OR a valid Cloudflare Access identity
// (operators / dashboards). Without this, these GETs are unauthenticated in-worker
// and would expose the default thread to anyone who reaches the worker directly.
async function conversationReadGate(
  id: string, sessionId: string | undefined, req: Request, env: Env,
): Promise<Response | null> {
  const tokenDeny = await validateSessionToken(id, sessionId, req, env)
  if (tokenDeny) return tokenDeny
  if (env.SIGNING_SECRET && !req.headers.get('X-Session-Token')) {
    const { deny } = await requireAccess(req, env)
    if (deny) return deny
  }
  return null
}

// ── Handlers ──────────────────────────────────────────────────────────────────

const list: Handler = async (req, env) => {
  const url  = new URL(req.url)
  const only = url.searchParams.get('only')   // 'apps' | 'envs' | null (all)
  const keys = await listAllKV<SandboxMeta>(env.SANDBOX_REGISTRY, SANDBOX_KEY_PREFIX)
  const apps = keys
    .filter(k => k.metadata != null)
    .map(k => k.metadata as SandboxMeta)
    .filter(m => {
      if (only === 'apps') return !m.fromEnv
      if (only === 'envs') return m.fromEnv === true
      return true
    })
    .sort((a, b) => b.createdAt - a.createdAt)
  return json(ok({ apps, total: apps.length }))
}

const create: Handler = async (req, env) => {
  const rl = await rateLimitByIp(req, env, 'rl:sandbox-create', SANDBOX_CREATE_RATE_LIMIT_MAX, SANDBOX_CREATE_RATE_LIMIT_WINDOW)
  if (rl) return rl
  const p = await parseBody(req, parseCreateSandboxRequest)
  if (!p.ok) return p.response
  const parsed = p.data

  const id = newId()
  const ts = now()
  const identity = readIdentity(req)

  const config: SandboxConfig = { ...parsed, id, memory: [], createdAt: ts, updatedAt: ts }

  await doFetch(stub(env, id), 'init', 'POST', config, identityHeader(req))

  await registerSandbox(env, {
    id,
    name:        config.name,
    description: config.description,
    model:       config.model,
    createdAt:   ts,
  })

  await logSandboxEvent(env, { sandboxId: id, type: 'created', metadata: { name: config.name }, identity, at: ts })

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
  if (!isUUID(id)) return json(err('Invalid sandbox id'), 422)
  const entry = await env.SANDBOX_REGISTRY.getWithMetadata<SandboxMeta>(`${SANDBOX_KEY_PREFIX}${id}`)
  if (!entry.value) return json(err('Sandbox not found'), 404)
  // Refresh TTL on every read — sliding expiry keeps active sandboxes alive
  void env.SANDBOX_REGISTRY.put(`${SANDBOX_KEY_PREFIX}${id}`, id, {
    expirationTtl: SANDBOX_TTL,
    metadata: entry.metadata ?? undefined,
  })
  // Never expose the systemPrompt over this ungated GET — it is encrypted at rest
  // precisely because it is sensitive. Replace it with a presence flag; the signed
  // /export path (fail-closed) is the gated way to read the prompt itself.
  const res  = await doFetch(stub(env, id), 'config', 'GET')
  const body = await res.json() as { ok: boolean; data?: Record<string, unknown> }
  if (!body.ok || !body.data) return json(body, res.status)
  const { systemPrompt, ...rest } = body.data
  return json(ok({ ...rest, hasSystemPrompt: typeof systemPrompt === 'string' && systemPrompt.length > 0 }))
}

const fingerprint: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid sandbox id'), 422)
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
  const res = await doFetch(stub(env, id), 'config', 'GET')
  const body = await res.json() as { ok: boolean; data: { integrityHash?: string; tampered: boolean } }
  if (!body.ok) return json(err('Failed to load config'), 500)
  return json(ok({ integrityHash: body.data.integrityHash ?? null, tampered: body.data.tampered }))
}

// GET /api/sandbox/:id/security — read-only security posture report for a sandbox:
// integrity status, guard configuration, encryption-at-rest, and recent security
// event counts. Aggregates existing data only — no new storage.
const securityReport: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid sandbox id'), 422)
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)

  const res = await doFetch(stub(env, id), 'config', 'GET')
  const body = await res.json() as { ok: boolean; data?: {
    integrityHash?: string; tampered?: boolean
    guardMode?: string; guardOutput?: string; redactPiiOutput?: boolean
  } }
  if (!body.ok || !body.data) return json(err('Failed to load config'), 500)
  const cfg = body.data

  const since = now() - SECURITY_REPORT_WINDOW_MS
  const events: Record<string, number> = {}
  try {
    const rows = await env.DB.prepare(
      'SELECT event_type, COUNT(*) AS n FROM sandbox_events WHERE sandbox_id = ? AND created_at > ? GROUP BY event_type',
    ).bind(id, since).all<{ event_type: string; n: number }>()
    for (const r of rows.results ?? []) events[r.event_type] = r.n
  } catch { /* audit aggregation is best-effort — never fail the report */ }

  return json(ok({
    integrity: {
      hashPresent: !!cfg.integrityHash,
      tampered:    cfg.tampered ?? false,
    },
    guard: {
      input:       cfg.guardMode ?? 'strict',
      output:      cfg.guardOutput ?? 'audit',
      redactPii:   cfg.redactPiiOutput ?? false,
    },
    encryptionAtRest: !!env.SIGNING_SECRET,
    events,
    windowMs: SECURITY_REPORT_WINDOW_MS,
  }))
}

const patchConfig: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid sandbox id'), 422)
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
  const parsed = await parseBody(req, parsePatchSandboxRequest)
  if (!parsed.ok) return parsed.response
  const patch = parsed.data

  // Auto-version: if systemPrompt is changing, save the old value to vault before patching
  if (patch.systemPrompt !== undefined) {
    const cfgRes = await doFetch(stub(env, id), 'config', 'GET')
    const cfgBody = await cfgRes.json() as { ok: boolean; data?: { systemPrompt?: string; model?: string } }
    if (cfgBody.ok && cfgBody.data?.systemPrompt && cfgBody.data.systemPrompt !== patch.systemPrompt) {
      void saveToVault(env, {
        prompt:    cfgBody.data.systemPrompt,
        response:  patch.systemPrompt,
        model:     cfgBody.data.model ?? '',
        tool:      'system-prompt-version',
        sandboxId: id,
        tags:      ['system-prompt-version'],
      })
    }
  }

  const res = await doFetch(stub(env, id), 'config', 'PATCH', patch, identityHeader(req))

  // Keep KV listing metadata in sync when display fields change
  if (res.ok) {
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
  if (!isUUID(id)) return json(err('Invalid sandbox id'), 422)
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

// If an app token is present, verify it is scoped to this sandbox (prevents cross-app misuse).
async function checkAppTokenScope(id: string, req: Request, env: Env): Promise<Response | null> {
  const rawToken = extractAppToken(req)
  if (!rawToken || !env.SIGNING_SECRET) return null
  const tokenAppId = await verifyAppToken(rawToken, env.SIGNING_SECRET)
  if (tokenAppId !== null && tokenAppId !== id) return json(err('App token not valid for this sandbox'), 403)
  return null
}

export const run: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid sandbox id'), 422)
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)

  const scopeDeny = await checkAppTokenScope(id, req, env)
  if (scopeDeny) return scopeDeny

  const p = await parseBody(req, parseRunSandboxRequest)
  if (!p.ok) return p.response

  const tokenDeny = await validateSessionToken(id, p.data.sessionId, req, env)
  if (tokenDeny) return tokenDeny

  const res = await doFetch(stub(env, id), 'run', 'POST', { message: p.data.message, sessionId: p.data.sessionId })

  void logSandboxEvent(env, { sandboxId: id, type: 'run', at: now() })

  return res
}

export const stream: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid sandbox id'), 422)
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)

  const scopeDeny = await checkAppTokenScope(id, req, env)
  if (scopeDeny) return scopeDeny

  const p = await parseBody(req, parseRunSandboxRequest)
  if (!p.ok) return p.response

  const tokenDeny = await validateSessionToken(id, p.data.sessionId, req, env)
  if (tokenDeny) return tokenDeny

  const doRes = await doFetch(stub(env, id), 'stream', 'POST', { message: p.data.message, sessionId: p.data.sessionId })
  return sseResponse(doRes.body as ReadableStream)
}

const history: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid sandbox id'), 422)
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
  const sessionId = new URL(req.url).searchParams.get('sessionId') ?? undefined

  const gate = await conversationReadGate(id, sessionId, req, env)
  if (gate) return gate

  const doUrl = sessionId ? `history?sessionId=${encodeURIComponent(sessionId)}` : 'history'
  return doFetch(stub(env, id), doUrl, 'GET')
}

const del: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid sandbox id'), 422)
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
  const identity = readIdentity(req)
  await doFetch(stub(env, id), '/', 'DELETE')
  await env.SANDBOX_REGISTRY.delete(`${SANDBOX_KEY_PREFIX}${id}`)
  await logSandboxEvent(env, { sandboxId: id, type: 'deleted', identity, at: now() })
  return json(ok({ deleted: true }))
}

const exportConfig: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid sandbox id'), 422)
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)
  // systemPrompt is encrypted at rest and must not be readable without authentication.
  const { deny } = await requireAccess(req, env)
  if (deny) return deny
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
  const rl = await rateLimitByIp(req, env, 'rl:sandbox-create', SANDBOX_CREATE_RATE_LIMIT_MAX, SANDBOX_CREATE_RATE_LIMIT_WINDOW)
  if (rl) return rl
  let raw: unknown
  try { raw = await readJson(req) } catch (e) { return json(err(String(e)), 400) }

  // Verify HMAC signature when SIGNING_SECRET is configured.
  // Canonical field order must match the export handler exactly — prevents
  // field-reordering attacks that produce a valid signature on different content.
  if (env.SIGNING_SECRET && typeof raw === 'object' && raw !== null) {
    const r = raw as Record<string, unknown>
    // Require signature when SIGNING_SECRET is configured — unsigned imports are rejected
    if (typeof r.signature !== 'string') return json(err('Import rejected: signature required'), 422)
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

  const p = await parseBody(new Request(req.url, { method: 'POST', body: JSON.stringify(raw), headers: { 'Content-Type': 'application/json' } }), parseCreateSandboxRequest)
  if (!p.ok) return p.response

  // Scan the system prompt for injections. HMAC confirms the payload wasn't
  // tampered in transit but doesn't screen content baked into the export.
  // A poisoned system prompt is persistent — it fires on every subsequent turn.
  const promptScan = scan(p.data.systemPrompt ?? '')
  const guardMode  = p.data.guardMode ?? 'strict'
  if (promptScan.riskLevel !== 'clean') {
    const identity = readIdentity(req)
    void logSandboxEvent(env, {
      sandboxId: 'import',
      type: 'import_flag',
      metadata: { patterns: promptScan.patterns, riskLevel: promptScan.riskLevel },
      identity,
    })
    if (promptScan.riskLevel === 'blocked' && guardMode === 'strict') {
      return json(err('Import rejected: system prompt flagged by input guard'), 422)
    }
  }

  const id = newId()
  const ts = now()
  const config: SandboxConfig = { ...p.data, id, memory: [], createdAt: ts, updatedAt: ts }

  const identity = readIdentity(req)
  await doFetch(stub(env, id), 'init', 'POST', config, identityHeader(req))
  await registerSandbox(env, {
    id,
    name:        config.name,
    description: config.description,
    model:       config.model,
    createdAt:   ts,
  })

  await logSandboxEvent(env, { sandboxId: id, type: 'imported', metadata: { name: config.name }, identity, at: ts })

  return json(ok({
    id,
    name:      config.name,
    appUrl:    `/app/${id}`,
    shortLink: `/s/${id}`,
    api:       { run: `/s/${id}/run`, stream: `/s/${id}/stream` },
  }), 201)
}

// ── Sandbox fork ──────────────────────────────────────────────────────────────

const fork: Handler = async (req, env, params: Params) => {
  const sourceId = params.id ?? ''
  if (!isUUID(sourceId)) return json(err('Invalid sandbox id'), 422)
  const rl = await rateLimitByIp(req, env, 'rl:sandbox-create', SANDBOX_CREATE_RATE_LIMIT_MAX, SANDBOX_CREATE_RATE_LIMIT_WINDOW)
  if (rl) return rl
  if (!await sandboxExists(env, sourceId)) return json(err('Sandbox not found'), 404)

  const cfgRes  = await doFetch(stub(env, sourceId), 'config', 'GET')
  const cfgBody = await cfgRes.json() as { ok: boolean; data?: SandboxConfig }
  if (!cfgBody.ok || !cfgBody.data) return json(err('Failed to load source config'), 500)

  const src = cfgBody.data
  const id  = newId()
  const ts  = now()
  const identity = readIdentity(req)

  const config: SandboxConfig = {
    ...src,
    id,
    name:      `${src.name} (copy)`,
    memory:    [],
    createdAt: ts,
    updatedAt: ts,
    integrityHash: undefined,
  }

  await doFetch(stub(env, id), 'init', 'POST', config, identityHeader(req))
  await registerSandbox(env, { id, name: config.name, description: config.description, model: config.model, createdAt: ts })
  await logSandboxEvent(env, { sandboxId: id, type: 'created', metadata: { name: config.name, forkedFrom: sourceId }, identity, at: ts })

  return json(ok({ id, name: config.name, appUrl: `/app/${id}`, shortLink: `/s/${id}`, api: { run: `/s/${id}/run`, stream: `/s/${id}/stream` } }), 201)
}

// ── Session token issuance (Signal B) ─────────────────────────────────────────

const issueSession: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid sandbox ID'), 400)
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)

  const p = await parseBodyOptional(req, parseSessionBody, { sessionId: undefined })
  if (!p.ok) return p.response
  const sessionId = p.data.sessionId ?? newId()

  // Token carries an embedded expiry so a leaked token cannot be replayed forever.
  const expiresAt = now() + SESSION_TOKEN_TTL_MS
  const sig   = env.SIGNING_SECRET ? await signPayload(`${id}:${sessionId}:${expiresAt}`, env.SIGNING_SECRET) : null
  const token = sig ? `${expiresAt}.${sig}` : null
  return json(ok({ sessionId, token }))
}

// ── Signed thread export (Signal D) ──────────────────────────────────────────

const exportSession: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid sandbox id'), 422)
  if (!await sandboxExists(env, id)) return json(err('Sandbox not found'), 404)

  const sessionId = new URL(req.url).searchParams.get('sessionId') ?? 'default'

  // Same fail-closed gate as GET /history — this returns the same conversation data.
  const gate = await conversationReadGate(id, sessionId, req, env)
  if (gate) return gate

  const doUrl = `history?sessionId=${encodeURIComponent(sessionId)}`
  const res = await doFetch(stub(env, id), doUrl, 'GET')
  const body = await res.json() as { ok: boolean; data: unknown[] }
  if (!body.ok) return json(err('Failed to load history'), 500)

  const messages     = body.data
  const exportPayload = { version: 1, sandboxId: id, sessionId, messages }
  const canonPayload = JSON.stringify(exportPayload)
  const signature    = env.SIGNING_SECRET ? await signPayload(canonPayload, env.SIGNING_SECRET) : undefined

  return json(ok({ ...exportPayload, signature }))
}

export const sandboxRoutes: Array<[string, string, Handler]> = [
  ['GET',    '/api/sandbox',                        list],
  ['POST',   '/api/sandbox',                        create],
  ['POST',   '/api/sandbox/import',                 importConfig],
  ['GET',    '/api/sandbox/:id',                    getConfig],
  ['GET',    '/api/sandbox/:id/export',             exportConfig],
  ['GET',    '/api/sandbox/:id/export-session',     exportSession],
  ['GET',    '/api/sandbox/:id/fingerprint',        fingerprint],
  ['GET',    '/api/sandbox/:id/security',           securityReport],
  ['GET',    '/api/sandbox/:id/metrics',            metrics],
  ['PATCH',  '/api/sandbox/:id',                    patchConfig],
  ['POST',   '/api/sandbox/:id/run',                run],
  ['POST',   '/api/sandbox/:id/stream',             stream],
  ['GET',    '/api/sandbox/:id/history',            history],
  ['DELETE', '/api/sandbox/:id',                    del],
  ['POST',   '/api/sandbox/:id/session',            issueSession],
  ['POST',   '/api/sandbox/:id/fork',               fork],
]
