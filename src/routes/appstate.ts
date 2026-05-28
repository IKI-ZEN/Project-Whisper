import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, parseBody, checkRateLimit } from '../lib/http'
import { parseAppStateValueRequest, parseEmailRequest } from '../lib/schema'
import { doFetch } from './sandbox'
import { newId, isUUID } from '../lib/utils'
import {
  IMAGE_MAX_BYTES, ALLOWED_IMAGE_TYPES,
  IMAGE_RATE_LIMIT_WINDOW_MS, IMAGE_RATE_LIMIT_MAX,
  EMAIL_RATE_LIMIT_WINDOW_MS, EMAIL_RATE_LIMIT_MAX,
} from '../lib/constants'

// ── AppStateDO helpers ────────────────────────────────────────────────────────

function appStateStub(env: Env, buildId: string): DurableObjectStub {
  return env.APP_STATE.get(env.APP_STATE.idFromName(buildId))
}

// ── App State (E1) ────────────────────────────────────────────────────────────

export const listAppStateHandler: Handler = (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return Promise.resolve(json(err('Invalid app id'), 422))
  return doFetch(appStateStub(env, id), 'kv', 'GET')
}

export const getAppStateHandler: Handler = (_req, env, params) => {
  const id  = params.id  ?? ''
  const key = params.key ?? ''
  if (!isUUID(id)) return Promise.resolve(json(err('Invalid app id'), 422))
  return doFetch(appStateStub(env, id), `kv/${encodeURIComponent(key)}`, 'GET')
}

export const putAppStateHandler: Handler = async (req, env, params) => {
  const id  = params.id  ?? ''
  const key = params.key ?? ''
  if (!isUUID(id)) return json(err('Invalid app id'), 422)
  const parsed = await parseBody(req, (b) => parseAppStateValueRequest(b, key))
  if (!parsed.ok) return parsed.response
  return doFetch(appStateStub(env, id), `kv/${encodeURIComponent(key)}`, 'PUT', { value: parsed.data.value })
}

export const deleteAppStateKeyHandler: Handler = (_req, env, params) => {
  const id  = params.id  ?? ''
  const key = params.key ?? ''
  if (!isUUID(id)) return Promise.resolve(json(err('Invalid app id'), 422))
  return doFetch(appStateStub(env, id), `kv/${encodeURIComponent(key)}`, 'DELETE')
}

export const clearAppStateHandler: Handler = (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return Promise.resolve(json(err('Invalid app id'), 422))
  return doFetch(appStateStub(env, id), '/', 'DELETE')
}

// ── App Images (E4) ───────────────────────────────────────────────────────────

export const uploadImageHandler: Handler = async (req, env, params) => {
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
    customMetadata: { name: file.name, size: String(file.size), contentType: file.type, uploadedAt: String(Date.now()) },
  })
  return json(ok({ imageId, url: `/api/app/${id}/images/${imageId}` }))
}

export const listImagesHandler: Handler = async (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid app id'), 422)

  const prefix = `apps/${id}/images/`
  let r2 = await env.FILES.list({ prefix })
  const objects = [...r2.objects]
  while (r2.truncated) {
    r2 = await env.FILES.list({ prefix, cursor: r2.cursor })
    objects.push(...r2.objects)
  }
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

export const serveImageHandler: Handler = async (_req, env, params) => {
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

export const deleteImageHandler: Handler = async (_req, env, params) => {
  const id      = params.id      ?? ''
  const imageId = params.imageId ?? ''
  if (!isUUID(id) || !isUUID(imageId)) return json(err('Invalid id'), 422)

  await env.FILES.delete(`apps/${id}/images/${imageId}`)
  return json(ok({ deleted: true }))
}

// ── App Email (E5) ────────────────────────────────────────────────────────────

export const sendEmailHandler: Handler = async (req, env, params) => {
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

  if (!env.EMAIL_FROM_ADDRESS) {
    return json(err('EMAIL_FROM_ADDRESS is not configured'), 503)
  }

  try {
    await env.SEND_EMAIL.send({
      from:    env.EMAIL_FROM_ADDRESS,
      to,
      subject: subject.slice(0, 256),
      text,
      ...(html !== undefined ? { html } : {}),
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
