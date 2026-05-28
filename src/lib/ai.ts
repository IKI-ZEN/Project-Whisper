import type { Env } from '../types/env'
import type { Message, SandboxConfig, Tool } from './schema'
import { sseEvent } from './http'
import { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, MAX_EMBED_CHARS } from './constants'
import { sha256 } from './utils'

// ── Model registry ────────────────────────────────────────────────────────────

export const MODELS = {
  // Workers AI
  text:        '@cf/meta/llama-3.1-8b-instruct',
  textLarge:   '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  embed:       '@cf/baai/bge-base-en-v1.5',
  image:       '@cf/black-forest-labs/flux-1-schnell',
  transcribe:  '@cf/openai/whisper',
  // Flagship via AI Gateway
  gpt4o:       'openai:gpt-4o',
  gpt4oMini:   'openai:gpt-4o-mini',
  claude:      'anthropic:claude-sonnet-4-6',
  claudeOpus:  'anthropic:claude-opus-4-7',
  gemini:      'google:gemini-2.0-flash',
} as const

// ── Gateway routing ───────────────────────────────────────────────────────────

function parseGateway(model: string):
  | { provider: 'openai' | 'anthropic' | 'google'; id: string }
  | null {
  const sep = model.indexOf(':')
  if (sep === -1) return null
  const p = model.slice(0, sep)
  if (!(p === 'openai' || p === 'anthropic' || p === 'google')) return null
  const id = model.slice(sep + 1)
  // Strict allowlist — only alphanumeric, hyphens, dots, and underscores.
  // Prevents path traversal in URL-templated gateway calls (e.g. google endpoint).
  if (!/^[a-zA-Z0-9][\w.\-]*$/.test(id)) return null
  return { provider: p as 'openai' | 'anthropic' | 'google', id }
}

function gatewayBase(env: Env): string {
  const { CLOUDFLARE_ACCOUNT_ID: acct, AI_GATEWAY_ID: gw } = env
  if (!acct || !gw) throw new Error(
    'AI Gateway not configured — set CLOUDFLARE_ACCOUNT_ID and AI_GATEWAY_ID',
  )
  return `https://gateway.ai.cloudflare.com/v1/${acct}/${gw}`
}

// ── Internal Workers AI run helper ────────────────────────────────────────────

// Workers AI's run() is overloaded for specific model/input pairs.
// We cast to a generic form to support dynamic model strings.
type AiRun = (model: string, inputs: Record<string, unknown>) => Promise<unknown>

function run(ai: Ai): AiRun {
  return (ai.run as unknown as AiRun).bind(ai)
}

// ── Tool call encoding (provider-agnostic wire format) ────────────────────────

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

// Messages whose content starts with this prefix are tool results sent by the client
const TOOL_RESULT_PREFIX = '__TOOL_RESULT__:'

export function encodeToolResult(toolUseId: string, toolName: string, content: string): string {
  return TOOL_RESULT_PREFIX + JSON.stringify({ toolUseId, toolName, content })
}

function decodeToolResult(s: string): { toolUseId: string; toolName: string; content: string } | null {
  if (!s.startsWith(TOOL_RESULT_PREFIX)) return null
  try { return JSON.parse(s.slice(TOOL_RESULT_PREFIX.length)) } catch { return null }
}

function encodeToolCalls(calls: ToolCall[]): string {
  return JSON.stringify({ __tool_calls__: calls })
}

export function isToolCallReply(reply: string): boolean {
  try { const o = JSON.parse(reply); return Array.isArray((o as Record<string, unknown>).__tool_calls__) } catch { return false }
}

export function decodeToolCalls(reply: string): ToolCall[] {
  try {
    const o = JSON.parse(reply) as { __tool_calls__?: ToolCall[] }
    return Array.isArray(o.__tool_calls__) ? o.__tool_calls__ : []
  } catch { return [] }
}

// ── Provider-specific tool converters ─────────────────────────────────────────

function toAnthropicTool(t: Tool): Record<string, unknown> {
  const required = Object.entries(t.parameters).filter(([, p]) => p.required).map(([k]) => k)
  return {
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(t.parameters).map(([k, p]) => [k, { type: p.type, description: p.description }]),
      ),
      required,
    },
  }
}

