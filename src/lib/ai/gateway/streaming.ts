import type { Env } from '../../../types/env'
import { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, AI_GATEWAY_TIMEOUT_MS } from '../../constants'
import { sseEvent } from '../../http'
import { type CompletionOpts, buildMessages } from '../messages'
import { type GatewayResult, gatewayBase } from './registry'
import { buildGatewayHeaders } from './shared'

const DEC = new TextDecoder()

// ── SSE streaming helpers ─────────────────────────────────────────────────────

// Fetches a streaming endpoint and yields decoded SSE response tokens.
async function* streamSSEFetch(
  url: string,
  init: RequestInit,
  extractToken: (parsed: unknown) => string | undefined,
): AsyncGenerator<string> {
  const res = await fetch(url, init)
  if (!res.ok || !res.body) throw new Error(`HTTP error ${res.status}`)
  const reader = res.body.getReader()
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += DEC.decode(value, { stream: true })
      const lines = buf.split('\n'); buf = lines.pop() ?? ''
      for (const line of lines) {
        const payload = line.trim().replace(/^data:\s*/, '')
        if (!payload || payload === '[DONE]') continue
        try {
          const text = extractToken(JSON.parse(payload))
          if (text) yield text
        } catch { /* skip malformed chunks */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// Wraps an async generator into a Workers-compatible ReadableStream of SSE events.
export function toReadableStream(gen: () => AsyncGenerator<string>): ReadableStream {
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const text of gen()) {
          controller.enqueue(encoder.encode(sseEvent({ response: text })))
        }
        controller.enqueue(encoder.encode(sseEvent({ done: true }, 'done')))
      } catch (e) {
        // Normalize provider errors — don't leak upstream status codes or messages
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

// ── Provider streaming (gateway) ──────────────────────────────────────────────

export function streamOpenAI(env: Env, gw: GatewayResult, opts: CompletionOpts): ReadableStream {
  const { id: modelId, def } = gw
  const wireModel = def.modelId ? def.modelId(modelId) : modelId
  const key = def.apiKey(env)
  const authH = def.authHeaders ? def.authHeaders(key) : { Authorization: `Bearer ${key}` }
  return toReadableStream(() => streamSSEFetch(
    `${gatewayBase(env)}${def.path(modelId)}`,
    {
      method: 'POST',
      headers: buildGatewayHeaders(authH, opts, wireModel),
      body: JSON.stringify({ model: wireModel, messages: buildMessages(opts), temperature: opts.temperature ?? DEFAULT_TEMPERATURE, max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS, stream: true }),
      signal: AbortSignal.timeout(AI_GATEWAY_TIMEOUT_MS),
    },
    (c: unknown) => (c as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content,
  ))
}

export function streamAnthropic(env: Env, gw: GatewayResult, opts: CompletionOpts): ReadableStream {
  const { id: model, def } = gw
  const key = def.apiKey(env)
  const authH = def.authHeaders ? def.authHeaders(key) : { 'x-api-key': key }
  const messages = buildMessages(opts).filter(m => m.role !== 'system')
  return toReadableStream(() => streamSSEFetch(
    `${gatewayBase(env)}${def.path(model)}`,
    {
      method: 'POST',
      headers: { ...buildGatewayHeaders(authH, opts, model), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, messages, ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}), max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS, temperature: opts.temperature ?? DEFAULT_TEMPERATURE, stream: true }),
      signal: AbortSignal.timeout(AI_GATEWAY_TIMEOUT_MS),
    },
    (c: unknown) => { const ch = c as { type?: string; delta?: { text?: string } }; return ch.type === 'content_block_delta' ? ch.delta?.text : undefined },
  ))
}

export function streamGoogle(env: Env, gw: GatewayResult, opts: CompletionOpts): ReadableStream {
  const { id: model, def } = gw
  const key = def.apiKey(env)
  const authH = def.authHeaders ? def.authHeaders(key) : { 'x-goog-api-key': key }
  const allMessages = buildMessages(opts)
  const system = allMessages.find(m => m.role === 'system')
  const contents = allMessages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature: opts.temperature ?? DEFAULT_TEMPERATURE, maxOutputTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS },
    ...(system ? { systemInstruction: { parts: [{ text: system.content }] } } : {}),
  }
  return toReadableStream(() => streamSSEFetch(
    `${gatewayBase(env)}/google-ai-studio/v1/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: buildGatewayHeaders(authH, opts, model),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_GATEWAY_TIMEOUT_MS),
    },
    (c: unknown) => (c as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.[0]?.text,
  ))
}

export function streamCohere(env: Env, gw: GatewayResult, opts: CompletionOpts): ReadableStream {
  const { id: modelId, def } = gw
  const key = def.apiKey(env)
  const authH = def.authHeaders ? def.authHeaders(key) : { Authorization: `Token ${key}` }
  const msgs = buildMessages(opts)
  const last = msgs[msgs.length - 1]
  const message = last?.content ?? opts.prompt ?? ''
  const chatHistory = msgs.slice(0, -1).map(m => ({ role: m.role === 'user' ? 'USER' : 'CHATBOT', message: m.content }))
  const body: Record<string, unknown> = {
    message,
    model: modelId,
    chat_history: chatHistory,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
    stream: true,
  }
  if (opts.systemPrompt) body.preamble = opts.systemPrompt
  return toReadableStream(() => streamSSEFetch(
    `${gatewayBase(env)}${def.path(modelId)}`,
    {
      method: 'POST',
      headers: buildGatewayHeaders(authH, opts, modelId),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_GATEWAY_TIMEOUT_MS),
    },
    (c: unknown) => { const ch = c as { event_type?: string; text?: string }; return ch.event_type === 'text-generation' ? ch.text : undefined },
  ))
}
