import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err } from '../lib/http'

const IMAGE_MAX_BYTES    = 5 * 1024 * 1024  // 5 MB
const IMAGE_TYPES        = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const EMAIL_RATE_MAX     = 5
const EMAIL_RATE_WINDOW  = 60_000  // ms

// ── AppStateDO helpers ────────────────────────────────────────────────────────

function appStateStub(env: Env, buildId: string): DurableObjectStub {
  return env.APP_STATE.get(env.APP_STATE.idFromName(buildId))
}

function doState(stub: DurableObjectStub, path: string, method = 'GET', body?: unknown): Promise<Response> {
  return stub.fetch(new Request(`http://do${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  }))
}

// ── App State (E1) ────────────────────────────────────────────────────────────

export const listAppStateHandler: Handler = (_req, env, params) =>
  doState(appStateStub(env, params.id ?? ''), '/kv')

export const getAppStateHandler: Handler = (_req, env, params) =>
  doState(appStateStub(env, params.id ?? ''), `/kv/${encodeURIComponent(params.key ?? '')}`)

export const putAppStateHandler: Handler = async (req, env, params) => {
  let body: unknown
  try { body = await req.json() } catch { return json(err('Invalid JSON body'), 400) }
  return doState(appStateStub(env, params.id ?? ''), `/kv/${encodeURIComponent(params.key ?? '')}`, 'PUT', body)
}

export const deleteAppStateKeyHandler: Handler = (_req, env, params) =>
  doState(appStateStub(env, params.id ?? ''), `/kv/${encodeURIComponent(params.key ?? '')}`, 'DELETE')

export const clearAppStateHandler: Handler = (_req, env, params) =>
  doState(appStateStub(env, params.id ?? ''), '/', 'DELETE')

// ── App Images (E4) ───────────────────────────────────────────────────────────

export const uploadImageHandler: Handler = async (req, env, params) => {
  const id = params.id ?? ''
  let form: FormData
  try { form = await req.formData() } catch { return json(err('Expected multipart/form-data'), 400) }

  const file = form.get('file') as File | null
  if (!file) return json(err('Missing file field'), 422)
  if (!IMAGE_TYPES.has(file.type)) return json(err('Unsupported image type — use png, jpeg, gif, or webp'), 422)
  if (file.size > IMAGE_MAX_BYTES)  return json(err('Image exceeds 5 MB limit'), 422)

  const imageId = crypto.randomUUID()
  const buf     = await file.arrayBuffer()
  await env.FILES.put(`apps/${id}/images/${imageId}`, buf, {
    httpMetadata:   { contentType: file.type },
    customMetadata: { name: file.name, size: String(file.size), contentType: file.type, uploadedAt: String(Date.now()) },
  })
  return json(ok({ imageId, url: `/api/app/${id}/images/${imageId}` }))
}

export const listImagesHandler: Handler = async (_req, env, params) => {
  const id   = params.id ?? ''
  const list = await env.FILES.list({ prefix: `apps/${id}/images/` })
  const images = list.objects.map(o => ({
    imageId:     o.key.split('/').pop() ?? '',
    name:        o.customMetadata?.name        ?? '',
    size:        Number(o.customMetadata?.size ?? 0),
    contentType: o.customMetadata?.contentType ?? 'application/octet-stream',
    uploadedAt:  Number(o.customMetadata?.uploadedAt ?? 0),
    url:         `/api/app/${id}/images/${o.key.split('/').pop() ?? ''}`,
  }))
  return json(ok({ images, total: images.length }))
}

export const serveImageHandler: Handler = async (_req, env, params) => {
  const id      = params.id      ?? ''
  const imageId = params.imageId ?? ''
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

export const deleteImageHandler: Handler = async (_req, env, params) => {
  const id      = params.id      ?? ''
  const imageId = params.imageId ?? ''
  await env.FILES.delete(`apps/${id}/images/${imageId}`)
  return json(ok({ deleted: true }))
}

// ── App Email (E5) ────────────────────────────────────────────────────────────

async function checkEmailRateLimit(buildId: string, env: Env): Promise<Response | null> {
  const key    = `rl:email:${buildId}`
  const now    = Date.now()
  const stored = await env.SANDBOX_REGISTRY.get(key, 'json') as number[] | null
  const window = (stored ?? []).filter(t => t > now - EMAIL_RATE_WINDOW)
  if (window.length >= EMAIL_RATE_MAX)
    return json(err('Email rate limit exceeded — max 5 per minute per app.'), 429)
  window.push(now)
  void env.SANDBOX_REGISTRY.put(key, JSON.stringify(window), { expirationTtl: Math.ceil(EMAIL_RATE_WINDOW / 1000) })
  return null
}

export const sendEmailHandler: Handler = async (req, env, params) => {
  if (!env.SEND_EMAIL) return json(err('Email sending is not configured on this server.'), 503)

  const id = params.id ?? ''
  const rl = await checkEmailRateLimit(id, env)
  if (rl) return rl

  let body: { to?: unknown; subject?: unknown; text?: unknown; html?: unknown }
  try { body = await req.json() as typeof body } catch { return json(err('Invalid JSON body'), 400) }

  const { to, subject, text, html } = body
  if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
    return json(err('Invalid or missing to email address'), 422)
  if (typeof subject !== 'string' || subject.length === 0 || subject.length > 256)
    return json(err('subject must be a non-empty string ≤ 256 characters'), 422)
  if (typeof text !== 'string' || text.length === 0 || text.length > 16384)
    return json(err('text must be a non-empty string ≤ 16 KB'), 422)
  if (html !== undefined && typeof html !== 'string')
    return json(err('html must be a string if provided'), 422)

  try {
    await env.SEND_EMAIL.send({
      from:    'noreply@aether-lite.app',
      to:      to.trim().toLowerCase(),
      subject: subject.slice(0, 256),
      text,
      ...(typeof html === 'string' ? { html } : {}),
    })
    return json(ok({ sent: true }))
  } catch (e) {
    return json(err('Failed to send email: ' + String(e)), 502)
  }
}

// ── Route table ───────────────────────────────────────────────────────────────

export const appstateRoutes: Array<[string, string, Handler]> = [
  // State (E1)
  ['GET',    '/api/app/:id/state',           listAppStateHandler],
  ['GET',    '/api/app/:id/state/:key',      getAppStateHandler],
  ['PUT',    '/api/app/:id/state/:key',      putAppStateHandler],
  ['DELETE', '/api/app/:id/state/:key',      deleteAppStateKeyHandler],
  ['DELETE', '/api/app/:id/state',           clearAppStateHandler],
  // Images (E4)
  ['POST',   '/api/app/:id/images',          uploadImageHandler],
  ['GET',    '/api/app/:id/images',          listImagesHandler],
  ['GET',    '/api/app/:id/images/:imageId', serveImageHandler],
  ['DELETE', '/api/app/:id/images/:imageId', deleteImageHandler],
  // Email (E5)
  ['POST',   '/api/app/:id/email',           sendEmailHandler],
]
