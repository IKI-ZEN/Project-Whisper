import type { Env } from '../types/env'
import type { Handler, Params } from '../lib/http'
import { json, ok, err, parseBody, readJson, checkRateLimit } from '../lib/http'
import { generateEnvConfig } from '../lib/ai'
import { parseEnvironmentRequest, type SandboxConfig } from '../lib/schema'
import { newId, now, isUUID } from '../lib/utils'
import { registerSandbox, stub, doFetch, identityHeader, sandboxExists } from './sandbox'
import { SANDBOX_CREATE_RATE_LIMIT_MAX, SANDBOX_CREATE_RATE_LIMIT_WINDOW, SANDBOX_TTL, SANDBOX_KEY_PREFIX, MAX_ENV_MODELS } from '../lib/constants'

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

// PATCH /api/environments/:id — update envModels, systemPrompt, temperature, maxTokens
const patchEnvironment: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!isUUID(id)) return json(err('Invalid environment id'), 422)
  if (!await sandboxExists(env, id)) return json(err('Environment not found'), 404)

  // Verify this is actually an environment (not a plain sandbox)
  const { metadata } = await env.SANDBOX_REGISTRY.getWithMetadata<{ fromEnv?: boolean; envType?: string; name?: string; description?: string; model?: string; createdAt?: number; envModels?: string[] }>(
    `${SANDBOX_KEY_PREFIX}${id}`,
  )
  if (!metadata?.fromEnv) return json(err('Not an environment'), 404)

  let body: unknown
  try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
  const patch = body as Partial<{ systemPrompt: string; temperature: number; maxTokens: number; envModels: string[] }>

  // Validate envModels if provided
  if (patch.envModels !== undefined) {
    if (!Array.isArray(patch.envModels) || patch.envModels.length === 0 || patch.envModels.length > MAX_ENV_MODELS) {
      return json(err(`envModels must be an array of 1–${MAX_ENV_MODELS} model strings`), 422)
    }
    if (!patch.envModels.every(m => typeof m === 'string')) {
      return json(err('All envModels entries must be strings'), 422)
    }
  }

  // Build the config patch (only envModels-safe fields; envType is immutable)
  const configPatch: Record<string, unknown> = {}
  if (patch.systemPrompt !== undefined) configPatch.systemPrompt = patch.systemPrompt
  if (patch.temperature  !== undefined) configPatch.temperature  = patch.temperature
  if (patch.maxTokens    !== undefined) configPatch.maxTokens    = patch.maxTokens
  if (patch.envModels    !== undefined) {
    configPatch.envModels = patch.envModels
    configPatch.model     = patch.envModels[0]  // keep primary model in sync
  }

  const res = await doFetch(stub(env, id), 'config', 'PATCH', configPatch, identityHeader(req))

  // Keep KV metadata in sync for envModels changes
  if (res.ok && patch.envModels !== undefined && metadata) {
    const updatedMeta = { ...metadata, envModels: patch.envModels, model: patch.envModels[0] }
    void env.SANDBOX_REGISTRY.put(`${SANDBOX_KEY_PREFIX}${id}`, id, { expirationTtl: SANDBOX_TTL, metadata: updatedMeta })
  }

  return res
}

export const environmentRoutes: Array<[string, string, Handler]> = [
  ['POST',  '/api/environments',     createEnvironment],
  ['PATCH', '/api/environments/:id', patchEnvironment],
]
