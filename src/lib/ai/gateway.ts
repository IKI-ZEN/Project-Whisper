// ── Gateway provider registry ─────────────────────────────────────────────────

import type { Env } from '../../types/env'
import { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, AI_GATEWAY_TIMEOUT_MS, AZURE_OPENAI_API_VERSION, CARTESIA_API_VERSION } from '../constants'
import { now } from '../utils'
import { sseEvent } from '../http'
import { MODELS } from './models'
import { encodeToolCalls, toAnthropicTool, toOpenAITool, toGoogleFunctionDeclaration, isToolCallReply, decodeToolCalls } from './tools'
import { type CompletionOpts, buildMessages, buildAnthropicMessages, buildOpenAIMessages, toAnthropicContent, toOpenAIContent, toGeminiParts } from './messages'

const DEC = new TextDecoder()

type WireFormat = 'openai' | 'anthropic' | 'google' | 'cohere' | 'huggingface' | 'replicate'

interface ProviderCapabilities {
  tools?:        boolean
  vision?:       boolean
  streaming?:    boolean
  systemPrompt?: boolean
  jsonMode?:     boolean
}

interface GatewayProviderDef {
  format:        WireFormat
  path:          (id: string) => string
  apiKey:        (env: Env) => string
  authHeaders?:  (key: string) => Record<string, string>
  modelId?:      (id: string) => string
  capabilities?: ProviderCapabilities
}

