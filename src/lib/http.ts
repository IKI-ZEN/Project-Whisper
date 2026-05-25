import { MAX_REQUEST_BODY } from './constants'

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
  const cl = parseInt(req.headers.get('Content-Length') ?? '0', 10)
  if (cl > MAX_REQUEST_BODY) throw new Error('Request body too large (max 1 MB)')
  return req.json()
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

// ── Router ────────────────────────────────────────────────────────────────────

import type { Env } from '../types/env'

export type Params = Record<string, string | undefined>
export type Handler = (req: Request, env: Env, params: Params) => Promise<Response>

interface Route {
  method: string
  pattern: URLPattern
  handler: Handler
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '*').split(',').map(s => s.trim())
  const origin  = req.headers.get('Origin') ?? ''
  const allow   = allowed.includes('*') ? '*'
    : allowed.includes(origin) ? origin
    : null
  if (!allow) return {}
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  }
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
  delete(path: string, h: Handler): this { return this.on('DELETE', path, h) }
  patch(path: string, h: Handler): this  { return this.on('PATCH',  path, h) }

  async handle(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req, env)

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    const url = new URL(req.url)
    for (const route of this.routes) {
      if (route.method !== req.method) continue
      const match = route.pattern.exec(url)
      if (!match) continue
      const params = match.pathname.groups as Params
      const res = await route.handler(req, env, params)
      return this.addCors(res, cors)
    }

    return this.addCors(json(err('Not found'), 404), cors)
  }

  private addCors(res: Response, cors: Record<string, string>): Response {
    if (Object.keys(cors).length === 0) return res
    const headers = new Headers(res.headers)
    for (const [k, v] of Object.entries(cors)) headers.set(k, v)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }
}
