import type { Env } from '../types/env'
import type { Handler, Params } from '../lib/http'
import { json, ok, err, parseBody, readJson, rateLimitByIp, readIdentity } from '../lib/http'
import { generateEnvConfig } from '../lib/ai'
import { parseEnvironmentRequest, parsePatchEnvironmentRequest, type SandboxConfig } from '../lib/schema'
import { newId, now, isUUID } from '../lib/utils'
import { registerSandbox, stub, doFetch, identityHeader, sandboxExists } from '../lib/do'
import { signPayload, verifySignature } from '../lib/vault'
import {
  SANDBOX_CREATE_RATE_LIMIT_MAX, SANDBOX_CREATE_RATE_LIMIT_WINDOW_MS,
  SANDBOX_TTL, SANDBOX_KEY_PREFIX, MAX_ENV_MODELS, ENV_TYPES,
} from '../lib/constants'
import { logSandboxEvent } from '../lib/events'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getLabMeta(env: Env, id: string) {
  return env.SANDBOX_REGISTRY.getWithMetadata<{
    fromLab?: boolean; envType?: string; envModels?: string[]
    name?: string; description?: string; model?: string; createdAt?: number
  }>(`${SANDBOX_KEY_PREFIX}${id}`)
}

// ── Create ────────────────────────────────────────────────────────────────────

const createLab: Handler = async (req, env) => {
  const rl = await rateLimitByIp(req, env, 'rl:lab-create', SANDBOX_CREATE_RATE_LIMIT_MAX, SANDBOX_CREATE_RATE_LIMIT_WINDOW_MS)
  if (rl) return rl

  const p = await parseBody(req, parseEnvironmentRequest)
  if (!p.ok) return p.response
  const { description, envType, envModels: requestedModels, name } = p.data

  let envConfig
  try {
    envConfig = await generateEnvConfig(env.AI, env, description, envType, requestedModels, name)
  } catch (e) {
    return json(err('Lab generation failed — try a more detailed description', String(e)), 500)
  }

  if (!envConfig.systemPrompt || !envConfig.name) {
    return json(err('Generated config was invalid — try a more detailed description'), 422)
  }

  const id       = newId()
  const ts       = now()
  const identity = readIdentity(req)

  const config: SandboxConfig = {
    id,
    name:         envConfig.name,
    description:  envConfig.description,
    systemPrompt: envConfig.systemPrompt,
    model:        envConfig.envModels[0],
    temperature:  envConfig.temperature,
    maxTokens:    envConfig.maxTokens,
    ragEnabled:   envType === 'research',
    tools:        [],
    memory:       [],
    createdAt:    ts,
    updatedAt:    ts,
    envType,
    envModels:    envConfig.envModels,
  }

  await doFetch(stub(env, id), 'init', 'POST', config, identityHeader(req))

  await registerSandbox(env, {
    id,
    name:        config.name,
    description: (config.description ?? '').slice(0, 200),
    model:       config.model,
    createdAt:   ts,
    fromLab:     true,
    envType,
    envModels:   envConfig.envModels,
  })

  await logSandboxEvent(env, { sandboxId: id, type: 'lab_created', metadata: { description: description.slice(0, 256), envType }, identity, at: ts })

  return json(ok({
    id,
    name:      config.name,
    envType,
    envModels: envConfig.envModels,
    labUrl:    `/lab/${id}`,
    api: {
      run:    `/s/${id}/run`,
      stream: `/s/${id}/stream`,
    },
    config: {
      systemPrompt: config.systemPrompt,
      temperature:  config.temperature,
      maxTokens:    config.maxTokens,
    },
  }), 201)
}

// ── Patch ─────────────────────────────────────────────────────────────────────

