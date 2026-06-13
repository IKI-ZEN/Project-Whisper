import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, parseBody, rateLimitByIp } from '../lib/http'
import { complete, embed, cosineSimilarity } from '../lib/ai'
import { newId, isUUID, now } from '../lib/utils'
import { stub, doFetch } from '../lib/do'
import { REPLAY_RATE_LIMIT_MAX, REPLAY_RATE_LIMIT_WINDOW_MS } from '../lib/constants'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReplayMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: number
}

interface ReplayConfig {
  model?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}

interface ReplayRequest {
  messages: ReplayMessage[]
  targetConfig: ReplayConfig
  batchConfigs?: ReplayConfig[]
  batchEnvIds?: string[]     // resolve configs from environment IDs and run as batch
  batchSandboxIds?: string[] // resolve configs from sandbox IDs and run as batch
}

interface ReplayTurn {
  index: number
  userMessage: string
  originalResponse: string | null
  replayedResponse: string
  similarity: number | null
  latencyMs: number
}

interface ReplayResult {
  replayId: string
  targetConfig: ReplayConfig
  turns: ReplayTurn[]
  latencyMs: number
  createdAt: number
}

// ── Validation ────────────────────────────────────────────────────────────────

function parseReplayRequest(body: unknown): ReplayRequest {
  if (typeof body !== 'object' || body === null) throw new Error('Request body must be an object')
  const b = body as Record<string, unknown>

  if (!Array.isArray(b.messages)) throw new Error('messages must be an array')
  if (b.messages.length < 1 || b.messages.length > 200) throw new Error('messages must have 1–200 items')
  for (const m of b.messages) {
    if (typeof m !== 'object' || m === null) throw new Error('Each message must be an object')
    const msg = m as Record<string, unknown>
    if (!['user', 'assistant', 'system'].includes(msg.role as string)) {
      throw new Error('Each message role must be user, assistant, or system')
    }
    if (typeof msg.content !== 'string') throw new Error('Each message content must be a string')
  }

  if (typeof b.targetConfig !== 'object' || b.targetConfig === null) {
    throw new Error('targetConfig must be an object')
  }

  if (b.batchConfigs !== undefined) {
    if (!Array.isArray(b.batchConfigs)) throw new Error('batchConfigs must be an array')
    if (b.batchConfigs.length > 5) throw new Error('batchConfigs may have at most 5 items')
  }

  if (b.batchEnvIds !== undefined) {
    if (!Array.isArray(b.batchEnvIds)) throw new Error('batchEnvIds must be an array')
    if (b.batchEnvIds.length > 5) throw new Error('batchEnvIds may have at most 5 items')
    if (!b.batchEnvIds.every((id: unknown) => typeof id === 'string')) throw new Error('batchEnvIds must be strings')
  }

  if (b.batchSandboxIds !== undefined) {
    if (!Array.isArray(b.batchSandboxIds)) throw new Error('batchSandboxIds must be an array')
    if (b.batchSandboxIds.length > 5) throw new Error('batchSandboxIds may have at most 5 items')
    if (!b.batchSandboxIds.every((id: unknown) => typeof id === 'string')) throw new Error('batchSandboxIds must be strings')
  }

  return {
    messages:        b.messages        as ReplayMessage[],
    targetConfig:    b.targetConfig    as ReplayConfig,
    batchConfigs:    b.batchConfigs    as ReplayConfig[] | undefined,
    batchEnvIds:     b.batchEnvIds     as string[]       | undefined,
    batchSandboxIds: b.batchSandboxIds as string[]       | undefined,
  }
}

// ── Core replay logic ─────────────────────────────────────────────────────────

async function runReplay(
  env: Env,
  messages: ReplayMessage[],
  config: ReplayConfig,
): Promise<{ turns: ReplayTurn[]; latencyMs: number }> {
  const t0 = now()

  // Extract user turns with their index in the original message list
  const userTurns: Array<{ originalIndex: number; userMessage: string; originalResponse: string | null }> = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') {
      // Look for the next assistant turn as the original response
      let originalResponse: string | null = null
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === 'assistant') {
          originalResponse = messages[j].content
          break
        }
        if (messages[j].role === 'user') break  // next user turn — no assistant response
      }
      userTurns.push({ originalIndex: i, userMessage: messages[i].content, originalResponse })
    }
  }

  const turns: ReplayTurn[] = []
  // Accumulate replayed conversation context as we go
  const replayContext: Array<{ role: string; content: string }> = []

  for (let idx = 0; idx < userTurns.length; idx++) {
    const { userMessage, originalResponse } = userTurns[idx]
    const turnStart = now()

    // Add this user message to the context
    replayContext.push({ role: 'user', content: userMessage })

    const replayedResponse = await complete(env.AI, env, {
      model: config.model,
      systemPrompt: config.systemPrompt,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 512,
      messages: replayContext.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        timestamp: now(),
      })),
    })

    const latencyMs = now() - turnStart

    // Compute cosine similarity between original and replayed response
    let similarity: number | null = null
    if (originalResponse !== null) {
      try {
        const embeddings = await embed(env.AI, [replayedResponse, originalResponse], undefined, env)
        if (embeddings.length >= 2 && embeddings[0] && embeddings[1]) {
          similarity = cosineSimilarity(embeddings[0], embeddings[1])
        }
      } catch { /* similarity not available */ }
    }

    turns.push({
      index: idx,
      userMessage,
      originalResponse,
      replayedResponse,
      similarity,
      latencyMs,
    })

    // Add replayed assistant response to context for subsequent turns
    replayContext.push({ role: 'assistant', content: replayedResponse })
  }

  return { turns, latencyMs: now() - t0 }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

