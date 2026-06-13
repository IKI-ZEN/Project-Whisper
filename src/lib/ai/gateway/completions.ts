import type { Env } from '../../../types/env'
import { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, AI_GATEWAY_TIMEOUT_MS } from '../../constants'
import { now } from '../../utils'
import { MODELS } from '../models'
import { encodeToolCalls, toAnthropicTool, toOpenAITool, toGoogleFunctionDeclaration } from '../tools'
import { type CompletionOpts, buildMessages, buildAnthropicMessages, buildOpenAIMessages, toGeminiParts } from '../messages'
import { type GatewayResult, gatewayBase, parseGateway } from './registry'
import { run, buildGatewayHeaders } from './shared'

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
    headers: buildGatewayHeaders(authH, opts, wireModel),
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
      ...buildGatewayHeaders(authH, opts, model),
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
    headers: buildGatewayHeaders(authH, opts, model),
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
    headers: buildGatewayHeaders(authH, opts, modelId),
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
    headers: buildGatewayHeaders(authH, opts, modelId),
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
    headers: buildGatewayHeaders(authH, opts, modelId),
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
