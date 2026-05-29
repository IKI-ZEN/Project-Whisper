import type { Env } from '../types/env'
import type { Message, SandboxConfig, Tool, ContentBlock } from './schema'
import { sseEvent } from './http'
import { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, MAX_EMBED_CHARS, AI_GATEWAY_TIMEOUT_MS, AZURE_OPENAI_API_VERSION, CARTESIA_API_VERSION, FALLBACK_TELEMETRY_BLOB } from './constants'
import { sha256 } from './utils'
import { estimateCost, type CallType } from './pricing'

const DEC = new TextDecoder()

// ── Usage logging ─────────────────────────────────────────────────────────────
// Fire-and-forget D1 insert — never blocks the hot path.
// Only called when !sandboxId (sandbox runs are logged by SandboxDO with identity).

function logUsage(
  env: Env,
  sandboxId: string | undefined,
  model: string,
  provider: string,
  callType: CallType,
  tokensIn: number,
  tokensOut: number,
  latencyMs: number,
): void {
  if (!env.DB) return
  const cost = estimateCost(model, tokensIn, tokensOut)
  void env.DB.prepare(
    'INSERT INTO usage_metrics (sandbox_id, model, tokens_in, tokens_out, latency_ms, identity, created_at, provider, call_type, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(sandboxId ?? '', model, tokensIn, tokensOut, latencyMs, null, Date.now(), provider, callType, cost).run()
}

// ── Model registry ────────────────────────────────────────────────────────────

export const MODELS = {
  // Workers AI (no API key needed)
  text:         '@cf/meta/llama-3.1-8b-instruct',
  textLarge:    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  embed:        '@cf/baai/bge-base-en-v1.5',
  image:        '@cf/black-forest-labs/flux-1-schnell',
  transcribe:   '@cf/openai/whisper',
  // OpenAI via AI Gateway
  gpt4o:        'openai:gpt-4o',
  gpt4oMini:    'openai:gpt-4o-mini',
  // Anthropic via AI Gateway
  claude:       'anthropic:claude-sonnet-4-6',
  claudeOpus:   'anthropic:claude-opus-4-7',
  // Google via AI Gateway
  gemini:       'google:gemini-2.0-flash',
  geminiPro:    'google:gemini-1.5-pro',
  // Groq — ultra-fast inference
  groqLlama:    'groq:llama-3.3-70b-versatile',
  groqFast:     'groq:llama-3.1-8b-instant',
  // Mistral AI
  mistral:      'mistral:mistral-large-latest',
  mistralSmall: 'mistral:mistral-small-latest',
  // DeepSeek
  deepseek:     'deepseek:deepseek-chat',
  deepseekR1:   'deepseek:deepseek-reasoner',
  // xAI (Grok)
  grok:         'xai:grok-2-latest',
  grok4:        'xai:grok-4',
  // Perplexity (online models with web search)
  sonar:        'perplexity:sonar-pro',
  // Amazon Bedrock via AI Gateway compat + BYOK (requires CF_AIG_TOKEN, BYOK configured in CF dashboard)
  bedrockHaiku: 'bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0',
  // Cerebras — ultra-fast Llama inference
  cerebras:     'cerebras:llama-3.3-70b',
  // OpenRouter — unified model router (access 200+ models with one API key)
  openrouter:   'openrouter:openai/gpt-4o',
  // Cohere — command-r series with native retrieval & web-search connectors
  cohere:       'cohere:command-r-plus',
  // HuggingFace — model org/name encoded in model string (e.g. huggingface:bigcode/starcoder)
  huggingface:  'huggingface:bigcode/starcoder',
  // Replicate — async predictions; model string is a version hash or owner/model format
  replicate:    'replicate:meta/llama-4-maverick-instruct-basic',
  // Parallel — specialised web research & structured extraction
  parallel:     'parallel:speed',
  // Google Vertex AI via compat endpoint + BYOK (requires CF_AIG_TOKEN with Vertex SA configured)
  vertex:       'vertex:google/gemini-2.5-pro',
  // Fal AI — 600+ generative media models (image/video/audio); returns image URL
  imageFal:     'fal:fal-ai/fast-sdxl',
  // Ideogram — high-quality image generation; returns image URL
  imageIdeogram: 'ideogram:V_3',
} as const

// ── Gateway provider registry ─────────────────────────────────────────────────

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

type GatewayResult = { provider: string; id: string; def: GatewayProviderDef }

function parseGateway(model: string): GatewayResult | null {
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
  jsonSchema?: Record<string, unknown>        // OpenAI: json_schema strict mode (overrides responseFormat)
  thinking?: number                          // Anthropic: budget_tokens; >0 enables extended thinking
  reasoningEffort?: 'low' | 'medium' | 'high' // OpenAI o-series reasoning effort
  sandboxId?: string                         // passed as cf-aig-metadata for observability
  groundingEnabled?: boolean                 // Google: enable google_search_retrieval
  // AI Gateway extended controls
  byokAlias?:        string   // cf-aig-byok-alias — named credential in Cloudflare Secrets Store
  zdr?:              boolean  // cf-aig-zdr: true — Zero Data Retention (Unified Billing)
  collectLogPayload?: boolean // false → cf-aig-collect-log-payload: false
  fallbackModel?:    string   // tried once if primary model throws
}

// Extract plain text from a message content value (strips images for text-only paths)
export function contentToText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join('\n')
}

