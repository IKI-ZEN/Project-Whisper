import type { Env } from '../../types/env'
import type { Handler } from '../../lib/http'
import { injectAppToken } from './shared'

// ── Built app serving (/build/:id) ───────────────────────────────────────────

function buildMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css:  'text/css; charset=utf-8',
    js:   'application/javascript; charset=utf-8',
    mjs:  'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg:  'image/svg+xml',
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    ico:  'image/x-icon',
    txt:  'text/plain; charset=utf-8',
    md:   'text/markdown; charset=utf-8',
  }
  return map[ext] ?? 'application/octet-stream'
}

// Permissive CSP for AI-generated apps — they may load CDN ESM frameworks
const BUILD_CSP = [
  "default-src 'self' https: data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://esm.sh https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https:",
  "connect-src 'self' https: wss:",
  "img-src 'self' data: https: blob:",
  "font-src 'self' https:",
].join('; ')

async function serveBuildFile(env: Env, buildId: string, filename: string): Promise<Response> {
  if (filename.startsWith('.')) return new Response('Not found', { status: 404 })
  const key = `apps/${buildId}/${filename}`
  const obj = await env.FILES.get(key)
  if (!obj) return new Response('Not found', { status: 404 })

  const ct      = buildMimeType(filename)
  const headers = { 'Content-Type': ct, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': BUILD_CSP }

  // Inject __BUILD_ID__ placeholder and app token into HTML files at serve time
  if (filename.endsWith('.html')) {
    const text     = await obj.text()
    let   injected = text.replace(/__BUILD_ID__/g, buildId)
    injected = await injectAppToken(injected, buildId, env)
    return new Response(injected, { headers })
  }

  return new Response(obj.body, { headers })
}

export const buildIndex: Handler = (_req, env, params) =>
  serveBuildFile(env, params.id ?? '', 'index.html')

export const buildFile: Handler = (_req, env, params) =>
  serveBuildFile(env, params.id ?? '', params.filename ?? 'index.html')