const patchLab: Handler = async (req, env, params: Params) => {
  const id       = params.id ?? ''
  const identity = readIdentity(req)
  if (!isUUID(id)) return json(err('Invalid lab id'), 422)
  if (!await sandboxExists(env, id)) return json(err('Lab not found'), 404)

  const { metadata } = await getLabMeta(env, id)
  if (!metadata?.fromLab) return json(err('Not a lab'), 404)

  const p = await parseBody(req, parsePatchEnvironmentRequest)
  if (!p.ok) return p.response
  const patch = p.data

  const configPatch: Record<string, unknown> = {}
  if (patch.systemPrompt !== undefined) configPatch.systemPrompt = patch.systemPrompt
  if (patch.temperature  !== undefined) configPatch.temperature  = patch.temperature
  if (patch.maxTokens    !== undefined) configPatch.maxTokens    = patch.maxTokens
  if (patch.envModels    !== undefined) {
    configPatch.envModels = patch.envModels
    configPatch.model     = patch.envModels[0]
  }

  const res = await doFetch(stub(env, id), 'config', 'PATCH', configPatch, identityHeader(req))

  if (res.ok) {
    if (patch.envModels !== undefined && metadata) {
      const updatedMeta = { ...metadata, envModels: patch.envModels, model: patch.envModels[0] }
      void env.SANDBOX_REGISTRY.put(`${SANDBOX_KEY_PREFIX}${id}`, id, { expirationTtl: SANDBOX_TTL, metadata: updatedMeta })
    }
    const eventMeta: Record<string, unknown> = {}
    if (patch.envModels    !== undefined) eventMeta.envModels    = patch.envModels
    if (patch.systemPrompt !== undefined) eventMeta.systemPrompt = true
    if (patch.temperature  !== undefined) eventMeta.temperature  = patch.temperature
    if (patch.maxTokens    !== undefined) eventMeta.maxTokens    = patch.maxTokens
    void logSandboxEvent(env, { sandboxId: id, type: 'lab_config_update', metadata: eventMeta, identity, at: now() })
  }

  return res
}

// ── Export ────────────────────────────────────────────────────────────────────

const exportLab: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid lab id'), 422)
  if (!await sandboxExists(env, id)) return json(err('Lab not found'), 404)

  const { metadata } = await getLabMeta(env, id)
  if (!metadata?.fromLab) return json(err('Not a lab'), 404)

  const res  = await doFetch(stub(env, id), 'config', 'GET')
  const body = await res.json() as { ok: boolean; data: SandboxConfig }
  if (!body.ok) return json(err('Failed to load config'), 500)

  const { name, description, systemPrompt, tools, model, temperature, maxTokens, ragEnabled, envType, envModels } = body.data

  const canonPayload = JSON.stringify({ version: 1, name, description, systemPrompt, tools, model, temperature, maxTokens, ragEnabled, envType, envModels })
  const signature    = env.SIGNING_SECRET ? await signPayload(canonPayload, env.SIGNING_SECRET) : undefined

  return json(ok({ version: 1 as const, name, description, systemPrompt, tools, model, temperature, maxTokens, ragEnabled, envType, envModels, signature }))
}

// ── Import ────────────────────────────────────────────────────────────────────