function toOpenAITool(t: Tool): Record<string, unknown> {
  const required = Object.entries(t.parameters).filter(([, p]) => p.required).map(([k]) => k)
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, p]) => [k, { type: p.type, description: p.description }]),
        ),
        required,
      },
    },
  }
}

function toGoogleFunctionDeclaration(t: Tool): Record<string, unknown> {
  return {
    name: t.name,
    description: t.description,
    parameters: {
      type: 'OBJECT',
      properties: Object.fromEntries(
        Object.entries(t.parameters).map(([k, p]) => [k, { type: p.type.toUpperCase(), description: p.description }]),
      ),
      required: Object.entries(t.parameters).filter(([, p]) => p.required).map(([k]) => k),
    },
  }
}

// ── Shared message builder ────────────────────────────────────────────────────

export interface CompletionOpts {
  model?: string
  prompt?: string
  messages?: Message[]
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  // Advanced features
  tools?: Tool[]                              // tool definitions — wired to all providers
  toolChoice?: 'auto' | 'required' | 'none'  // OpenAI/Anthropic tool_choice
  responseFormat?: 'json' | 'text'           // 'json' → JSON mode (OpenAI / Workers AI)
  thinking?: number                          // Anthropic: budget_tokens; >0 enables extended thinking
  reasoningEffort?: 'low' | 'medium' | 'high' // OpenAI o-series reasoning effort
  sandboxId?: string                         // passed as cf-aig-metadata for observability
  groundingEnabled?: boolean                 // Google: enable google_search_retrieval
}

// Build plain text messages for streaming and Workers AI (no tool history support needed)
function buildMessages(opts: CompletionOpts): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = []
  if (opts.systemPrompt) out.push({ role: 'system', content: opts.systemPrompt })
  if (opts.messages?.length) {
    for (const m of opts.messages) out.push({ role: m.role, content: m.content })
  } else if (opts.prompt) {
    out.push({ role: 'user', content: opts.prompt })
  }
  return out
}

// Build Anthropic-format messages, converting tool call/result encoding in history
function buildAnthropicMessages(opts: CompletionOpts): Array<Record<string, unknown>> {
  const raw = buildMessages(opts)
  const out: Array<Record<string, unknown>> = []
  for (const m of raw) {
    if (m.role === 'system') continue  // handled separately as top-level system field
    const tr = decodeToolResult(m.content)
    if (tr && m.role === 'user') {
      // Convert tool result back to Anthropic tool_result content block
      out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: tr.toolUseId, content: tr.content }] })
      continue
    }
    if (isToolCallReply(m.content) && m.role === 'assistant') {
      // Convert stored tool call back to Anthropic tool_use content blocks
      const calls = decodeToolCalls(m.content)
      out.push({ role: 'assistant', content: calls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })) })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out
}

// Build OpenAI-format messages, converting tool call/result encoding in history
function buildOpenAIMessages(opts: CompletionOpts): Array<Record<string, unknown>> {
  const raw = buildMessages(opts)
  const out: Array<Record<string, unknown>> = []
  for (const m of raw) {
    const tr = decodeToolResult(m.content)
    if (tr && m.role === 'user') {
      // OpenAI tool result goes as role: 'tool'
      out.push({ role: 'tool', tool_call_id: tr.toolUseId, content: tr.content })
      continue
    }
    if (isToolCallReply(m.content) && m.role === 'assistant') {
      const calls = decodeToolCalls(m.content)
      out.push({
        role: 'assistant',
        content: null,
        tool_calls: calls.map(c => ({
          id: c.id, type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input) },
        })),
      })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out
}

// ── Provider completions (gateway) ────────────────────────────────────────────

