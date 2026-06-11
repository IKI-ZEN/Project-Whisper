import { MAX_REQUEST_BODY, AI_RATE_LIMIT_WINDOW_MS, AI_RATE_LIMIT_MAX } from './constants'
import { requireAccess, isProtectedRequest } from './access'
import { extractAppToken, verifyAppToken, isAppScopedPath } from './appToken'
import { newId, now } from './utils'

// ── Standard response envelope ────────────────────────────────────────────────

export interface Ok<T> { ok: true; data: T }
export interface Err   { ok: false; error: string; detail?: unknown }
export type ApiResponse<T> = Ok<T> | Err

export function ok<T>(data: T): Ok<T> { return { ok: true, data } }
export function err(error: string, detail?: unknown): Err { return { ok: false, error, detail } }

// ── JSON helpers ──────────────────────────────────────────────────────────────

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function readJson(req: Request): Promise<unknown> {
  const ct = req.headers.get('Content-Type') ?? ''
  if (!ct.includes('application/json')) throw new Error('Content-Type must be application/json')
  const buf = await req.arrayBuffer()
  if (buf.byteLength > MAX_REQUEST_BODY) throw new Error('Request body too large (max 1 MB)')
  return JSON.parse(new TextDecoder().decode(buf))
}

// ── Server-Sent Events ────────────────────────────────────────────────────────

export function sseEvent(data: unknown, event?: string): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  return event
    ? `event: ${event}\ndata: ${payload}\n\n`
    : `data: ${payload}\n\n`
}

export function sseResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

// ── Body parsing helper ───────────────────────────────────────────────────────

export async function parseBody<T>(
  req: Request,
  parse: (body: unknown) => T,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown
  try { raw = await readJson(req) } catch (e) { return { ok: false, response: json(err(String(e)), 400) } }
  try { return { ok: true, data: parse(raw) } } catch (e) { return { ok: false, response: json(err(String(e)), 422) } }
}

// Like parseBody but treats a missing/non-JSON body as fallback instead of 400.
export async function parseBodyOptional<T>(
  req: Request,
  parse: (body: unknown) => T,
  fallback: T,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown
  try { raw = await readJson(req) } catch { return { ok: true, data: fallback } }
  try { return { ok: true, data: parse(raw) } } catch (e) { return { ok: false, response: json(err(String(e)), 422) } }
}

// ── Router ────────────────────────────────────────────────────────────────────

import type { Env } from '../types/env'

export type Params = Record<string, string | undefined>
export type Handler = (req: Request, env: Env, params: Params) => Promise<Response>

interface Route {
  method: string
  pattern: URLPattern
  handler: Handler
}

// Headers that convey server-validated trust (audit identity, verified app id).
// They must NEVER be accepted from the client — only set by the router below —
// otherwise a caller could forge their identity in the D1 audit trail via the
// public run/stream routes. Strip any inbound copy before dispatch.
export function stripTrustHeaders(req: Request): Request {
  if (!req.headers.has('X-Whisper-Identity') && !req.headers.has('X-Whisper-App-Id')) return req
  const headers = new Headers(req.headers)
  headers.delete('X-Whisper-Identity')
  headers.delete('X-Whisper-App-Id')
  return new Request(req, { headers })
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const origin  = req.headers.get('Origin') ?? ''
  const allow   = allowed.includes('*') ? '*'
    : allowed.includes(origin) ? origin
    : null
  if (!allow) return {}
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
    'Access-Control-Max-Age':       '86400',
  }
}

// Generic sliding-window rate limiter — stored in RATE_LIMITS KV (separate from user data).
export async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
  env: Env,
  message = 'Rate limit exceeded — try again in a minute.',
): Promise<Response | null> {
  const ts     = now()
  const stored = await env.RATE_LIMITS.get(key, 'json') as number[] | null
  const window = (stored ?? []).filter(t => t > ts - windowMs)
  if (window.length >= max) {
    // The oldest in-window request frees a slot once it ages out → reset time.
    const oldest    = Math.min(...window)
    const resetMs   = oldest + windowMs
    const retrySec  = Math.max(1, Math.ceil((resetMs - ts) / 1000))
    const res = json(err(message), 429)
    res.headers.set('Retry-After',           String(retrySec))
    res.headers.set('X-RateLimit-Limit',     String(max))
    res.headers.set('X-RateLimit-Remaining', '0')
    res.headers.set('X-RateLimit-Reset',     String(Math.ceil(resetMs / 1000)))
    return res
  }
  window.push(ts)
  await env.RATE_LIMITS.put(key, JSON.stringify(window), { expirationTtl: Math.ceil(windowMs / 1000) })
  return null
}

// Rate-limit by client IP under the given key prefix (final key = `${keyPrefix}:${ip}`).
// Returns a 429 Response when over the limit, or null to proceed. Replaces the
// repeated "read CF-Connecting-IP → checkRateLimit" preamble across route handlers.
export async function rateLimitByIp(
  req: Request, env: Env, keyPrefix: string, max: number, windowMs: number,
): Promise<Response | null> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
  return checkRateLimit(`${keyPrefix}:${ip}`, max, windowMs, env)
}

// Sliding-window IP rate limiter for /api/ai/* routes.
export async function checkAiRateLimit(req: Request, env: Env): Promise<Response | null> {
  return rateLimitByIp(req, env, 'rl:ai', AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS)
}

