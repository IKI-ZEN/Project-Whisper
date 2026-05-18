import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, readJson } from '../lib/http'
import { generateVibeConfig } from '../lib/ai'
import { parseVibeRequest, type SandboxConfig } from '../lib/schema'
import { newId, now } from '../lib/utils'

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
  let body: unknown
  try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
  let parsed
  try { parsed = parseVibeRequest(body) } catch (e) { return json(err(String(e)), 422) }

  let vibeConfig
  try {
    vibeConfig = await generateVibeConfig(env.AI, parsed.description, parsed.name)
  } catch (e) {
    return json(err('Vibe generation failed — try a more detailed description', String(e)), 500)
  }

  if (!vibeConfig.systemPrompt || !vibeConfig.name) {
    return json(err('Generated config was invalid — try a more detailed description'), 422)
  }

  const id = newId()
  const ts = now()
  const config: SandboxConfig = { ...vibeConfig, id, memory: [], createdAt: ts, updatedAt: ts }

  // Initialise the Durable Object
  const doId = env.SANDBOX.idFromName(id)
  const s = env.SANDBOX.get(doId)
  await s.fetch('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })

  // Register in KV
  await env.SANDBOX_REGISTRY.put(
    `sandbox:${id}`,
    JSON.stringify({ id, name: config.name, createdAt: ts, fromVibe: true }),
    { expirationTtl: 604800 },
  )

  // Audit log
  await env.DB.prepare(
    'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)',
  ).bind(id, 'vibe_created', JSON.stringify({ description: parsed.description.slice(0, 256) }), ts).run()

  return json(ok({
    sandboxId: id,
    name:      config.name,
    description: config.description,
    model:     config.model,
    run:       `/api/sandbox/${id}/run`,
    stream:    `/api/sandbox/${id}/stream`,
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