// Map ContentBlock[] to Anthropic content block array format
function toAnthropicContent(blocks: ContentBlock[]): Record<string, unknown>[] {
  return blocks.map(b =>
    b.type === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.data } }
      : { type: 'text', text: b.text },
  )
}

// Map ContentBlock[] to OpenAI content block array format
function toOpenAIContent(blocks: ContentBlock[]): Record<string, unknown>[] {
  return blocks.map(b =>
    b.type === 'image'
      ? { type: 'image_url', image_url: { url: `data:${b.mediaType};base64,${b.data}` } }
      : { type: 'text', text: b.text },
  )
}

// Map ContentBlock[] to Gemini parts format
function toGeminiParts(blocks: ContentBlock[]): Record<string, unknown>[] {
  return blocks.map(b =>
    b.type === 'image'
      ? { inlineData: { mimeType: b.mediaType, data: b.data } }
      : { text: b.text },
  )
}

// Build plain text messages for streaming and Workers AI (no tool history or multimodal support)
function buildMessages(opts: CompletionOpts): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = []
  if (opts.systemPrompt) out.push({ role: 'system', content: opts.systemPrompt })
  if (opts.messages?.length) {
    for (const m of opts.messages) out.push({ role: m.role, content: contentToText(m.content) })
  } else if (opts.prompt) {
    out.push({ role: 'user', content: opts.prompt })
  }
  return out
}

// Build Anthropic-format messages, converting tool call/result encoding and ContentBlock[] in history
function buildAnthropicMessages(opts: CompletionOpts): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const msgList = opts.messages?.length
    ? opts.messages.filter(m => m.role !== 'system')
    : opts.prompt ? [{ role: 'user' as const, content: opts.prompt, timestamp: 0 }] : []

  for (const m of msgList) {
    if (Array.isArray(m.content)) {
      // ContentBlock[] — map to Anthropic vision/text content blocks
      out.push({ role: m.role, content: toAnthropicContent(m.content) })
      continue
    }
    // String content — check for tool call encoding
    const tr = decodeToolResult(m.content)
    if (tr && m.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: tr.toolUseId, content: tr.content }] })
      continue
    }
    if (isToolCallReply(m.content) && m.role === 'assistant') {
      const calls = decodeToolCalls(m.content)
      out.push({ role: 'assistant', content: calls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })) })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out
}

