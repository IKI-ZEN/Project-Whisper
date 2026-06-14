import type { Handler } from '../lib/http'
import { json, ok, err, parseBody, rateLimitByIp, readIdentity } from '../lib/http'
import { generateVibeConfig } from '../lib/ai'
import { parseVibeRequest, type SandboxConfig } from '../lib/schema'
import { newId, now } from '../lib/utils'
import { registerSandbox, stub, doFetch, identityHeader } from '../lib/do'
import { EMBED_WIDTH, EMBED_HEIGHT, VIBE_CREATE_RATE_LIMIT_MAX, VIBE_CREATE_RATE_LIMIT_WINDOW_MS } from '../lib/constants'
import { logSandboxEvent } from '../lib/events'

const TEMPLATES = [
  { id: 'customer-support',  name: 'Customer Support Bot',   tags: ['support', 'chat'],    description: 'Handles FAQs and routes issues to the right team' },
  { id: 'pdf-summarizer',    name: 'PDF Summarizer',          tags: ['docs', 'rag'],         description: 'Summarises documents and answers questions about them' },
  { id: 'code-reviewer',     name: 'Code Reviewer',           tags: ['code', 'developer'],   description: 'Reviews code for bugs, style, and improvements' },
  { id: 'creative-writer',   name: 'Creative Writer',         tags: ['creative', 'content'], description: 'Generates stories, poems, and creative content' },
  { id: 'data-analyst',      name: 'Data Analyst',            tags: ['data', 'insights'],    description: 'Explains data and surfaces insights in plain language' },
]

const listTemplates: Handler = (_req, _env) =>
  Promise.resolve(json(ok({ templates: TEMPLATES })))

const createVibe: Handler = async (req, env) => {
  const rl = await rateLimitByIp(req, env, 'rl:vibe-create', VIBE_CREATE_RATE_LIMIT_MAX, VIBE_CREATE_RATE_LIMIT_WINDOW_MS)
  if (rl) return rl
  const p = await parseBody(req, parseVibeRequest)
  if (!p.ok) return p.response
  const { description, name, mode = 'app' } = p.data
  const isEnvironment = mode === 'environment'

  let vibeConfig
  try {
    vibeConfig = await generateVibeConfig(env.AI, env, description, name, mode)
  } catch (e) {
    return json(err('Vibe generation failed — try a more detailed description', String(e)), 500)
  }

  if (!vibeConfig.systemPrompt || !vibeConfig.name) {
    return json(err('Generated config was invalid — try a more detailed description'), 422)
  }

  const id       = newId()
  const ts       = now()
  const identity = readIdentity(req)
  const config: SandboxConfig = { ...vibeConfig, id, memory: [], createdAt: ts, updatedAt: ts }

  await doFetch(stub(env, id), 'init', 'POST', config, identityHeader(req))

  await registerSandbox(env, {
    id,
    name:          config.name,
    description:   config.description.slice(0, 200),
    model:         config.model,
    createdAt:     ts,
    fromVibe:      true,
    ...(isEnvironment ? { fromEnv: true } : {}),
  })

  await logSandboxEvent(env, {
    sandboxId: id,
    type:      isEnvironment ? 'env_created' : 'vibe_created',
    metadata:  { description: description.slice(0, 256), mode },
    identity,
    at:        ts,
  })

  const baseUrl   = isEnvironment ? `/env/${id}` : `/app/${id}`
  const embedCode = `<iframe src="${baseUrl}" width="${EMBED_WIDTH}" height="${EMBED_HEIGHT}" frameborder="0" allow="microphone"></iframe>`

  return json(ok({
    sandboxId:   id,
    mode,
    name:        config.name,
    description: config.description,
    model:       config.model,
    ...(isEnvironment ? { envUrl: `/env/${id}` } : { appUrl: `/app/${id}` }),
    shortLink:   `/s/${id}`,
    embedCode,
    shortApi: {
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

export const vibeRoutes: Array<[string, string, Handler]> = [
  ['GET',  '/api/vibes',    listTemplates],
  ['POST', '/api/vibes',    createVibe],
]
