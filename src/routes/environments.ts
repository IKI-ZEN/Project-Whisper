import type { Env } from '../types/env'
import type { Handler, Params } from '../lib/http'
import { json, ok, err, parseBody, readJson, checkRateLimit } from '../lib/http'
import { generateEnvConfig } from '../lib/ai'
import { parseEnvironmentRequest, parsePatchEnvironmentRequest, type SandboxConfig } from '../lib/schema'
import { newId, now, isUUID } from '../lib/utils'
import { registerSandbox, stub, doFetch, identityHeader, sandboxExists } from './sandbox'
import { signPayload, verifySignature } from '../lib/vault'
import {
  SANDBOX_CREATE_RATE_LIMIT_MAX, SANDBOX_CREATE_RATE_LIMIT_WINDOW,
  SANDBOX_TTL, SANDBOX_KEY_PREFIX, MAX_ENV_MODELS, ENV_TYPES,
} from '../lib/constants'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getEnvMeta(env: Env, id: string) {
  return env.SANDBOX_REGISTRY.getWithMetadata<{
    fromEnv?: boolean; envType?: string; envModels?: string[]
    name?: string; description?: string; model?: string; createdAt?: number
  }>(`${SANDBOX_KEY_PREFIX}${id}`)
}

// ── Create ────────────────────────────────────────────────────────────────────