// Build OpenAI-format messages, converting tool call/result encoding and ContentBlock[] in history
function buildOpenAIMessages(opts: CompletionOpts): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const msgList = opts.messages?.length
    ? opts.messages
    : opts.prompt ? [{ role: 'user' as const, content: opts.prompt, timestamp: 0 }] : []

  for (const m of msgList) {
    if (Array.isArray(m.content)) {
      // ContentBlock[] — map to OpenAI vision/text content blocks
      out.push({ role: m.role, content: toOpenAIContent(m.content) })
      continue
    }
    // String content — check for tool call encoding
    const tr = decodeToolResult(m.content)
    if (tr && m.role === 'user') {
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

  // Prepend system message if present (OpenAI supports system role in messages array)
  if (opts.systemPrompt) out.unshift({ role: 'system', content: opts.systemPrompt })
  return out
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
  const deadline = Date.now() + AI_GATEWAY_TIMEOUT_MS - 5_000
  while (Date.now() < deadline) {
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

function streamOpenAI(env: Env, gw: GatewayResult, opts: CompletionOpts): ReadableStream {
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

function streamAnthropic(env: Env, gw: GatewayResult, opts: CompletionOpts): ReadableStream {
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

function streamGoogle(env: Env, gw: GatewayResult, opts: CompletionOpts): ReadableStream {
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

function streamCohere(env: Env, gw: GatewayResult, opts: CompletionOpts): ReadableStream {
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

// ── Public complete ───────────────────────────────────────────────────────────

async function dispatchComplete(ai: Ai, env: Env, opts: CompletionOpts): Promise<string> {
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

export async function complete(ai: Ai, env: Env, opts: CompletionOpts): Promise<string> {
  const t0 = Date.now()
  let result: string
  try {
    result = await dispatchComplete(ai, env, opts)
  } catch (primaryErr) {
    if (!opts.fallbackModel) throw primaryErr
    if (env.ANALYTICS) {
      env.ANALYTICS.writeDataPoint({
        blobs:   [opts.model ?? '', FALLBACK_TELEMETRY_BLOB, opts.sandboxId ?? ''],
        doubles: [0, 0, 0, 0],
        indexes: [opts.sandboxId ?? FALLBACK_TELEMETRY_BLOB],
      })
    }
    result = await dispatchComplete(ai, env, { ...opts, model: opts.fallbackModel, fallbackModel: undefined })
  }
  const latencyMs   = Date.now() - t0
  const model        = opts.model ?? MODELS.text
  const gw           = parseGateway(model)
  const provider     = gw?.provider ?? 'workers-ai'
  const inputText    = opts.prompt ?? (opts.messages ?? []).map(m => contentToText(m.content)).join('')
  const inputTokens  = Math.ceil(inputText.length / 4)
  const outputTokens = Math.ceil(result.length / 4)
  const cost         = estimateCost(model, inputTokens, outputTokens)

  if (env.ANALYTICS) {
    // blobs: [model, provider, sandboxId] — doubles: [latencyMs, inputTokens, outputTokens, costUsd]
    env.ANALYTICS.writeDataPoint({
      blobs:   [model, provider, opts.sandboxId ?? ''],
      doubles: [latencyMs, inputTokens, outputTokens, cost],
      indexes: [opts.sandboxId ?? provider],
    })
  }
  if (!opts.sandboxId) {
    logUsage(env, undefined, model, provider, 'complete', inputTokens, outputTokens, latencyMs)
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
  if (gw?.def.format === 'anthropic') {
    raw = await completeAnthropic(env, gw, { ...opts, thinking: opts.budgetTokens ?? 8000, temperature: 1 })
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

// Wraps a stream to accumulate SSE text tokens and log usage after the stream closes.
function wrapStreamWithLogging(
  inner: ReadableStream,
  env: Env,
  opts: CompletionOpts,
  provider: string,
  t0: number,
): ReadableStream {
  const reader  = inner.getReader()
  const decoder = new TextDecoder()
  let accumulated = ''
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        if (!opts.sandboxId) {
          const model     = opts.model ?? MODELS.text
          const inputText = opts.prompt ?? (opts.messages ?? []).map(m => contentToText(m.content)).join('')
          logUsage(env, undefined, model, provider, 'stream',
            Math.ceil(inputText.length / 4), Math.ceil(accumulated.length / 4), Date.now() - t0)
        }
        return
      }
      // Extract text from SSE response chunks for token counting
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        const payload = line.trim().replace(/^data:\s*/, '')
        if (!payload || payload === '[DONE]') continue
        try {
          const parsed = JSON.parse(payload) as { response?: string }
          if (parsed.response) accumulated += parsed.response
        } catch { /* skip malformed SSE chunks */ }
      }
      controller.enqueue(value)
    },
    cancel() { reader.cancel() },
  })
}

export function completeStream(ai: Ai, env: Env, opts: CompletionOpts): ReadableStream {
  const t0 = Date.now()
  const gw = parseGateway(opts.model ?? '')
  let inner: ReadableStream
  if (gw) {
    if      (gw.def.format === 'anthropic')   inner = streamAnthropic(env, gw, opts)
    else if (gw.def.format === 'google')      inner = streamGoogle(env, gw, opts)
    else if (gw.def.format === 'cohere')      inner = streamCohere(env, gw, opts)
    else if (gw.def.format === 'huggingface' || gw.def.format === 'replicate') {
      // These providers don't support SSE streaming — emit the full result as one chunk
      inner = toReadableStream(async function*() { yield await complete(ai, env, opts) })
    }
    else inner = streamOpenAI(env, gw, opts)
  } else {
    const encoder = new TextEncoder()
    inner = new ReadableStream({
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
  return wrapStreamWithLogging(inner, env, opts, gw?.provider ?? 'workers-ai', t0)
}

// ── Embeddings ────────────────────────────────────────────────────────────────

export async function embed(ai: Ai, text: string | string[], model?: string, env?: Env): Promise<Float32Array[]> {
  const texts = Array.isArray(text) ? text : [text]
  const totalLen = texts.reduce((n, t) => n + t.length, 0)
  if (totalLen > MAX_EMBED_CHARS) throw new Error(`Embedding input exceeds ${MAX_EMBED_CHARS} characters`)

  // Cache embeddings — deterministic, expensive, safe to cache for 24h
  const cacheKey = new Request(`https://whisper-cache/embed/${await sha256(JSON.stringify([model ?? MODELS.embed, texts]))}`)
  const cached = await caches.default.match(cacheKey)
  if (cached) {
    const rows = await cached.json() as number[][]
    return rows.map(r => new Float32Array(r))
  }

  const t0 = Date.now()
  const response = await run(ai)(model ?? MODELS.embed, { text: texts })
  const r = response as { data?: number[][] }
  const result = r.data ?? []

  void caches.default.put(cacheKey, new Response(JSON.stringify(result), {
    headers: { 'Cache-Control': 'max-age=86400', 'Content-Type': 'application/json' },
  }))

  if (env) {
    logUsage(env, undefined, model ?? MODELS.embed, 'workers-ai', 'embed',
      Math.ceil(totalLen / 4), 0, Date.now() - t0)
  }

  return result.map(r => new Float32Array(r))
}

// ── Image generation ──────────────────────────────────────────────────────────

export async function generateImage(ai: Ai, prompt: string, model?: string, steps?: number, env?: Env): Promise<Uint8Array> {
  const t0 = Date.now()
  const response = await run(ai)(model ?? MODELS.image, {
    prompt,
    num_steps: steps ?? 4,
  })

  let bytes: Uint8Array
  if (response instanceof ArrayBuffer) {
    bytes = new Uint8Array(response)
  } else if (response instanceof Uint8Array) {
    bytes = response
  } else {
    const r = response as { image?: string }
    if (typeof r.image === 'string') {
      const binary = atob(r.image)
      bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    } else {
      throw new Error('Unexpected image response format from Workers AI')
    }
  }

  if (env) logUsage(env, undefined, model ?? MODELS.image, 'workers-ai', 'image', 1, 0, Date.now() - t0)
  return bytes
}

// ── TTS (ElevenLabs / Cartesia via gateway) ───────────────────────────────────

export interface TTSOpts {
  provider: 'elevenlabs' | 'cartesia'
  text: string
  voiceId?: string
  modelId?: string
  voice?: { mode: string; id: string }
  outputFormat?: { container: string; encoding: string; sampleRate: number }
}

export async function synthesizeSpeech(env: Env, opts: TTSOpts): Promise<{ audio: ArrayBuffer; contentType: string }> {
  const base = gatewayBase(env)
  if (opts.provider === 'elevenlabs') {
    const voiceId = opts.voiceId ?? 'EXAVITQu4vr4xnSDxMaL'
    const url = `${base}/elevenlabs/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': env.ELEVENLABS_API_KEY ?? '' },
      body: JSON.stringify({ text: opts.text, model_id: opts.modelId ?? 'eleven_multilingual_v2' }),
      signal: AbortSignal.timeout(AI_GATEWAY_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`ElevenLabs error ${res.status}: ${await res.text()}`)
    return { audio: await res.arrayBuffer(), contentType: 'audio/mpeg' }
  }
  // Cartesia
  const voice = opts.voice ?? { mode: 'id', id: '79a125e8-cd45-4c13-8a67-188112f4dd22' }
  const outputFmt = opts.outputFormat ?? { container: 'mp3', encoding: 'mp3', sampleRate: 44100 }
  const res = await fetch(`${base}/cartesia/tts/bytes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': env.CARTESIA_API_KEY ?? '',
      'Cartesia-Version': CARTESIA_API_VERSION,
    },
    body: JSON.stringify({
      transcript: opts.text,
      model_id: opts.modelId ?? 'sonic-english',
      voice,
      output_format: outputFmt,
    }),
    signal: AbortSignal.timeout(AI_GATEWAY_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Cartesia error ${res.status}: ${await res.text()}`)
  return { audio: await res.arrayBuffer(), contentType: 'audio/mpeg' }
}

// ── Image generation via gateway (Fal AI / Ideogram) ─────────────────────────

export async function generateImageGateway(env: Env, prompt: string, model: string): Promise<string> {
  const base = gatewayBase(env)
  const sep = model.indexOf(':')
  const provider = sep === -1 ? '' : model.slice(0, sep)
  const modelId  = sep === -1 ? model : model.slice(sep + 1)
  if (provider === 'fal') {
    const res = await fetch(`${base}/fal/${modelId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Key ${env.FAL_API_KEY ?? ''}` },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(AI_GATEWAY_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Fal error ${res.status}: ${await res.text()}`)
    type FalResp = { images?: Array<{ url: string }> }
    return ((await res.json() as FalResp).images?.[0]?.url) ?? ''
  }
  if (provider === 'ideogram') {
    const res = await fetch(`${base}/ideogram/v1/ideogram-v3/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Api-Key': env.IDEOGRAM_API_KEY ?? '' },
      body: JSON.stringify({ prompt, model: modelId || 'V_3' }),
      signal: AbortSignal.timeout(AI_GATEWAY_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Ideogram error ${res.status}: ${await res.text()}`)
    type IdeogramResp = { data?: Array<{ url: string }> }
    return ((await res.json() as IdeogramResp).data?.[0]?.url) ?? ''
  }
  throw new Error(`Unknown image gateway provider: ${provider}`)
}

// ── Audio transcription ───────────────────────────────────────────────────────

export async function transcribe(ai: Ai, audio: ArrayBuffer, model?: string, env?: Env): Promise<string> {
  const t0 = Date.now()
  const response = await run(ai)(model ?? MODELS.transcribe, {
    audio: [...new Uint8Array(audio)],
  })
  const r = response as { text?: string }
  const text = r.text ?? ''
  if (env) {
    logUsage(env, undefined, model ?? MODELS.transcribe, 'workers-ai', 'transcribe',
      Math.ceil(audio.byteLength / 16000), 0, Date.now() - t0)
  }
  return text
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

// ── Whisperer analysis helpers ────────────────────────────────────────────────

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export function computeSimilarityMatrix(embeddings: Float32Array[]): number[][] {
  return embeddings.map(a => embeddings.map(b => cosineSimilarity(a, b)))
}

export function kMeansClusters(
  embeddings: Float32Array[],
  k: number,
  maxIter = 20,
): { labels: number[]; centroids: Float32Array[] } {
  const n = embeddings.length
  const dim = embeddings[0]?.length ?? 0
  k = Math.min(k, n)

  // Seeded-deterministic pick: evenly spaced indices
  const step = Math.max(1, Math.floor(n / k))
  const centroids = Array.from({ length: k }, (_, i) => new Float32Array(embeddings[i * step] ?? embeddings[0]))

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
  const embeddings = await embed(ai, samples, undefined, env)
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
  const allEmbeds = await embed(ai, [targetResponse, ...candidates], undefined, env)
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
