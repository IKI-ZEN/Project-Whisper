import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, parseBody, checkRateLimit } from '../lib/http'
import { generateEnvConfig } from '../lib/ai'
import { parseEnvironmentRequest, type SandboxConfig } from '../lib/schema'
import { newId, now } from '../lib/utils'
import { registerSandbox, stub, doFetch, identityHeader } from './sandbox'
import { SANDBOX_CREATE_RATE_LIMIT_MAX, SANDBOX_CREATE_RATE_LIMIT_WINDOW } from '../lib/constants'

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
    model:        envConfig.model,
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

export const environmentRoutes: Array<[string, string, Handler]> = [
  ['POST', '/api/environments', createEnvironment],
]