const createEnvironment: Handler = async (req, env) => {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
  const rl = await checkRateLimit(`rl:env-create:${ip}`, SANDBOX_CREATE_RATE_LIMIT_MAX, SANDBOX_CREATE_RATE_LIMIT_WINDOW, env)
  if (rl) return rl

  const p = await parseBody(req, parseEnvironmentRequest)
  if (!p.ok) return p.response
  const { description, envType, envModels: requestedModels, name } = p.data

  let envConfig
  try {
    envConfig = await generateEnvConfig(env.AI, env, description, envType, requestedModels, name)
  } catch (e) {
    return json(err('Environment generation failed — try a more detailed description', String(e)), 500)
  }

  if (!envConfig.systemPrompt || !envConfig.name) {
    return json(err('Generated config was invalid — try a more detailed description'), 422)
  }

  const id       = newId()
  const ts       = now()
  const identity = req.headers.get('X-Whisper-Identity')

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
    fromEnv:     true,
    envType,
    envModels:   envConfig.envModels,
  })

  await env.DB.prepare(
    'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, 'env_created', JSON.stringify({ description: description.slice(0, 256), envType }), identity, ts).run()

  return json(ok({
    id,
    name:      config.name,
    envType,
    envModels: envConfig.envModels,
    envUrl:    `/env/${id}`,
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

const patchEnvironment: Handler = async (req, env, params: Params) => {
  const id       = params.id ?? ''
  const identity = req.headers.get('X-Whisper-Identity')
  if (!isUUID(id)) return json(err('Invalid environment id'), 422)
  if (!await sandboxExists(env, id)) return json(err('Environment not found'), 404)

  const { metadata } = await getEnvMeta(env, id)
  if (!metadata?.fromEnv) return json(err('Not an environment'), 404)

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
    void env.DB.prepare(
      'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(id, 'env_config_update', JSON.stringify(eventMeta), identity, now()).run()
  }

  return res
}

// ── Export ────────────────────────────────────────────────────────────────────

const exportEnvironment: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid environment id'), 422)
  if (!await sandboxExists(env, id)) return json(err('Environment not found'), 404)

  const { metadata } = await getEnvMeta(env, id)
  if (!metadata?.fromEnv) return json(err('Not an environment'), 404)

  const res  = await doFetch(stub(env, id), 'config', 'GET')
  const body = await res.json() as { ok: boolean; data: SandboxConfig }
  if (!body.ok) return json(err('Failed to load config'), 500)

  const { name, description, systemPrompt, tools, model, temperature, maxTokens, ragEnabled, envType, envModels } = body.data

  // Canonical field order must match import verification exactly
  const canonPayload = JSON.stringify({ version: 1, name, description, systemPrompt, tools, model, temperature, maxTokens, ragEnabled, envType, envModels })
  const signature    = env.SIGNING_SECRET ? await signPayload(canonPayload, env.SIGNING_SECRET) : undefined

  return json(ok({ version: 1 as const, name, description, systemPrompt, tools, model, temperature, maxTokens, ragEnabled, envType, envModels, signature }))
}

// ── Import ────────────────────────────────────────────────────────────────────

const importEnvironment: Handler = async (req, env) => {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
  const rl = await checkRateLimit(`rl:env-create:${ip}`, SANDBOX_CREATE_RATE_LIMIT_MAX, SANDBOX_CREATE_RATE_LIMIT_WINDOW, env)
  if (rl) return rl

  let raw: unknown
  try { raw = await readJson(req) } catch (e) { return json(err(String(e)), 400) }

  // Verify HMAC signature when SIGNING_SECRET is configured
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
  // Validate envType against the enum, mirroring createEnvironment (unknown → general).
  const rawType   = typeof r.envType === 'string' ? r.envType : 'general'
  const envType   = (ENV_TYPES as readonly string[]).includes(rawType) ? rawType : 'general'
  const envModels = Array.isArray(r.envModels) ? (r.envModels as unknown[]).filter((m): m is string => typeof m === 'string').slice(0, MAX_ENV_MODELS) : []

  const id       = newId()
  const ts       = now()
  const identity = req.headers.get('X-Whisper-Identity')

  const config: SandboxConfig = {
    id,
    name:         typeof r.name         === 'string' ? r.name         : 'Imported Environment',
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
    fromEnv:     true,
    envType,
    envModels,
  })

  await env.DB.prepare(
    'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, 'env_imported', JSON.stringify({ name: config.name, envType }), identity, ts).run()

  return json(ok({
    id,
    name:      config.name,
    envType,
    envModels,
    envUrl:    `/env/${id}`,
    api:       { run: `/s/${id}/run`, stream: `/s/${id}/stream` },
  }), 201)
}

// ── Fork ──────────────────────────────────────────────────────────────────────

const forkEnvironment: Handler = async (req, env, params: Params) => {
  const sourceId = params.id ?? ''
  if (!isUUID(sourceId)) return json(err('Invalid environment id'), 422)
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
  const rl = await checkRateLimit(`rl:env-create:${ip}`, SANDBOX_CREATE_RATE_LIMIT_MAX, SANDBOX_CREATE_RATE_LIMIT_WINDOW, env)
  if (rl) return rl
  if (!await sandboxExists(env, sourceId)) return json(err('Environment not found'), 404)

  const { metadata } = await getEnvMeta(env, sourceId)
  if (!metadata?.fromEnv) return json(err('Not an environment'), 404)

  const cfgRes  = await doFetch(stub(env, sourceId), 'config', 'GET')
  const cfgBody = await cfgRes.json() as { ok: boolean; data?: SandboxConfig }
  if (!cfgBody.ok || !cfgBody.data) return json(err('Failed to load source config'), 500)

  const src      = cfgBody.data
  const id       = newId()
  const ts       = now()
  const identity = req.headers.get('X-Whisper-Identity')
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
    fromEnv:     true,
    envType,
    envModels,
  })

  await env.DB.prepare(
    'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, 'env_forked', JSON.stringify({ name: config.name, forkedFrom: sourceId, envType }), identity, ts).run()

  return json(ok({
    id,
    name:      config.name,
    envType,
    envModels,
    envUrl:    `/env/${id}`,
    api:       { run: `/s/${id}/run`, stream: `/s/${id}/stream` },
  }), 201)
}

// ── Routes ────────────────────────────────────────────────────────────────────

export const environmentRoutes: Array<[string, string, Handler]> = [
  ['POST',  '/api/environments',            createEnvironment],
  ['POST',  '/api/environments/import',     importEnvironment],
  ['GET',   '/api/environments/:id/export', exportEnvironment],
  ['POST',  '/api/environments/:id/fork',   forkEnvironment],
  ['PATCH', '/api/environments/:id',        patchEnvironment],
]