// Each entry maps the model prefix (before ':') to its gateway path and auth.
// All OpenAI-compatible providers share the same request/response format.
// Paths are confirmed against official Cloudflare AI Gateway provider docs.
const GATEWAY_PROVIDERS: Record<string, GatewayProviderDef> = {
  openai: {
    format: 'openai', path: _ => '/openai/chat/completions', apiKey: e => e.OPENAI_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  anthropic: {
    format: 'anthropic', path: _ => '/anthropic/v1/messages', apiKey: e => e.ANTHROPIC_API_KEY ?? '',
    authHeaders: key => ({ 'x-api-key': key }),
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true },
  },
  google: {
    format: 'google', path: id => `/google-ai-studio/v1/models/${encodeURIComponent(id)}:generateContent`,
    apiKey: e => e.GOOGLE_AI_KEY ?? '', authHeaders: key => ({ 'x-goog-api-key': key }),
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  groq: {
    format: 'openai', path: _ => '/groq/chat/completions', apiKey: e => e.GROQ_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  mistral: {
    format: 'openai', path: _ => '/mistral/v1/chat/completions', apiKey: e => e.MISTRAL_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  deepseek: {
    format: 'openai', path: _ => '/deepseek/chat/completions', apiKey: e => e.DEEPSEEK_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  xai: {
    format: 'openai', path: _ => '/grok/v1/chat/completions', apiKey: e => e.XAI_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  perplexity: {
    format: 'openai', path: _ => '/perplexity-ai/chat/completions', apiKey: e => e.PERPLEXITY_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  cerebras: {
    format: 'openai', path: _ => '/cerebras/chat/completions', apiKey: e => e.CEREBRAS_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  openrouter: {
    format: 'openai', path: _ => '/openrouter/chat/completions', apiKey: e => e.OPENROUTER_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  // Bedrock via AI Gateway compat endpoint. Auth is CF_AIG_TOKEN; body model becomes "aws-bedrock/{id}".
  // Requires BYOK credentials configured in CF dashboard and CF_AIG_TOKEN set.
  bedrock: {
    format: 'openai', path: _ => '/compat/chat/completions',
    apiKey: e => e.CF_AIG_TOKEN ?? '', authHeaders: key => ({ 'cf-aig-authorization': `Bearer ${key}` }),
    modelId: id => `aws-bedrock/${id}`,
    capabilities: { tools: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  // Azure OpenAI — model string format: azure:{resource-name}/{deployment-name}
  azure: {
    format: 'openai',
    path: id => {
      const slash = id.indexOf('/')
      const resource = encodeURIComponent(slash === -1 ? id : id.slice(0, slash))
      const dep      = encodeURIComponent(slash === -1 ? id : id.slice(slash + 1))
      return `/azure-openai/${resource}/${dep}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`
    },
    apiKey: e => e.AZURE_OPENAI_API_KEY ?? '', authHeaders: key => ({ 'api-key': key }),
    modelId: id => { const s = id.indexOf('/'); return s === -1 ? id : id.slice(s + 1) },
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  // Baseten — OpenAI-compatible inference for custom and open-source models
  baseten: {
    format: 'openai', path: _ => '/baseten/v1/chat/completions', apiKey: e => e.BASETEN_API_KEY ?? '',
    capabilities: { tools: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  // Cohere — native Cohere chat format; auth uses "Token {key}" not "Bearer"
  cohere: {
    format: 'cohere', path: _ => '/cohere/v1/chat', apiKey: e => e.COHERE_API_KEY ?? '',
    authHeaders: key => ({ Authorization: `Token ${key}` }),
    capabilities: { tools: true, streaming: true, systemPrompt: true },
  },
  // HuggingFace — model ID is embedded in the URL path; body uses "inputs" key
  huggingface: {
    format: 'huggingface', path: id => `/huggingface/${id}`, apiKey: e => e.HUGGINGFACE_API_KEY ?? '',
    capabilities: { streaming: false, systemPrompt: true },
  },
  // Replicate — async prediction API; polls until completion
  replicate: {
    format: 'replicate', path: _ => '/replicate/predictions', apiKey: e => e.REPLICATE_API_KEY ?? '',
    capabilities: { streaming: false },
  },
  // Parallel — chat via unified compat endpoint; model format "parallel/{model-id}"
  parallel: {
    format: 'openai', path: _ => '/compat/chat/completions',
    apiKey: e => e.PARALLEL_API_KEY ?? '', authHeaders: key => ({ 'x-api-key': key }),
    modelId: id => `parallel/${id}`,
    capabilities: { tools: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  // Google Vertex AI via compat endpoint + BYOK; model format "google-vertex-ai/{model}"
  vertex: {
    format: 'openai', path: _ => '/compat/chat/completions',
    apiKey: e => e.CF_AIG_TOKEN ?? '', authHeaders: key => ({ 'cf-aig-authorization': `Bearer ${key}` }),
    modelId: id => `google-vertex-ai/${id}`,
    capabilities: { tools: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
}

export type GatewayResult = { provider: string; id: string; def: GatewayProviderDef }

export function parseGateway(model: string): GatewayResult | null {
  const sep = model.indexOf(':')
  if (sep === -1) return null
  const p = model.slice(0, sep)
  const def = GATEWAY_PROVIDERS[p]
  if (!def) return null
  const id = model.slice(sep + 1)
  // Block '..' to prevent path traversal in URL-encoded path segments.
  // Allow '/' (Azure resource/deployment, Baseten model IDs, OpenRouter)
  // and ':' (Bedrock ARN-style version suffixes like 'v1:0').
  if (id.includes('..')) return null
  if (!/^[a-zA-Z0-9][\w.\-:/]*$/.test(id)) return null
  return { provider: p, id, def }
}

export function gatewayBase(env: Env): string {
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

export function run(ai: Ai): AiRun {
  return (ai.run as unknown as AiRun).bind(ai)
}

// ── Gateway header builder ────────────────────────────────────────────────────

// Constructs the standard set of headers for every AI Gateway request.
// All cache/metadata headers live here — never inline them in provider functions.
function buildGatewayHeaders(
  key: string,
  authH: Record<string, string>,
  opts: CompletionOpts,
  modelLabel: string,
): Record<string, string> {
  const temp = opts.temperature ?? DEFAULT_TEMPERATURE
  const h: Record<string, string> = {
    'Content-Type':      'application/json',
    ...authH,
    'cf-aig-cache-ttl':  '3600',
    'cf-aig-skip-cache': temp !== 0 ? 'true' : 'false',
  }
  if (opts.sandboxId)                 h['cf-aig-metadata']          = JSON.stringify({ sandboxId: opts.sandboxId, model: modelLabel })
  if (opts.byokAlias)                 h['cf-aig-byok-alias']         = opts.byokAlias
  if (opts.zdr)                       h['cf-aig-zdr']                 = 'true'
  if (opts.collectLogPayload === false) h['cf-aig-collect-log-payload'] = 'false'
  return h
}

// ── Provider completions (gateway) ────────────────────────────────────────────

// Handles all OpenAI-compatible providers: openai, groq, mistral, deepseek, xai, perplexity,
// cerebras, openrouter, bedrock (compat), azure, baseten
async function completeOpenAI(env: Env, gw: GatewayResult, opts: CompletionOpts): Promise<string> {
  const { id: modelId, def } = gw
  const wireModel = def.modelId ? def.modelId(modelId) : modelId
  const temp = opts.temperature ?? DEFAULT_TEMPERATURE
  // o-series reasoning models use different params (OpenAI-specific)
  const isReasoning = gw.provider === 'openai' && /^o[1-9]/.test(modelId)
  const body: Record<string, unknown> = {
    model: wireModel,
    messages: buildOpenAIMessages(opts),
    ...(isReasoning
      ? { max_completion_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS, ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}) }
      : { temperature: temp, max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS }
    ),
    ...(opts.jsonSchema && !isReasoning
      ? { response_format: { type: 'json_schema', json_schema: { name: 'response', schema: opts.jsonSchema, strict: true } } }
      : opts.responseFormat === 'json' && !isReasoning
        ? { response_format: { type: 'json_object' } }
        : {}),
  }
  if (opts.tools?.length) {
    body.tools = opts.tools.map(toOpenAITool)
    if (opts.toolChoice) body.tool_choice = opts.toolChoice
  }
  const key = def.apiKey(env)
  const authH = def.authHeaders ? def.authHeaders(key) : { Authorization: `Bearer ${key}` }
  const res = await fetch(`${gatewayBase(env)}${def.path(modelId)}`, {
    method: 'POST',
    headers: buildGatewayHeaders(key, authH, opts, wireModel),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_GATEWAY_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`${gw.provider} gateway error ${res.status}: ${await res.text()}`)
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

async function completeAnthropic(env: Env, gw: GatewayResult, opts: CompletionOpts): Promise<string> {
  const { id: model, def } = gw
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
  const key = def.apiKey(env)
  const authH = def.authHeaders ? def.authHeaders(key) : { 'x-api-key': key }
  const res = await fetch(`${gatewayBase(env)}${def.path(model)}`, {
    method: 'POST',
    headers: {
      ...buildGatewayHeaders(key, authH, opts, model),
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_GATEWAY_TIMEOUT_MS),
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

async function completeGoogle(env: Env, gw: GatewayResult, opts: CompletionOpts): Promise<string> {
  const { id: model, def } = gw
  const msgList = opts.messages?.length
    ? opts.messages.filter(m => m.role !== 'system')
    : opts.prompt ? [{ role: 'user' as const, content: opts.prompt, timestamp: 0 }] : []
  const contents = msgList.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: Array.isArray(m.content) ? toGeminiParts(m.content) : [{ text: m.content }],
  }))
  const temp = opts.temperature ?? DEFAULT_TEMPERATURE
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: temp,
      maxOutputTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(opts.responseFormat === 'json' ? { responseMimeType: 'application/json' } : {}),
    },
    ...(opts.systemPrompt ? { systemInstruction: { parts: [{ text: opts.systemPrompt }] } } : {}),
    ...(opts.groundingEnabled ? { tools: [{ googleSearch: {} }] } : opts.tools?.length
      ? { tools: [{ functionDeclarations: opts.tools.map(toGoogleFunctionDeclaration) }] }
      : {}),
  }
  const key = def.apiKey(env)
  const authH = def.authHeaders ? def.authHeaders(key) : { 'x-goog-api-key': key }
  const res = await fetch(`${gatewayBase(env)}${def.path(model)}`, {
    method: 'POST',
    headers: buildGatewayHeaders(key, authH, opts, model),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_GATEWAY_TIMEOUT_MS),
  })
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

async function completeCohere(env: Env, gw: GatewayResult, opts: CompletionOpts): Promise<string> {
  const { id: modelId, def } = gw
  const key = def.apiKey(env)
  const authH = def.authHeaders ? def.authHeaders(key) : { Authorization: `Token ${key}` }
  const msgs = buildMessages(opts)
  const last = msgs[msgs.length - 1]
  const message = last?.content ?? opts.prompt ?? ''
  const chatHistory = msgs.slice(0, -1).map(m => ({
    role: m.role === 'user' ? 'USER' : 'CHATBOT',
    message: m.content,
  }))
  const body: Record<string, unknown> = {
    message,
    model: modelId,
    chat_history: chatHistory,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
  }
  if (opts.systemPrompt) body.preamble = opts.systemPrompt
  if (opts.tools?.length) {
    body.tools = opts.tools.map(t => ({
      name: t.name,
      description: t.description,
      parameter_definitions: Object.fromEntries(
        Object.entries(t.parameters).map(([k, p]) => [k, { description: p.description, type: p.type, required: p.required ?? false }]),
      ),
    }))
  }
  const res = await fetch(`${gatewayBase(env)}${def.path(modelId)}`, {
    method: 'POST',
    headers: buildGatewayHeaders(key, authH, opts, modelId),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_GATEWAY_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Cohere gateway error ${res.status}: ${await res.text()}`)
  type CohereResp = { text?: string; tool_calls?: Array<{ name: string; parameters: Record<string, unknown> }> }
  const data = await res.json() as CohereResp
  if (data.tool_calls?.length) {
    return encodeToolCalls(data.tool_calls.map((tc, i) => ({ id: `cohere_${i}`, name: tc.name, input: tc.parameters })))
  }
  return data.text ?? ''
}

async function completeHuggingFace(env: Env, gw: GatewayResult, opts: CompletionOpts): Promise<string> {
  const { id: modelId, def } = gw
  const key = def.apiKey(env)
  const authH = def.authHeaders ? def.authHeaders(key) : { Authorization: `Bearer ${key}` }
  // Build prompt: separate system prefix from conversation turns for HF "inputs" key
  const msgs = buildMessages(opts)
  const system = msgs.find(m => m.role === 'system')
  const rest = msgs.filter(m => m.role !== 'system')
  const systemPrefix = system ? `System: ${system.content}\n` : ''
  const prompt = systemPrefix + rest.map(m => `${m.role}: ${m.content}`).join('\n')
  const body = {
    inputs: prompt,
    parameters: {
      max_new_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
      return_full_text: false,
    },
  }
  const res = await fetch(`${gatewayBase(env)}${def.path(modelId)}`, {
    method: 'POST',
    headers: buildGatewayHeaders(key, authH, opts, modelId),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_GATEWAY_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HuggingFace gateway error ${res.status}: ${await res.text()}`)
  type HFResp = { generated_text?: string } | Array<{ generated_text?: string }>
  const data = await res.json() as HFResp
  return (Array.isArray(data) ? data[0]?.generated_text : data.generated_text) ?? ''
}

async function completeReplicate(env: Env, gw: GatewayResult, opts: CompletionOpts): Promise<string> {
  const { id: modelId, def } = gw
  const key = def.apiKey(env)
  const authH = def.authHeaders ? def.authHeaders(key) : { Authorization: `Bearer ${key}` }
  const base = gatewayBase(env)
  const prompt = buildMessages(opts).map(m => `${m.role}: ${m.content}`).join('\n')
  // Create prediction — gateway headers only on the create request, not on polling
  const input: Record<string, unknown> = {
    prompt,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  }
  const createRes = await fetch(`${base}${def.path(modelId)}`, {
    method: 'POST',
    headers: buildGatewayHeaders(key, authH, opts, modelId),
    body: JSON.stringify({ version: modelId, input }),
    signal: AbortSignal.timeout(AI_GATEWAY_TIMEOUT_MS),
  })
  type ReplicatePred = { id: string; status: string; output?: string[] | string; error?: string; urls?: { get: string } }
  const pred = await createRes.json() as ReplicatePred
  if (!createRes.ok) throw new Error(`Replicate create error ${createRes.status}: ${pred.error ?? ''}`)
  // Poll until succeeded (up to timeout)
  const pollUrl = pred.urls?.get ?? `${base}/replicate/predictions/${pred.id}`
  const deadline = now() + AI_GATEWAY_TIMEOUT_MS - 5_000
  while (now() < deadline) {
    await new Promise<void>(r => setTimeout(r, 1_500))
    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    })
    const polled = await pollRes.json() as ReplicatePred
    if (polled.status === 'succeeded') {
      const out = polled.output
      return Array.isArray(out) ? out.join('') : (out ?? '')
    }
    if (polled.status === 'failed' || polled.status === 'canceled')
      throw new Error(`Replicate prediction ${polled.status}: ${polled.error ?? ''}`)
  }
  throw new Error('Replicate prediction timed out')
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
      headers: buildGatewayHeaders(key, authH, opts, wireModel),
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
      headers: { ...buildGatewayHeaders(key, authH, opts, model), 'anthropic-version': '2023-06-01' },
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
      headers: buildGatewayHeaders(key, authH, opts, model),
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
      headers: buildGatewayHeaders(key, authH, opts, modelId),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_GATEWAY_TIMEOUT_MS),
    },
    (c: unknown) => { const ch = c as { event_type?: string; text?: string }; return ch.event_type === 'text-generation' ? ch.text : undefined },
  ))
}

// ── Public dispatch ───────────────────────────────────────────────────────────

export async function dispatchComplete(ai: Ai, env: Env, opts: CompletionOpts): Promise<string> {
  const gw = parseGateway(opts.model ?? '')
  if (gw) {
    if      (gw.def.format === 'anthropic')   return completeAnthropic(env, gw, opts)
    else if (gw.def.format === 'google')      return completeGoogle(env, gw, opts)
    else if (gw.def.format === 'cohere')      return completeCohere(env, gw, opts)
    else if (gw.def.format === 'huggingface') return completeHuggingFace(env, gw, opts)
    else if (gw.def.format === 'replicate')   return completeReplicate(env, gw, opts)
    else                                       return completeOpenAI(env, gw, opts)
  }
  const response = await run(ai)(opts.model ?? MODELS.text, {
    messages: buildMessages(opts),
    temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(opts.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
  })
  return (response as { response?: string }).response ?? String(response)
}
