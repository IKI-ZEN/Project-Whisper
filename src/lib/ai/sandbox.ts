// ── Sandbox-aware run ─────────────────────────────────────────────────────────

import type { Env } from '../../types/env'
import type { SandboxConfig } from '../schema'
import { sseEvent } from '../http'
import { now } from '../utils'
import { complete, completeStream, embed } from './complete'

export async function runInSandbox(ai: Ai, env: Env, config: SandboxConfig, userMessage: string): Promise<string> {
  return complete(ai, env, {
    model: config.model,
    systemPrompt: config.systemPrompt,
    messages: [
      ...config.memory,
      { role: 'user', content: userMessage, timestamp: now() },
    ],
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    tools: config.tools?.length ? config.tools : undefined,
    sandboxId: config.id,
  })
}

export function streamInSandbox(ai: Ai, env: Env, config: SandboxConfig, userMessage: string): ReadableStream {
  return completeStream(ai, env, {
    model: config.model,
    systemPrompt: config.systemPrompt,
    messages: [
      ...config.memory,
      { role: 'user', content: userMessage, timestamp: now() },
    ],
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    sandboxId: config.id,
    // tools intentionally omitted from streaming — use /run for tool calls
  })
}

// ── RAG-augmented sandbox run ─────────────────────────────────────────────────

export async function runInSandboxWithRAG(
  ai: Ai, env: Env, config: SandboxConfig, userMessage: string,
): Promise<string> {
  if (!config.ragEnabled) return runInSandbox(ai, env, config, userMessage)

  // Embed user message and retrieve relevant document chunks scoped to this sandbox
  const [[queryVec]] = await embed(ai, userMessage, undefined, env)
  if (!queryVec) return runInSandbox(ai, env, config, userMessage)

  const results = await (env.VECTORS as VectorizeIndex).query(queryVec as unknown as number[], {
    topK: 5,
    returnMetadata: 'all',
    filter: { sandboxId: config.id } as Record<string, string>,
  })

  const context = results.matches
    .map(m => ((m.metadata ?? {}) as { text?: string }).text ?? '')
    .filter(Boolean)
    .join('\n\n')

  const augmented = context.length > 0
    ? `${userMessage}\n\n--- Relevant context from your documents ---\n${context}`
    : userMessage

  return runInSandbox(ai, env, config, augmented)
}

export function streamInSandboxWithRAG(ai: Ai, env: Env, config: SandboxConfig, userMessage: string): ReadableStream {
  // RAG requires an async embed query before streaming — run RAG augmentation first
  // then delegate to the standard stream function with the augmented message
  if (!config.ragEnabled) return streamInSandbox(ai, env, config, userMessage)

  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      try {
        const [[queryVec]] = await embed(ai, userMessage, undefined, env)
        let augmented = userMessage
        if (queryVec) {
          const results = await (env.VECTORS as VectorizeIndex).query(queryVec as unknown as number[], {
            topK: 5,
            returnMetadata: 'all',
            filter: { sandboxId: config.id } as Record<string, string>,
          })
          const context = results.matches
            .map(m => ((m.metadata ?? {}) as { text?: string }).text ?? '')
            .filter(Boolean)
            .join('\n\n')
          if (context.length > 0) {
            augmented = `${userMessage}\n\n--- Relevant context from your documents ---\n${context}`
          }
        }

        const downstream = streamInSandbox(ai, env, config, augmented)
        const reader = downstream.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          controller.enqueue(value instanceof Uint8Array ? value : encoder.encode(String(value)))
        }
      } catch (e) {
        const safeMsg = e instanceof Error && /^\d{3}/.test(e.message)
          ? 'AI provider temporarily unavailable'
          : 'AI inference failed'
        controller.enqueue(encoder.encode(sseEvent({ error: safeMsg }, 'error')))
      } finally {
        controller.close()
      }
    },
  })
}