async function completeOpenAI(env: Env, model: string, opts: CompletionOpts): Promise<string> {
  const temp = opts.temperature ?? DEFAULT_TEMPERATURE
  // o-series reasoning models use different params
  const isReasoning = /^o[1-9]/.test(model)
  const body: Record<string, unknown> = {
    model,
    messages: buildOpenAIMessages(opts),
    ...(isReasoning
      ? { max_completion_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS, ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}) }
      : { temperature: temp, max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS }
    ),
    ...(opts.responseFormat === 'json' && !isReasoning ? { response_format: { type: 'json_object' } } : {}),
  }
  if (opts.tools?.length) {
    body.tools = opts.tools.map(toOpenAITool)
    if (opts.toolChoice) body.tool_choice = opts.toolChoice
  }
  const metaHeaders: Record<string, string> = {}
  if (opts.sandboxId) metaHeaders['cf-aig-metadata'] = JSON.stringify({ sandboxId: opts.sandboxId, model })
  const res = await fetch(`${gatewayBase(env)}/openai/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY ?? ''}`,
      'cf-aig-cache-ttl':  '3600',
      'cf-aig-skip-cache': temp !== 0 ? 'true' : 'false',
      ...metaHeaders,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`OpenAI gateway error ${res.status}: ${await res.text()}`)
  type OAIResp = { choices: Array<{ finish_reason: string; message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> }
  const data = await res.json() as OAIResp
  const choice = data.choices[0]
  if (choice?.message?.tool_calls?.length) {
    return encodeToolCalls(choice.message.tool_calls.map(tc => ({
      id: tc.id, name: tc.function.name,
      input: (() => { try { return JSON.parse(tc.function.arguments) as Record<string, unknown> } catch { return {} } })(),
    })))
  }
  return choice?.message?.content ?? ''
}

async function completeAnthropic(env: Env, model: string, opts: CompletionOpts): Promise<string> {
  const temp = opts.temperature ?? DEFAULT_TEMPERATURE
  const messages = buildAnthropicMessages(opts)
  // thinking mode requires temperature=1
  const effectiveTemp = opts.thinking && opts.thinking > 0 ? 1 : temp
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: effectiveTemp,
    // Prompt caching: wrap system prompt as a cacheable content block
    ...(opts.systemPrompt
      ? { system: [{ type: 'text', text: opts.systemPrompt, cache_control: { type: 'ephemeral' } }] }
      : {}),
    ...(opts.thinking && opts.thinking > 0
      ? { thinking: { type: 'enabled', budget_tokens: opts.thinking } }
      : {}),
  }
  if (opts.tools?.length) {
    body.tools = opts.tools.map(toAnthropicTool)
    if (opts.toolChoice) body.tool_choice = { type: opts.toolChoice }
  }
  const anthHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': env.ANTHROPIC_API_KEY ?? '',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'prompt-caching-2024-07-31',
    'cf-aig-cache-ttl':  temp === 0 ? '3600' : '300',
    'cf-aig-skip-cache': temp !== 0 ? 'true' : 'false',
  }
  if (opts.sandboxId) anthHeaders['cf-aig-metadata'] = JSON.stringify({ sandboxId: opts.sandboxId, model })
  const res = await fetch(`${gatewayBase(env)}/anthropic/v1/messages`, {
    method: 'POST',
    headers: anthHeaders,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Anthropic gateway error ${res.status}: ${await res.text()}`)
  type AnthResp = {
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'thinking'; thinking: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    >
  }
  const data = await res.json() as AnthResp
  const toolCalls = data.content
    .filter(c => c.type === 'tool_use')
    .map(c => { const tc = c as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }; return { id: tc.id, name: tc.name, input: tc.input } })
  if (toolCalls.length) return encodeToolCalls(toolCalls)

  const thinking = data.content.filter(c => c.type === 'thinking').map(c => (c as { type: 'thinking'; thinking: string }).thinking).join('')
  const text     = data.content.filter(c => c.type === 'text').map(c => (c as { type: 'text'; text: string }).text).join('')
  return thinking ? `<thinking>\n${thinking}\n</thinking>\n\n${text}` : text
}

async function completeGoogle(env: Env, model: string, opts: CompletionOpts): Promise<string> {
  const allMessages = buildMessages(opts)
  const system = allMessages.find(m => m.role === 'system')
  const contents = allMessages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
  const temp = opts.temperature ?? DEFAULT_TEMPERATURE
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: temp,
      maxOutputTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(opts.responseFormat === 'json' ? { responseMimeType: 'application/json' } : {}),
    },
    ...(system ? { systemInstruction: { parts: [{ text: system.content }] } } : {}),
    ...(opts.groundingEnabled ? { tools: [{ googleSearch: {} }] } : opts.tools?.length
      ? { tools: [{ functionDeclarations: opts.tools.map(toGoogleFunctionDeclaration) }] }
      : {}),
  }
  const googleHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'cf-aig-cache-ttl':  '3600',
    'cf-aig-skip-cache': temp !== 0 ? 'true' : 'false',
  }
  if (opts.sandboxId) googleHeaders['cf-aig-metadata'] = JSON.stringify({ sandboxId: opts.sandboxId, model })
  if (env.GOOGLE_AI_KEY) googleHeaders['x-goog-api-key'] = env.GOOGLE_AI_KEY
  const res = await fetch(
    `${gatewayBase(env)}/google-ai-studio/v1/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: googleHeaders,
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) throw new Error(`Google gateway error ${res.status}: ${await res.text()}`)
  type GoogleResp = { candidates: Array<{ content: { parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> } }> }
  const data = await res.json() as GoogleResp
  const parts = data.candidates[0]?.content?.parts ?? []
  const funcCalls = parts.filter(p => p.functionCall).map((p, i) => ({
    id: `gcall_${i}`, name: p.functionCall!.name, input: p.functionCall!.args,
  }))
  if (funcCalls.length) return encodeToolCalls(funcCalls)
  return parts.filter(p => p.text).map(p => p.text).join('') ?? ''
}

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
  const dec = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
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
function toReadableStream(gen: () => AsyncGenerator<string>): ReadableStream {
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

function streamOpenAI(env: Env, model: string, opts: CompletionOpts): ReadableStream {
  return toReadableStream(() => streamSSEFetch(
    `${gatewayBase(env)}/openai/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY ?? ''}` },
      body: JSON.stringify({ model, messages: buildMessages(opts), temperature: opts.temperature ?? DEFAULT_TEMPERATURE, max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS, stream: true }),
    },
    (c: unknown) => (c as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content,
  ))
}