const importLab: Handler = async (req, env) => {
  const rl = await rateLimitByIp(req, env, 'rl:lab-create', SANDBOX_CREATE_RATE_LIMIT_MAX, SANDBOX_CREATE_RATE_LIMIT_WINDOW_MS)
  if (rl) return rl

  let raw: unknown
  try { raw = await readJson(req) } catch (e) { return json(err(String(e)), 400) }

  if (env.SIGNING_SECRET && typeof raw === 'object' && raw !== null) {
    const r = raw as Record<string, unknown>
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
      ragEnabled:   r.ragEnabled,
      envType:      r.envType,
      envModels:    r.envModels,
    })
    const valid = await verifySignature(canonPayload, r.signature, env.SIGNING_SECRET)
    if (!valid) return json(err('Import rejected: invalid export signature'), 422)
  }

  if (typeof raw !== 'object' || raw === null) return json(err('Invalid import payload'), 400)
  const r      = raw as Record<string, unknown>
  const rawType   = typeof r.envType === 'string' ? r.envType : 'general'
  const envType   = (ENV_TYPES as readonly string[]).includes(rawType) ? rawType : 'general'
  const envModels = Array.isArray(r.envModels) ? (r.envModels as unknown[]).filter((m): m is string => typeof m === 'string').slice(0, MAX_ENV_MODELS) : []

  const id       = newId()
  const ts       = now()
  const identity = readIdentity(req)

  const config: SandboxConfig = {
    id,
    name:         typeof r.name         === 'string' ? r.name         : 'Imported Lab',
    description:  typeof r.description  === 'string' ? r.description  : '',
    systemPrompt: typeof r.systemPrompt === 'string' ? r.systemPrompt : '',
    model:        envModels[0] ?? (typeof r.model === 'string' ? r.model : ''),
    temperature:  typeof r.temperature  === 'number' ? r.temperature  : 0.7,
    maxTokens:    typeof r.maxTokens    === 'number' ? r.maxTokens    : 1024,
    ragEnabled:   r.ragEnabled === true,
    tools:        Array.isArray(r.tools) ? r.tools as SandboxConfig['tools'] : [],
    memory:       [],
    createdAt:    ts,
    updatedAt:    ts,
    envType,
    envModels,
  }

  await doFetch(stub(env, id), 'init', 'POST', config, identityHeader(req))
  await registerSandbox(env, {
    id,
    name:        config.name,
    description: (config.description ?? '').slice(0, 200),
    model:       config.model,
    createdAt:   ts,
    fromLab:     true,
    envType,
    envModels,
  })

  await logSandboxEvent(env, { sandboxId: id, type: 'lab_imported', metadata: { name: config.name, envType }, identity, at: ts })

  return json(ok({
    id,
    name:      config.name,
    envType,
    envModels,
    labUrl:    `/lab/${id}`,
    api:       { run: `/s/${id}/run`, stream: `/s/${id}/stream` },
  }), 201)
}

// ── Fork ──────────────────────────────────────────────────────────────────────

const forkLab: Handler = async (req, env, params: Params) => {
  const sourceId = params.id ?? ''
  if (!isUUID(sourceId)) return json(err('Invalid lab id'), 422)
  const rl = await rateLimitByIp(req, env, 'rl:lab-create', SANDBOX_CREATE_RATE_LIMIT_MAX, SANDBOX_CREATE_RATE_LIMIT_WINDOW_MS)
  if (rl) return rl
  if (!await sandboxExists(env, sourceId)) return json(err('Lab not found'), 404)

  const { metadata } = await getLabMeta(env, sourceId)
  if (!metadata?.fromLab) return json(err('Not a lab'), 404)

  const cfgRes  = await doFetch(stub(env, sourceId), 'config', 'GET')
  const cfgBody = await cfgRes.json() as { ok: boolean; data?: SandboxConfig }
  if (!cfgBody.ok || !cfgBody.data) return json(err('Failed to load source config'), 500)

  const src      = cfgBody.data
  const id       = newId()
  const ts       = now()
  const identity = readIdentity(req)
  const envType  = src.envType  ?? metadata.envType  ?? 'general'
  const envModels = src.envModels ?? metadata.envModels ?? [src.model]

  const config: SandboxConfig = {
    ...src,
    id,
    name:          `${src.name} (copy)`,
    memory:        [],
    createdAt:     ts,
    updatedAt:     ts,
    integrityHash: undefined,
    envType,
    envModels,
  }

  await doFetch(stub(env, id), 'init', 'POST', config, identityHeader(req))
  await registerSandbox(env, {
    id,
    name:        config.name,
    description: (config.description ?? '').slice(0, 200),
    model:       config.model,
    createdAt:   ts,
    fromLab:     true,
    envType,
    envModels,
  })

  await logSandboxEvent(env, { sandboxId: id, type: 'lab_forked', metadata: { name: config.name, forkedFrom: sourceId, envType }, identity, at: ts })

  return json(ok({
    id,
    name:      config.name,
    envType,
    envModels,
    labUrl:    `/lab/${id}`,
    api:       { run: `/s/${id}/run`, stream: `/s/${id}/stream` },
  }), 201)
}

// ── Routes ────────────────────────────────────────────────────────────────────

export const labRoutes: Array<[string, string, Handler]> = [
  ['POST',  '/api/lab',            createLab],
  ['POST',  '/api/lab/import',     importLab],
  ['GET',   '/api/lab/:id/export', exportLab],
  ['POST',  '/api/lab/:id/fork',   forkLab],
  ['PATCH', '/api/lab/:id',        patchLab],
]
