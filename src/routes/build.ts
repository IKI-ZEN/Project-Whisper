import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, parseBody } from '../lib/http'
import { parseBuildRequest } from '../lib/schema'
import { newId } from '../lib/utils'

// ── DO stub helpers ───────────────────────────────────────────────────────────

function buildStub(env: Env, id: string): DurableObjectStub {
  return env.APP_BUILDER.get(env.APP_BUILDER.idFromName(id))
}

function doBuild(stub: DurableObjectStub, path: string, method = 'GET', body?: unknown): Promise<Response> {
  return stub.fetch(new Request(`http://do${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  }))
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// POST /api/v2/build
export const createBuildHandler: Handler = async (req, env) => {
  const parsed = await parseBody(req, parseBuildRequest)
  if (!parsed.ok) return parsed.response
  const { description, name, sandboxId, model } = parsed.data

  const id   = newId()
  const stub = buildStub(env, id)

  const initRes  = await doBuild(stub, '/init', 'POST', { id, description, name, sandboxId, model })
  const initData = await initRes.json() as { ok: boolean; error?: string }
  if (!initData.ok) return json(err(initData.error ?? 'Failed to initialise build'), 500)

  return json(ok({ buildId: id, wsUrl: `/api/v2/build/${id}/ws`, appUrl: `/build/${id}`, status: 'idle' }))
}

// GET /api/v2/build/:id
export const getBuildHandler: Handler = async (_req, env, params) => {
  const id   = params.id ?? ''
  const res  = await doBuild(buildStub(env, id), '/status')
  const data = await res.json() as { ok: boolean; data?: unknown; error?: string }
  if (!data.ok) return json(err(data.error ?? 'Build not found'), 404)
  return json(ok(data.data))
}

// GET /api/v2/build/:id/files
export const listBuildFilesHandler: Handler = async (_req, env, params) => {
  const id   = params.id ?? ''
  const res  = await doBuild(buildStub(env, id), '/files')
  const data = await res.json() as { ok: boolean; data?: unknown; error?: string }
  if (!data.ok) return json(err(data.error ?? 'Build not found'), 404)
  return json(ok(data.data))
}

// GET /api/v2/build/:id/files/:filename
export const getBuildFileHandler: Handler = async (_req, env, params) => {
  const id       = params.id ?? ''
  const filename = params.filename ?? 'index.html'
  const res = await doBuild(buildStub(env, id), `/files/${encodeURIComponent(filename)}`)
  if (!res.ok) return json(err('File not found'), 404)
  // Return the raw file response (already has correct Content-Type from the DO)
  return res
}

// DELETE /api/v2/build/:id
export const deleteBuildHandler: Handler = async (_req, env, params) => {
  const id   = params.id ?? ''
  const res  = await doBuild(buildStub(env, id), '/', 'DELETE')
  const data = await res.json() as { ok: boolean; error?: string }
  if (!data.ok) return json(err(data.error ?? 'Delete failed'), 500)
  return json(ok({ deleted: true }))
}

// GET /api/v2/build/:id/thumbnail — E3
export const getBuildThumbnailHandler: Handler = async (_req, env, params) => {
  const id  = params.id ?? ''
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
export const deployBuildHandler: Handler = async (_req, env, params) => {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    return json(err('Cloudflare API token not configured — set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID'), 503)
  }

  const id = params.id ?? ''

  // 1. Verify build is complete
  const statusRes  = await doBuild(buildStub(env, id), '/status')
  const statusData = await statusRes.json() as { ok: boolean; data?: { status: string; files: string[]; name: string }; error?: string }
  if (!statusData.ok || !statusData.data) return json(err('Build not found'), 404)
  if (statusData.data.status !== 'complete') return json(err(`Build not complete (status: ${statusData.data.status})`), 409)

  const buildFiles  = statusData.data.files
  const projectName = `aether-lite-app-${id.slice(0, 8)}`
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
  ['POST',   '/api/v2/build',                     createBuildHandler],
  ['GET',    '/api/v2/build/:id',                 getBuildHandler],
  ['GET',    '/api/v2/build/:id/files',           listBuildFilesHandler],
  ['GET',    '/api/v2/build/:id/files/:filename', getBuildFileHandler],
  ['DELETE', '/api/v2/build/:id',                 deleteBuildHandler],
  ['GET',    '/api/v2/build/:id/thumbnail',       getBuildThumbnailHandler],
  ['POST',   '/api/v2/build/:id/deploy',          deployBuildHandler],
]