// The caller's audit identity. Set by the router from validated CF Access only —
// inbound copies are stripped (see stripTrustHeaders), so this is never client-forged.
export function readIdentity(req: Request): string | null {
  return req.headers.get('X-Whisper-Identity')
}

// Parse a query-string integer with clamped bounds and a fallback for missing/invalid values.
export function parseQueryInt(
  params: URLSearchParams,
  key: string,
  fallback: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const raw = params.get(key)
  if (raw === null) return fallback
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(min, n), max)
}

// Exhaust all pages of a KV list() call and return every key.
export async function listAllKV<T>(ns: KVNamespace, prefix: string): Promise<KVNamespaceListKey<T>[]> {
  let result = await ns.list<T>({ prefix })
  const keys = [...result.keys]
  while (!result.list_complete) {
    result = await ns.list<T>({ prefix, cursor: result.cursor })
    keys.push(...result.keys)
  }
  return keys
}

// Exhaust all pages of an R2 list() call and return every object. R2 caps each
// page at 1000 keys, so a single list() silently drops objects past the first
// page — always use this when completeness matters (listing, deletion cleanup).
export async function listAllR2(bucket: R2Bucket, prefix: string): Promise<R2Object[]> {
  let result = await bucket.list({ prefix })
  const objects = [...result.objects]
  while (result.truncated) {
    result = await bucket.list({ prefix, cursor: result.cursor })
    objects.push(...result.objects)
  }
  return objects
}

export class Router {
  private readonly routes: Route[] = []

  on(method: string, path: string, handler: Handler): this {
    this.routes.push({
      method: method.toUpperCase(),
      pattern: new URLPattern({ pathname: path }),
      handler,
    })
    return this
  }

  get(path: string, h: Handler): this    { return this.on('GET',    path, h) }
  post(path: string, h: Handler): this   { return this.on('POST',   path, h) }
  put(path: string, h: Handler): this    { return this.on('PUT',    path, h) }
  delete(path: string, h: Handler): this { return this.on('DELETE', path, h) }
  patch(path: string, h: Handler): this  { return this.on('PATCH',  path, h) }

  async handle(req: Request, env: Env): Promise<Response> {
    const requestId = newId()
    const cors = corsHeaders(req, env)

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Content-Type': 'text/plain', 'X-Request-ID': requestId } })
    }

    const url = new URL(req.url)

    // IP-based rate limit on all /api/ai/* routes
    if (url.pathname.startsWith('/api/ai/')) {
      const rlRes = await checkAiRateLimit(req, env)
      if (rlRes) return this.addHeaders(rlRes, cors, requestId)
    }

    // Strip client-supplied trust headers up front — they may only be set below
    // from validated sources, never accepted from the caller.
    let dispatchReq = stripTrustHeaders(req)

    // App token gate: if a valid app token is present and the request is scoped to
    // that app's own routes, let it through without CF Access.
    let appTokenPassthrough = false
    const rawAppToken = extractAppToken(req)
    if (rawAppToken && env.SIGNING_SECRET) {
      const tokenAppId = await verifyAppToken(rawAppToken, env.SIGNING_SECRET)
      if (tokenAppId && isAppScopedPath(url.pathname, tokenAppId)) {
        appTokenPassthrough = true
        const headers = new Headers(dispatchReq.headers)
        headers.set('X-Whisper-App-Id', tokenAppId)
        dispatchReq = new Request(dispatchReq, { headers })
      }
    }

    // Cloudflare Access: gate state-mutation endpoints when CF_ACCESS_AUD is set.
    // Identity is forwarded on the request as X-Whisper-Identity for D1 audit trail.
    if (!appTokenPassthrough && isProtectedRequest(req.method, url.pathname)) {
      const { deny: authRes, identity } = await requireAccess(req, env)
      if (authRes) return this.addHeaders(authRes, cors, requestId)
      if (identity?.email) {
        const headers = new Headers(dispatchReq.headers)
        headers.set('X-Whisper-Identity', identity.email)
        dispatchReq = new Request(dispatchReq, { headers })
      }
    }

    for (const route of this.routes) {
      if (route.method !== req.method) continue
      const match = route.pattern.exec(url)
      if (!match) continue
      const params = match.pathname.groups as Params
      const res = await route.handler(dispatchReq, env, params)
      return this.addHeaders(res, cors, requestId)
    }

    return this.addHeaders(json(err('Not found'), 404), cors, requestId)
  }

  private addHeaders(res: Response, cors: Record<string, string>, requestId: string): Response {
    const headers = new Headers(res.headers)
    for (const [k, v] of Object.entries(cors)) headers.set(k, v)
    // The CORS allow-origin value depends on the request's Origin header, so any
    // shared cache must key on it — otherwise one origin's response (with its
    // Access-Control-Allow-Origin) could be served to a different origin.
    headers.append('Vary', 'Origin')
    headers.set('X-Request-ID',          requestId)
    headers.set('X-Content-Type-Options', 'nosniff')
    if (!headers.has('X-Frame-Options')) headers.set('X-Frame-Options', 'DENY')
    if (!headers.has('Referrer-Policy'))  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    headers.set('Permissions-Policy',     'camera=(), microphone=(), geolocation=()')
    headers.set('X-XSS-Protection',       '0')
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }
}
