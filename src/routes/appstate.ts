import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, parseBody, checkRateLimit, listAllR2, listAllKV } from '../lib/http'
import { parseAppStateValueRequest, parseEmailRequest } from '../lib/schema'
import type { SandboxMeta } from '../lib/do'
import { doFetch, appStateStub } from '../lib/do'
import { scan } from '../lib/guard'
import { logSandboxEvent } from '../lib/events'
import { newId, isUUID, now } from '../lib/utils'
import {
  IMAGE_MAX_BYTES, ALLOWED_IMAGE_TYPES,
  IMAGE_RATE_LIMIT_WINDOW_MS, IMAGE_RATE_LIMIT_MAX,
  EMAIL_RATE_LIMIT_WINDOW_MS, EMAIL_RATE_LIMIT_MAX,
  MAX_EMAIL_SCAN_CHARS, MAX_EMAIL_SUBJECT_LEN,
  PLATFORM_READ_MAX_EVENTS,
  SANDBOX_KEY_PREFIX, BUILD_KEY_PREFIX,
} from '../lib/constants'

// ── App State (E1) ────────────────────────────────────────────────────────────

const listState: Handler = (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return Promise.resolve(json(err('Invalid app id'), 422))
  return doFetch(appStateStub(env, id), 'kv', 'GET')
}

const getState: Handler = (_req, env, params) => {
  const id  = params.id  ?? ''
  const key = params.key ?? ''
  if (!isUUID(id)) return Promise.resolve(json(err('Invalid app id'), 422))
  return doFetch(appStateStub(env, id), `kv/${encodeURIComponent(key)}`, 'GET')
}

const putState: Handler = async (req, env, params) => {
  const id  = params.id  ?? ''
  const key = params.key ?? ''
  if (!isUUID(id)) return json(err('Invalid app id'), 422)
  const parsed = await parseBody(req, (b) => parseAppStateValueRequest(b, key))
  if (!parsed.ok) return parsed.response
  return doFetch(appStateStub(env, id), `kv/${encodeURIComponent(key)}`, 'PUT', { value: parsed.data.value })
}

const deleteKey: Handler = (_req, env, params) => {
  const id  = params.id  ?? ''
  const key = params.key ?? ''
  if (!isUUID(id)) return Promise.resolve(json(err('Invalid app id'), 422))
  return doFetch(appStateStub(env, id), `kv/${encodeURIComponent(key)}`, 'DELETE')
}

const clear: Handler = (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return Promise.resolve(json(err('Invalid app id'), 422))
  return doFetch(appStateStub(env, id), '/', 'DELETE')
}

// ── App Images (E4) ───────────────────────────────────────────────────────────

const uploadImage: Handler = async (req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid app id'), 422)

  let form: FormData
  try { form = await req.formData() } catch { return json(err('Expected multipart/form-data'), 400) }

  const rl = await checkRateLimit(`rl:image:${id}`, IMAGE_RATE_LIMIT_MAX, IMAGE_RATE_LIMIT_WINDOW_MS, env, 'Image upload rate limit exceeded — max 20 per minute per app.')
  if (rl) return rl

  const file = form.get('file') as File | null
  if (!file) return json(err('Missing file field'), 422)
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type))
    return json(err('Unsupported image type — use png, jpeg, gif, or webp'), 422)
  if (file.size > IMAGE_MAX_BYTES)
    return json(err('Image exceeds 5 MB limit'), 422)

  const imageId = newId()
  const buf     = await file.arrayBuffer()
  await env.FILES.put(`apps/${id}/images/${imageId}`, buf, {
    httpMetadata:   { contentType: file.type },
    customMetadata: { name: file.name, size: String(file.size), contentType: file.type, uploadedAt: String(now()) },
  })
  return json(ok({ imageId, url: `/api/app/${id}/images/${imageId}` }))
}

const listImages: Handler = async (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid app id'), 422)

  const objects = await listAllR2(env.FILES, `apps/${id}/images/`)
  const images = objects.map(o => ({
    imageId:     o.key.split('/').pop() ?? '',
    name:        o.customMetadata?.name        ?? '',
    size:        Number(o.customMetadata?.size ?? 0),
    contentType: o.customMetadata?.contentType ?? 'application/octet-stream',
    uploadedAt:  Number(o.customMetadata?.uploadedAt ?? 0),
    url:         `/api/app/${id}/images/${o.key.split('/').pop() ?? ''}`,
  }))
  return json(ok({ images, total: images.length }))
}

