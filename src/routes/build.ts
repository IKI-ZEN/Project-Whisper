import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, parseBody, listAllKV } from '../lib/http'
import { parseBuildRequest } from '../lib/schema'
import { newId, isUUID, now } from '../lib/utils'
import { BUILD_KEY_PREFIX, BUILD_TTL } from '../lib/constants'
import { doFetch, identityHeader } from './sandbox'

// ── DO stub helper ────────────────────────────────────────────────────────────

function buildStub(env: Env, id: string): DurableObjectStub {
  return env.APP_BUILDER.get(env.APP_BUILDER.idFromName(id))
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// GET /api/v2/build
const list: Handler = async (_req, env) => {
  const keys = await listAllKV(env.SANDBOX_REGISTRY, BUILD_KEY_PREFIX)
  return json(ok({ builds: keys.map(k => k.metadata), total: keys.length }))
}

// POST /api/v2/build
const create: Handler = async (req, env) => {
  const parsed = await parseBody(req, parseBuildRequest)
  if (!parsed.ok) return parsed.response
  const { description, name, sandboxId, model } = parsed.data

  const id   = newId()
  const stub = buildStub(env, id)

  const initRes  = await doFetch(stub, 'init', 'POST', { id, description, name, sandboxId, model }, identityHeader(req))
  const initData = await initRes.json() as { ok: boolean; error?: string }
  if (!initData.ok) return json(err(initData.error ?? 'Failed to initialise build'), 500)

  // Register in KV so builds are enumerable via GET /api/v2/build
  await env.SANDBOX_REGISTRY.put(`${BUILD_KEY_PREFIX}${id}`, id, {
    expirationTtl: BUILD_TTL,
    metadata: { id, name: name ?? description.slice(0, 64), description, model: model ?? '', createdAt: now() },
  })

  return json(ok({ buildId: id, wsUrl: `/api/v2/build/${id}/ws`, appUrl: `/build/${id}`, status: 'idle' }))
}

// GET /api/v2/build/:id
const get: Handler = async (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid build id'), 422)
  const res  = await doFetch(buildStub(env, id), 'status', 'GET')
  const data = await res.json() as { ok: boolean; data?: unknown; error?: string }
  if (!data.ok) return json(err(data.error ?? 'Build not found'), 404)
  return json(ok(data.data))
}

// GET /api/v2/build/:id/files
const listFiles: Handler = async (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid build id'), 422)
  const res  = await doFetch(buildStub(env, id), 'files', 'GET')
  const data = await res.json() as { ok: boolean; data?: unknown; error?: string }
  if (!data.ok) return json(err(data.error ?? 'Build not found'), 404)
  return json(ok(data.data))
}

// GET /api/v2/build/:id/files/:filename
const getFile: Handler = async (_req, env, params) => {
  const id       = params.id ?? ''
  const filename = params.filename ?? 'index.html'
  if (!isUUID(id)) return json(err('Invalid build id'), 422)
  if (filename.startsWith('.')) return json(err('File not found'), 404)
  const res = await doFetch(buildStub(env, id), `files/${encodeURIComponent(filename)}`, 'GET')
  if (!res.ok) return json(err('File not found'), 404)
  // Return the raw file response (already has correct Content-Type from the DO)
  return res
}

// DELETE /api/v2/build/:id
const del: Handler = async (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid build id'), 422)
  const res  = await doFetch(buildStub(env, id), '', 'DELETE')
  const data = await res.json() as { ok: boolean; error?: string }
  if (!data.ok) return json(err(data.error ?? 'Delete failed'), 500)
  await env.SANDBOX_REGISTRY.delete(`${BUILD_KEY_PREFIX}${id}`)
  return json(ok({ deleted: true }))
}

// GET /api/v2/build/:id/thumbnail — E3
const getThumbnail: Handler = async (_req, env, params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid build id'), 422)
  const obj = await env.FILES.get(`apps/${id}/.thumbnail.svg`)
  if (!obj) return json(err('Thumbnail not found'), 404)
  return new Response(obj.body, {
    headers: {
      'Content-Type':  'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

// POST /api/v2/build/:id/deploy — E6: Cloudflare Pages direct upload
const deploy: Handler = async (_req, env, params) => {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    return json(err('Cloudflare API token not configured — set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID'), 503)
  }

  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid build id'), 422)

  // 1. Verify build is complete
  const statusRes  = await doFetch(buildStub(env, id), 'status', 'GET')
  const statusData = await statusRes.json() as { ok: boolean; data?: { status: string; files: string[]; name: string }; error?: string }
  if (!statusData.ok || !statusData.data) return json(err('Build not found'), 404)
  if (statusData.data.status !== 'complete') return json(err(`Build not complete (status: ${statusData.data.status})`), 409)

  const buildFiles  = statusData.data.files
  const projectName = `whisper-app-${id.slice(0, 8)}`
  const apiBase     = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`
  const authHeaders = { 'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}` }

  // 2. Create the Pages project if it doesn't exist (422 = already exists)
  const projectRes = await fetch(`${apiBase}/pages/projects`, {
    method:  'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name: projectName, production_branch: 'main' }),
  })
  if (!projectRes.ok && projectRes.status !== 422) {
    const e = await projectRes.json() as { errors?: Array<{ message: string }> }
    return json(err(`Failed to create Pages project: ${e.errors?.[0]?.message ?? projectRes.statusText}`), 502)
  }

  // 3. Build manifest + assemble multipart form
  const form     = new FormData()
  const manifest: Record<string, string> = {}

  const SAFE_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9._\-]*$/
  for (const filename of buildFiles) {
    if (!SAFE_FILENAME.test(filename) || filename.includes('..')) continue
    const obj = await env.FILES.get(`apps/${id}/${filename}`)
    if (!obj) continue
    const bytes    = await obj.arrayBuffer()
    const hashBuf  = await crypto.subtle.digest('SHA-256', bytes)
    const hash     = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
    manifest[`/${filename}`] = hash
    form.append(`/${filename}`, new Blob([bytes]), filename)
  }
  form.append('manifest', JSON.stringify(manifest))

  // 4. Create deployment
  const deployRes = await fetch(`${apiBase}/pages/projects/${projectName}/deployments`, {
    method:  'POST',
    headers: authHeaders,
    body:    form,
  })
  const deployData = await deployRes.json() as { success: boolean; result?: { id: string }; errors?: Array<{ message: string }> }
  if (!deployData.success) {
    return json(err(`Deployment failed: ${deployData.errors?.[0]?.message ?? 'Unknown error'}`), 502)
  }

  return json(ok({
    deploymentUrl: `https://${projectName}.pages.dev`,
    deploymentId:  deployData.result?.id,
    projectName,
  }))
}

// ── Route table ───────────────────────────────────────────────────────────────

export const buildRoutes: Array<[string, string, Handler]> = [
  ['GET',    '/api/v2/build',                     list],
  ['POST',   '/api/v2/build',                     create],
  ['GET',    '/api/v2/build/:id',                 get],
  ['GET',    '/api/v2/build/:id/files',           listFiles],
  ['GET',    '/api/v2/build/:id/files/:filename', getFile],
  ['DELETE', '/api/v2/build/:id',                 del],
  ['GET',    '/api/v2/build/:id/thumbnail',       getThumbnail],
  ['POST',   '/api/v2/build/:id/deploy',          deploy],
]