const postReplay: Handler = async (req, env) => {
  const rl = await rateLimitByIp(req, env, 'rl:replay', REPLAY_RATE_LIMIT_MAX, REPLAY_RATE_LIMIT_WINDOW_MS)
  if (rl) return rl
  const p = await parseBody(req, parseReplayRequest)
  if (!p.ok) return p.response

  const { messages, targetConfig, batchConfigs: explicitBatch, batchEnvIds, batchSandboxIds } = p.data
  const replayId = newId()

  // Resolve environment configs into ReplayConfigs when batchEnvIds is provided
  let resolvedEnvConfigs: ReplayConfig[] = []
  if (batchEnvIds && batchEnvIds.length > 0) {
    resolvedEnvConfigs = (await Promise.all(
      batchEnvIds.map(async (envId) => {
        if (!isUUID(envId)) return null
        try {
          const res  = await doFetch(stub(env, envId), 'config', 'GET')
          const body = await res.json() as { ok: boolean; data?: { model?: string; systemPrompt?: string; temperature?: number; maxTokens?: number } }
          if (!body.ok || !body.data) return null
          return {
            model:        body.data.model,
            systemPrompt: body.data.systemPrompt,
            temperature:  body.data.temperature,
            maxTokens:    body.data.maxTokens,
          } as ReplayConfig
        } catch { return null }
      }),
    )).filter((c): c is ReplayConfig => c !== null)
  }

  // Resolve sandbox configs into ReplayConfigs when batchSandboxIds is provided
  let resolvedSandboxConfigs: ReplayConfig[] = []
  if (batchSandboxIds && batchSandboxIds.length > 0) {
    resolvedSandboxConfigs = (await Promise.all(
      batchSandboxIds.map(async (sandboxId) => {
        if (!isUUID(sandboxId)) return null
        try {
          const res  = await doFetch(stub(env, sandboxId), 'config', 'GET')
          const body = await res.json() as { ok: boolean; data?: { model?: string; systemPrompt?: string; temperature?: number; maxTokens?: number } }
          if (!body.ok || !body.data) return null
          return {
            model:        body.data.model,
            systemPrompt: body.data.systemPrompt,
            temperature:  body.data.temperature,
            maxTokens:    body.data.maxTokens,
          } as ReplayConfig
        } catch { return null }
      }),
    )).filter((c): c is ReplayConfig => c !== null)
  }

  const batchConfigs = [...(explicitBatch ?? []), ...resolvedEnvConfigs, ...resolvedSandboxConfigs]

  try {
    if (batchConfigs && batchConfigs.length > 0) {
      // Batch mode — run all configs in parallel
      const allConfigs = [targetConfig, ...batchConfigs]
      const allResults = await Promise.all(
        allConfigs.map(async (config) => {
          const { turns, latencyMs } = await runReplay(env, messages, config)
          const result: ReplayResult = {
            replayId: newId(),
            targetConfig: config,
            turns,
            latencyMs,
            createdAt: now(),
          }
          return result
        }),
      )

      // Store the batch under the primary replayId
      await env.FILES.put(
        `replays/${replayId}.json`,
        JSON.stringify({ replayId, results: allResults }),
        { httpMetadata: { contentType: 'application/json' } },
      )

      return json(ok({ replayId, results: allResults }))
    } else {
      // Single config mode
      const { turns, latencyMs } = await runReplay(env, messages, targetConfig)
      const result: ReplayResult = {
        replayId,
        targetConfig,
        turns,
        latencyMs,
        createdAt: now(),
      }

      await env.FILES.put(
        `replays/${replayId}.json`,
        JSON.stringify(result),
        { httpMetadata: { contentType: 'application/json' } },
      )

      return json(ok({ replayId, result }))
    }
  } catch (e) {
    return json(err('Replay failed', String(e)), 500)
  }
}

const getReplay: Handler = async (_req, env, params) => {
  if (!params.id || !isUUID(params.id)) return json(err('Invalid id'), 422)
  try {
    const obj = await env.FILES.get(`replays/${params.id}.json`)
    if (!obj) return json(err('Replay not found'), 404)
    const data = await obj.json()
    return json(ok(data))
  } catch (e) {
    return json(err('Failed to retrieve replay', String(e)), 500)
  }
}

// ── Route table ───────────────────────────────────────────────────────────────

export const replayRoutes: Array<[string, string, Handler]> = [
  ['POST', '/api/replay',     postReplay],
  ['GET',  '/api/replay/:id', getReplay],
]