const serveImage: Handler = async (_req, env, params) => {
  const id      = params.id      ?? ''
  const imageId = params.imageId ?? ''
  if (!isUUID(id) || !isUUID(imageId)) return json(err('Invalid id'), 422)

  const obj = await env.FILES.get(`apps/${id}/images/${imageId}`)
  if (!obj) return json(err('Image not found'), 404)
  const ct = obj.customMetadata?.contentType ?? 'application/octet-stream'
  return new Response(obj.body, {
    headers: {
      'Content-Type':           ct,
      'Cache-Control':          'public, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

const deleteImage: Handler = async (_req, env, params) => {
  const id      = params.id      ?? ''
  const imageId = params.imageId ?? ''
  if (!isUUID(id) || !isUUID(imageId)) return json(err('Invalid id'), 422)

  await env.FILES.delete(`apps/${id}/images/${imageId}`)
  return json(ok({ deleted: true }))
}

// ── App Email (E5) ────────────────────────────────────────────────────────────

const sendEmail: Handler = async (req, env, params) => {
  if (!env.SEND_EMAIL) return json(err('Email sending is not configured on this server.'), 503)

  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid app id'), 422)

  const rl = await checkRateLimit(
    `rl:email:${id}`,
    EMAIL_RATE_LIMIT_MAX,
    EMAIL_RATE_LIMIT_WINDOW_MS,
    env,
    'Email rate limit exceeded — max 5 per minute per app.',
  )
  if (rl) return rl

  const parsed = await parseBody(req, parseEmailRequest)
  if (!parsed.ok) return parsed.response
  const { to, subject, text, html } = parsed.data

  // Content scan — email is an abuse vector (phishing / leaked secrets), so this
  // always runs (it is not a research path). Blocked content is rejected;
  // suspicious content is sent but flagged for the audit trail.
  const emailBody = `${subject}\n${text}\n${html ?? ''}`.slice(0, MAX_EMAIL_SCAN_CHARS)
  const emailScan = scan(emailBody)
  if (emailScan.riskLevel === 'blocked') {
    void logSandboxEvent(env, { sandboxId: id, type: 'email_blocked', metadata: { patterns: emailScan.patterns } })
    return json(err('Email blocked: flagged content detected', emailScan.patterns), 422)
  }
  if (emailScan.riskLevel === 'suspicious') {
    void logSandboxEvent(env, { sandboxId: id, type: 'email_flagged', metadata: { patterns: emailScan.patterns } })
  }

  if (!env.EMAIL_FROM_ADDRESS) {
    return json(err('EMAIL_FROM_ADDRESS is not configured'), 503)
  }

  try {
    await env.SEND_EMAIL.send({
      from:    env.EMAIL_FROM_ADDRESS,
      to,
      subject: subject.slice(0, MAX_EMAIL_SUBJECT_LEN),
      text,
      ...(html !== undefined ? { html } : {}),
    })
    return json(ok({ sent: true }))
  } catch (e) {
    return json(err('Failed to send email: ' + String(e)), 502)
  }
}

// ── Platform read proxy (P1) ──────────────────────────────────────────────────
// Read-only endpoints accessible via app token. They surface platform-wide data
// so generated dashboard apps can render live operational information.

interface BuildMeta { id: string; name: string; status: string; files?: string[]; createdAt: number; description?: string }

async function platformListSandboxes(env: Env, only: 'apps' | 'envs'): Promise<SandboxMeta[]> {
  const keys = await listAllKV<SandboxMeta>(env.SANDBOX_REGISTRY, SANDBOX_KEY_PREFIX)
  return keys
    .filter(k => k.metadata != null)
    .map(k => k.metadata as SandboxMeta)
    .filter(m => only === 'apps' ? (!m.fromEnv && !m.fromDashboard) : m.fromEnv === true)
    .sort((a, b) => b.createdAt - a.createdAt)
}

const platformSandboxes: Handler = async (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid app id'), 422)
  const apps = await platformListSandboxes(env, 'apps')
  return json(ok({ apps }))
}

const platformEnvironments: Handler = async (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid app id'), 422)
  const apps = await platformListSandboxes(env, 'envs')
  return json(ok({ apps }))
}

const platformBuilds: Handler = async (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid app id'), 422)
  const keys = await listAllKV<BuildMeta>(env.SANDBOX_REGISTRY, BUILD_KEY_PREFIX)
  const builds = keys
    .filter(k => k.metadata != null)
    .map(k => k.metadata as BuildMeta)
    .sort((a, b) => b.createdAt - a.createdAt)
  return json(ok({ builds }))
}

const platformMetrics: Handler = async (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid app id'), 422)
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) as totalRuns,
              SUM(tokens_in) as totalTokensIn,
              SUM(tokens_out) as totalTokensOut,
              AVG(latency_ms) as avgLatencyMs,
              SUM(cost_usd) as totalCostUsd
         FROM usage_metrics`,
    ).first<{ totalRuns: number; totalTokensIn: number; totalTokensOut: number; avgLatencyMs: number; totalCostUsd: number }>()
    const breakdown = await env.DB.prepare(
      `SELECT model,
              COUNT(*) as runs,
              SUM(tokens_in) as tokensIn,
              SUM(tokens_out) as tokensOut,
              SUM(cost_usd) as costUsd
         FROM usage_metrics
        GROUP BY model
        ORDER BY runs DESC
        LIMIT 20`,
    ).all<{ model: string; runs: number; tokensIn: number; tokensOut: number; costUsd: number }>()
    return json(ok({
      totalRuns:      row?.totalRuns      ?? 0,
      totalTokensIn:  row?.totalTokensIn  ?? 0,
      totalTokensOut: row?.totalTokensOut ?? 0,
      avgLatencyMs:   row?.avgLatencyMs   ?? 0,
      totalCostUsd:   row?.totalCostUsd   ?? 0,
      modelBreakdown: breakdown.results ?? [],
    }))
  } catch (e) {
    return json(err('Metrics unavailable', String(e)), 500)
  }
}

const platformEvents: Handler = async (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid app id'), 422)
  try {
    const result = await env.DB.prepare(
      `SELECT sandbox_id, event_type, metadata, created_at
         FROM sandbox_events
        ORDER BY created_at DESC
        LIMIT ?`,
    ).bind(PLATFORM_READ_MAX_EVENTS).all<{ sandbox_id: string; event_type: string; metadata: string; created_at: number }>()
    const events = (result.results ?? []).map(r => ({
      ...r,
      metadata: (() => { try { return JSON.parse(r.metadata) } catch { return {} } })(),
    }))
    return json(ok({ events }))
  } catch (e) {
    return json(err('Events unavailable', String(e)), 500)
  }
}

const platformUsage: Handler = async (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid app id'), 422)
  const from30d = now() - 30 * 86_400_000
  try {
    const result = await env.DB.prepare(
      `SELECT model,
              COUNT(*) as totalCalls,
              SUM(tokens_in) as totalTokensIn,
              SUM(tokens_out) as totalTokensOut,
              SUM(cost_usd) as totalCostUsd
         FROM usage_metrics
        WHERE created_at >= ?
        GROUP BY model
        ORDER BY totalCalls DESC`,
    ).bind(from30d).all<{ model: string; totalCalls: number; totalTokensIn: number; totalTokensOut: number; totalCostUsd: number }>()
    return json(ok({ rows: result.results ?? [] }))
  } catch (e) {
    return json(err('Usage data unavailable', String(e)), 500)
  }
}

const platformProbes: Handler = async (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid app id'), 422)
  try {
    const result = await env.DB.prepare(
      `SELECT p.id, p.name, p.schedule, p.last_run_at,
              (SELECT COUNT(*) FROM probe_runs WHERE probe_id = p.id) as run_count
         FROM probes p
        ORDER BY p.created_at DESC`,
    ).all<{ id: string; name: string; schedule: string; last_run_at: number | null; run_count: number }>()
    return json(ok({ probes: result.results ?? [] }))
  } catch (e) {
    return json(err('Probes unavailable', String(e)), 500)
  }
}

// ── Route table ───────────────────────────────────────────────────────────────

export const appstateRoutes: Array<[string, string, Handler]> = [
  // State (E1)
  ['GET',    '/api/app/:id/state',           listState],
  ['GET',    '/api/app/:id/state/:key',      getState],
  ['PUT',    '/api/app/:id/state/:key',      putState],
  ['DELETE', '/api/app/:id/state/:key',      deleteKey],
  ['DELETE', '/api/app/:id/state',           clear],
  // Images (E4)
  ['POST',   '/api/app/:id/images',          uploadImage],
  ['GET',    '/api/app/:id/images',          listImages],
  ['GET',    '/api/app/:id/images/:imageId', serveImage],
  ['DELETE', '/api/app/:id/images/:imageId', deleteImage],
  // Email (E5)
  ['POST',   '/api/app/:id/email',           sendEmail],
  // Platform read proxy (P1) — accessible via app token from generated dashboards
  ['GET',    '/api/app/:id/platform/sandboxes',    platformSandboxes],
  ['GET',    '/api/app/:id/platform/environments', platformEnvironments],
  ['GET',    '/api/app/:id/platform/builds',       platformBuilds],
  ['GET',    '/api/app/:id/platform/metrics',      platformMetrics],
  ['GET',    '/api/app/:id/platform/events',       platformEvents],
  ['GET',    '/api/app/:id/platform/usage',        platformUsage],
  ['GET',    '/api/app/:id/platform/probes',       platformProbes],
]