function streamAnthropic(env: Env, model: string, opts: CompletionOpts): ReadableStream {
  const messages = buildMessages(opts).filter(m => m.role !== 'system')
  return toReadableStream(() => streamSSEFetch(
    `${gatewayBase(env)}/anthropic/v1/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, messages, ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}), max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS, temperature: opts.temperature ?? DEFAULT_TEMPERATURE, stream: true }),
    },
    (c: unknown) => { const ch = c as { type?: string; delta?: { text?: string } }; return ch.type === 'content_block_delta' ? ch.delta?.text : undefined },
  ))
}

function streamGoogle(env: Env, model: string, opts: CompletionOpts): ReadableStream {
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
    `${gatewayBase(env)}/google-ai-studio/v1/models/${model}:streamGenerateContent?alt=sse&key=${env.GOOGLE_AI_KEY ?? ''}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    (c: unknown) => (c as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.[0]?.text,
  ))
}

// ── Public complete ───────────────────────────────────────────────────────────

export async function complete(ai: Ai, env: Env, opts: CompletionOpts): Promise<string> {
  const t0 = Date.now()
  const gw = parseGateway(opts.model ?? '')
  let result: string
  if (gw) {
    if (gw.provider === 'openai')    result = await completeOpenAI(env, gw.id, opts)
    else if (gw.provider === 'anthropic') result = await completeAnthropic(env, gw.id, opts)
    else result = await completeGoogle(env, gw.id, opts)
  } else {
    const response = await run(ai)(opts.model ?? MODELS.text, {
      messages: buildMessages(opts),
      temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(opts.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
    })
    result = (response as { response?: string }).response ?? String(response)
  }
  if (env.ANALYTICS) {
    env.ANALYTICS.writeDataPoint({
      blobs:   [opts.model ?? MODELS.text, opts.sandboxId ?? '', gw?.provider ?? 'workers-ai'],
      doubles: [0, 0, Date.now() - t0],
      indexes: [opts.sandboxId ?? 'anon'],
    })
  }
  return result
}

// ── Extended thinking ─────────────────────────────────────────────────────────

export interface ThinkResult {
  thinking: string
  response: string
  latencyMs: number
}

export async function think(ai: Ai, env: Env, opts: CompletionOpts & { budgetTokens?: number }): Promise<ThinkResult> {
  const t0 = Date.now()
  const gw = parseGateway(opts.model ?? '')
  let raw: string
  if (gw?.provider === 'anthropic') {
    raw = await completeAnthropic(env, gw.id, { ...opts, thinking: opts.budgetTokens ?? 8000, temperature: 1 })
  } else {
    // Fallback: prompt the model to think step-by-step and wrap its thinking in XML
    raw = await complete(ai, env, {
      ...opts,
      systemPrompt: `${opts.systemPrompt ? opts.systemPrompt + '\n\n' : ''}Before answering, reason through your thinking in <thinking>...</thinking> tags, then provide your final answer.`,
    })
  }
  const thinkMatch = raw.match(/<thinking>([\s\S]*?)<\/thinking>/s)
  const thinking = thinkMatch?.[1]?.trim() ?? ''
  const response = raw.replace(/<thinking>[\s\S]*?<\/thinking>\n?\n?/s, '').trim()
  return { thinking, response, latencyMs: Date.now() - t0 }
}

// ── Public streaming completion ───────────────────────────────────────────────

export function completeStream(ai: Ai, env: Env, opts: CompletionOpts): ReadableStream {
  const gw = parseGateway(opts.model ?? '')
  if (gw) {
    if (gw.provider === 'openai')    return streamOpenAI(env, gw.id, opts)
    if (gw.provider === 'anthropic') return streamAnthropic(env, gw.id, opts)
    return streamGoogle(env, gw.id, opts)
  }

  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      try {
        const aiStream = await run(ai)(opts.model ?? MODELS.text, {
          messages: buildMessages(opts),
          temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
          max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
          stream: true,
        }) as ReadableStream

        const reader = aiStream.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          controller.enqueue(value instanceof Uint8Array ? value : encoder.encode(String(value)))
        }
        controller.enqueue(encoder.encode(sseEvent({ done: true }, 'done')))
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

// ── Embeddings ────────────────────────────────────────────────────────────────

export async function embed(ai: Ai, text: string | string[], model?: string): Promise<number[][]> {
  const texts = Array.isArray(text) ? text : [text]
  const totalLen = texts.reduce((n, t) => n + t.length, 0)
  if (totalLen > MAX_EMBED_CHARS) throw new Error(`Embedding input exceeds ${MAX_EMBED_CHARS} characters`)

  // Cache embeddings — deterministic, expensive, safe to cache for 24h
  const cacheKey = new Request(`https://whisper-cache/embed/${await sha256(JSON.stringify([model ?? MODELS.embed, texts]))}`)
  const cached = await caches.default.match(cacheKey)
  if (cached) return cached.json() as Promise<number[][]>

  const response = await run(ai)(model ?? MODELS.embed, { text: texts })
  const r = response as { data?: number[][] }
  const result = r.data ?? []

  void caches.default.put(cacheKey, new Response(JSON.stringify(result), {
    headers: { 'Cache-Control': 'max-age=86400', 'Content-Type': 'application/json' },
  }))

  return result
}

// ── Image generation ──────────────────────────────────────────────────────────

export async function generateImage(ai: Ai, prompt: string, model?: string, steps?: number): Promise<Uint8Array> {
  const response = await run(ai)(model ?? MODELS.image, {
    prompt,
    num_steps: steps ?? 4,
  })

  if (response instanceof ArrayBuffer) return new Uint8Array(response)
  if (response instanceof Uint8Array) return response
  const r = response as { image?: string }
  if (typeof r.image === 'string') {
    const binary = atob(r.image)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  throw new Error('Unexpected image response format from Workers AI')
}

// ── Audio transcription ───────────────────────────────────────────────────────

export async function transcribe(ai: Ai, audio: ArrayBuffer, model?: string): Promise<string> {
  const response = await run(ai)(model ?? MODELS.transcribe, {
    audio: [...new Uint8Array(audio)],
  })
  const r = response as { text?: string }
  return r.text ?? ''
}

// ── Sandbox-aware run ─────────────────────────────────────────────────────────

export async function runInSandbox(ai: Ai, env: Env, config: SandboxConfig, userMessage: string): Promise<string> {
  return complete(ai, env, {
    model: config.model,
    systemPrompt: config.systemPrompt,
    messages: [
      ...config.memory,
      { role: 'user', content: userMessage, timestamp: Date.now() },
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
      { role: 'user', content: userMessage, timestamp: Date.now() },
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
  const [[queryVec]] = await embed(ai, userMessage)
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
        const [[queryVec]] = await embed(ai, userMessage)
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

// ── Whisperer analysis helpers ────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export function computeSimilarityMatrix(embeddings: number[][]): number[][] {
  return embeddings.map(a => embeddings.map(b => cosineSimilarity(a, b)))
}

export function kMeansClusters(
  embeddings: number[][],
  k: number,
  maxIter = 20,
): { labels: number[]; centroids: number[][] } {
  const n = embeddings.length
  const dim = embeddings[0]?.length ?? 0
  k = Math.min(k, n)

  // Seeded-deterministic pick: evenly spaced indices
  const step = Math.max(1, Math.floor(n / k))
  const centroids = Array.from({ length: k }, (_, i) => [...(embeddings[i * step] ?? embeddings[0])])

  let labels = new Array<number>(n).fill(0)

  for (let iter = 0; iter < maxIter; iter++) {
    const newLabels = embeddings.map(e => {
      let best = 0, bestSim = -Infinity
      for (let ci = 0; ci < k; ci++) {
        const sim = cosineSimilarity(e, centroids[ci])
        if (sim > bestSim) { bestSim = sim; best = ci }
      }
      return best
    })
    if (newLabels.every((l, i) => l === labels[i])) break
    labels = newLabels
    for (let ci = 0; ci < k; ci++) {
      const members = embeddings.filter((_, i) => labels[i] === ci)
      if (members.length === 0) continue
      for (let d = 0; d < dim; d++) {
        centroids[ci][d] = members.reduce((s, e) => s + e[d], 0) / members.length
      }
    }
  }
  return { labels, centroids }
}

function shannonEntropy(texts: string[]): number {
  const combined = texts.join(' ')
  if (combined.length === 0) return 0
  const freq: Record<string, number> = {}
  for (const c of combined) freq[c] = (freq[c] ?? 0) + 1
  const total = combined.length
  let h = 0
  for (const count of Object.values(freq)) {
    const p = count / total
    h -= p * Math.log2(p)
  }
  return h
}

export async function generatePromptVariants(
  ai: Ai, env: Env, prompt: string, n: number,
): Promise<string[]> {
  const raw = await complete(ai, env, {
    model: MODELS.text,
    prompt: `Generate ${n - 1} semantically equivalent but syntactically diverse paraphrases of the following prompt. Output ONLY a JSON array of strings with no explanation.\n\nPrompt: "${prompt}"`,
    temperature: 0.9,
    maxTokens: 1024,
  })
  try {
    const stripped = raw.replace(/```(?:json)?\n?/g, '').trim()
    const match = stripped.match(/\[[\s\S]*\]/)
    if (match) {
      const arr = JSON.parse(match[0])
      if (Array.isArray(arr)) return [prompt, ...arr.slice(0, n - 1).map(String)]
    }
  } catch { /* fall through */ }
  return [prompt]
}

export interface CoTResult {
  style: 'plain' | 'step-by-step' | 'xml-structured' | 'self-consistency'
  response: string
  latencyMs: number
}

export async function runCoTProbe(
  ai: Ai, env: Env,
  opts: { prompt: string; model?: string; systemPrompt?: string; temperature?: number; maxTokens?: number },
  samples: number,
): Promise<CoTResult[]> {
  const styles: Array<{ style: CoTResult['style']; prompt: string }> = [
    { style: 'plain',            prompt: opts.prompt },
    { style: 'step-by-step',     prompt: `${opts.prompt}\n\nThink step by step before answering.` },
    { style: 'xml-structured',   prompt: `${opts.prompt}\n\nStructure your answer as:\n<thinking>...</thinking>\n<answer>...</answer>` },
    { style: 'self-consistency', prompt: `${opts.prompt}\n\nProvide ${samples} independent answers then state your final consensus answer.` },
  ]
  return Promise.all(styles.map(async ({ style, prompt }) => {
    const t0 = Date.now()
    const response = await complete(ai, env, {
      model: opts.model, prompt,
      systemPrompt: opts.systemPrompt,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
    })
    return { style, response, latencyMs: Date.now() - t0 }
  }))
}

export interface EntropyResult {
  samples: string[]
  entropy: number
  avgCosineSimilarity: number
  latencyMs: number
}

export async function estimateEntropy(
  ai: Ai, env: Env,
  opts: { prompt: string; model?: string; systemPrompt?: string; temperature?: number; maxTokens?: number },
  sampleCount: number,
): Promise<EntropyResult> {
  const t0 = Date.now()
  const samples = await Promise.all(
    Array.from({ length: sampleCount }, () =>
      complete(ai, env, {
        model: opts.model,
        prompt: opts.prompt,
        systemPrompt: opts.systemPrompt,
        temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
        maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      }),
    ),
  )
  const entropy = shannonEntropy(samples)
  const embeddings = await embed(ai, samples)
  let simSum = 0, simCount = 0
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      simSum += cosineSimilarity(embeddings[i], embeddings[j])
      simCount++
    }
  }
  const avgCosineSimilarity = simCount > 0 ? simSum / simCount : 1
  return { samples, entropy, avgCosineSimilarity, latencyMs: Date.now() - t0 }
}

export interface ArchaeologyCandidate {
  candidate: string
  similarity: number
}

export async function reverseEngineerPrompts(
  ai: Ai, env: Env,
  targetResponse: string,
  probe: string,
  model: string | undefined,
  n: number,
  maxTokens: number,
): Promise<ArchaeologyCandidate[]> {
  const raw = await complete(ai, env, {
    model: model ?? MODELS.textLarge,
    prompt: `You are a prompt archaeologist. Given an AI response and the user message that generated it, reverse-engineer ${n} candidate system prompts that could have produced this response.

User message: "${probe}"
AI response: "${targetResponse}"

Output ONLY a JSON array of ${n} strings (the candidate system prompts), no explanation.`,
    temperature: 0.8,
    maxTokens,
  })
  let candidates: string[] = []
  try {
    const match = raw.replace(/```(?:json)?\n?/g, '').trim().match(/\[[\s\S]*\]/)
    if (match) {
      const arr = JSON.parse(match[0])
      if (Array.isArray(arr)) candidates = arr.slice(0, n).map(String)
    }
  } catch { /* fall through */ }
  if (candidates.length === 0) return []
  const allEmbeds = await embed(ai, [targetResponse, ...candidates])
  const targetEmbed = allEmbeds[0]
  return candidates
    .map((candidate, i) => ({ candidate, similarity: cosineSimilarity(targetEmbed, allEmbeds[i + 1]) }))
    .sort((a, b) => b.similarity - a.similarity)
}

// ── Vibe builder meta-prompt ──────────────────────────────────────────────────

export interface VibeConfig {
  name: string
  description: string
  systemPrompt: string
  tools: Tool[]
  model: string
  temperature: number
  maxTokens: number
  appHtml?: string   // custom HTML page served at /app/:id; uses __SANDBOX_ID__ as placeholder
}

/**
 * Split a prompt into discrete clauses suitable for ablation analysis.
 * Handles numbered lists (1. / 1)), bullet lists (- / * / •), and plain paragraphs.
 */
export function parsePromptClauses(prompt: string): string[] {
  const lines = prompt.split(/\r?\n/)
  const clauses: string[] = []
  let current = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (current.trim()) { clauses.push(current.trim()); current = '' }
      continue
    }
    const isBullet = /^(\d+[.)]\s+|[-*•]\s+)/.test(trimmed)
    if (isBullet) {
      if (current.trim()) { clauses.push(current.trim()); current = '' }
      current = trimmed
    } else {
      current += (current ? ' ' : '') + trimmed
    }
  }
  if (current.trim()) clauses.push(current.trim())
  return clauses.filter(c => c.length > 0)
}

export async function generateVibeConfig(ai: Ai, env: Env, description: string, name?: string): Promise<VibeConfig> {
  const hasGateway = Boolean(env.AI_GATEWAY_ID && env.CLOUDFLARE_ACCOUNT_ID)

  const modelOptions = hasGateway
    ? `Workers AI (fast, no key needed):
  - "@cf/meta/llama-3.1-8b-instruct" — fast, efficient
  - "@cf/meta/llama-3.3-70b-instruct-fp8-fast" — large, complex tasks
Flagship via AI Gateway (requires API keys):
  - "openai:gpt-4o" — best overall quality
  - "openai:gpt-4o-mini" — fast, cost-efficient OpenAI
  - "anthropic:claude-sonnet-4-6" — excellent reasoning and writing
  - "anthropic:claude-opus-4-7" — most capable Anthropic model
  - "google:gemini-2.0-flash" — fast Google model`
    : `- "@cf/meta/llama-3.1-8b-instruct" — fast, efficient
- "@cf/meta/llama-3.3-70b-instruct-fp8-fast" — large, complex tasks`

  const metaPrompt = `You are an AI app generator. Given a description, output ONLY a valid JSON object — no markdown, no explanation, no code fences.

The JSON must have exactly these fields:
{
  "name": "<string, max 128 chars, descriptive app name>",
  "description": "<string, max 512 chars, what this app does>",
  "systemPrompt": "<string, detailed system instructions that make the AI excellent at the task>",
  "tools": [<optional array — define tools ONLY if the app description implies the AI needs to call external functions. Each tool: { "name": "snake_case_name", "description": "what this tool does", "parameters": { "param_name": { "type": "string|number|boolean", "description": "...", "required": true|false } } }>],
  "model": "<choose the most appropriate model from the options below>",
  "temperature": <number 0-2: 0.2 for factual, 0.7 for balanced, 1.2 for creative>,
  "maxTokens": <integer 256-4096>,
  "appHtml": "<complete single-file HTML app — see requirements below>"
}

Tool guidelines: define tools ONLY when the description explicitly requires calling external APIs or services. For knowledge-based or conversational apps, tools should be an empty array [].

App HTML requirements:
- Generate a COMPLETE, self-contained HTML page (DOCTYPE, head, body, styles, scripts all inline)
- Use __SANDBOX_ID__ (double underscore each side) as the sandbox ID placeholder — it will be replaced at runtime
- Load the SDK: <script type="module"> ... import { VibeClient } from '/vibe-sdk.js'; const client = new VibeClient(); ...
- For simple chat apps: use the <vibe-chat sandbox-id="__SANDBOX_ID__"> web component
- For richer apps (dashboards, tools, multi-step flows): build a full custom UI using client.sandbox.get('__SANDBOX_ID__') and client.ai.*
- Style with inline CSS — dark theme (#0c0c0f background, #d8d8e8 text, #7c3aed accent)
- All script tags must be type="module" — no inline event handlers (use addEventListener)
- The page must be fully functional with no external CDN dependencies (only /vibe-sdk.js from same origin)

Available models:
${modelOptions}

${name ? `Use the name: "${name}"` : 'Generate an appropriate name from the description.'}

User description: "${description}"`

  const raw = await complete(ai, env, {
    model: MODELS.textLarge,
    prompt: metaPrompt,
    temperature: 0.2,
    maxTokens: 2048,
  })

  const stripped = raw.replace(/```(?:json)?\n?/g, '').trim()
  const jsonMatch = stripped.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI did not return valid JSON for the vibe config')

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>

  // Parse tools defensively — invalid entries are silently dropped
  const rawTools = Array.isArray(parsed.tools) ? parsed.tools : []
  const tools: Tool[] = rawTools.flatMap((t: unknown) => {
    try {
      if (typeof t !== 'object' || t === null) return []
      const tt = t as Record<string, unknown>
      const tname = typeof tt.name === 'string' ? tt.name : ''
      if (!tname || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tname)) return []
      const rawParams = typeof tt.parameters === 'object' && tt.parameters !== null ? tt.parameters as Record<string, unknown> : {}
      const parameters: Record<string, { type: 'string' | 'number' | 'boolean' | 'array' | 'object'; description: string; required?: boolean }> = {}
      for (const [k, p] of Object.entries(rawParams)) {
        if (typeof p !== 'object' || p === null) continue
        const pp = p as Record<string, unknown>
        const ptype = typeof pp.type === 'string' ? pp.type : 'string'
        parameters[k] = { type: ptype as 'string', description: typeof pp.description === 'string' ? pp.description : k, required: pp.required === true }
      }
      return [{ name: tname, description: typeof tt.description === 'string' ? tt.description : tname, parameters }]
    } catch { return [] }
  })

  const rawAppHtml = typeof parsed.appHtml === 'string' ? parsed.appHtml.trim() : ''

  return {
    name:         typeof parsed.name === 'string'         ? parsed.name         : name ?? 'Untitled App',
    description:  typeof parsed.description === 'string'  ? parsed.description  : description.slice(0, 256),
    systemPrompt: typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : 'You are a helpful assistant.',
    tools,
    model:        typeof parsed.model === 'string'        ? parsed.model        : MODELS.text,
    temperature:  typeof parsed.temperature === 'number'  ? parsed.temperature  : DEFAULT_TEMPERATURE,
    maxTokens:    typeof parsed.maxTokens === 'number'    ? parsed.maxTokens    : DEFAULT_MAX_TOKENS,
    appHtml:      rawAppHtml.length > 0 && rawAppHtml.length <= 51_200 ? rawAppHtml : undefined,
  }
}
