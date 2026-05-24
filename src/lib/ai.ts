import type { Env } from '../types/env'
import type { Message, SandboxConfig } from './schema'
import { sseEvent } from './http'

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
  if (p === 'openai' || p === 'anthropic' || p === 'google')
    return { provider: p as 'openai' | 'anthropic' | 'google', id: model.slice(sep + 1) }
  return null
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

// ── Shared message builder ────────────────────────────────────────────────────

export interface CompletionOpts {
  model?: string
  prompt?: string
  messages?: Message[]
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}

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

// ── Provider completions (gateway) ────────────────────────────────────────────

async function completeOpenAI(env: Env, model: string, opts: CompletionOpts): Promise<string> {
  const res = await fetch(`${gatewayBase(env)}/openai/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      model,
      messages: buildMessages(opts),
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 1024,
    }),
  })
  if (!res.ok) throw new Error(`OpenAI gateway error ${res.status}: ${await res.text()}`)
  const data = await res.json() as { choices: { message: { content: string } }[] }
  return data.choices[0]?.message?.content ?? ''
}

async function completeAnthropic(env: Env, model: string, opts: CompletionOpts): Promise<string> {
  const messages = buildMessages(opts).filter(m => m.role !== 'system')
  const res = await fetch(`${gatewayBase(env)}/anthropic/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      messages,
      ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
    }),
  })
  if (!res.ok) throw new Error(`Anthropic gateway error ${res.status}: ${await res.text()}`)
  const data = await res.json() as { content: { text: string }[] }
  return data.content[0]?.text ?? ''
}

async function completeGoogle(env: Env, model: string, opts: CompletionOpts): Promise<string> {
  const allMessages = buildMessages(opts)
  const system = allMessages.find(m => m.role === 'system')
  const contents = allMessages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature: opts.temperature ?? 0.7, maxOutputTokens: opts.maxTokens ?? 1024 },
    ...(system ? { systemInstruction: { parts: [{ text: system.content }] } } : {}),
  }
  const res = await fetch(
    `${gatewayBase(env)}/google-ai-studio/v1/models/${model}:generateContent?key=${env.GOOGLE_AI_KEY ?? ''}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )
  if (!res.ok) throw new Error(`Google gateway error ${res.status}: ${await res.text()}`)
  const data = await res.json() as { candidates: { content: { parts: { text: string }[] } }[] }
  return data.candidates[0]?.content?.parts[0]?.text ?? ''
}

// ── Provider streaming (gateway) ──────────────────────────────────────────────

function streamOpenAI(env: Env, model: string, opts: CompletionOpts): ReadableStream {
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      try {
        const res = await fetch(`${gatewayBase(env)}/openai/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.OPENAI_API_KEY ?? ''}`,
          },
          body: JSON.stringify({
            model, messages: buildMessages(opts),
            temperature: opts.temperature ?? 0.7, max_tokens: opts.maxTokens ?? 1024, stream: true,
          }),
        })
        if (!res.ok || !res.body) throw new Error(`OpenAI stream error ${res.status}`)
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n'); buf = lines.pop() ?? ''
          for (const line of lines) {
            const payload = line.trim().replace(/^data:\s*/, '')
            if (!payload || payload === '[DONE]') continue
            try {
              const chunk = JSON.parse(payload) as { choices: { delta: { content?: string } }[] }
              const text = chunk.choices[0]?.delta?.content
              if (text) controller.enqueue(encoder.encode(sseEvent({ response: text })))
            } catch { /* skip malformed chunks */ }
          }
        }
        controller.enqueue(encoder.encode(sseEvent({ done: true }, 'done')))
      } catch (e) {
        controller.enqueue(encoder.encode(sseEvent({ error: String(e) }, 'error')))
      } finally {
        controller.close()
      }
    },
  })
}

function streamAnthropic(env: Env, model: string, opts: CompletionOpts): ReadableStream {
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      try {
        const messages = buildMessages(opts).filter(m => m.role !== 'system')
        const res = await fetch(`${gatewayBase(env)}/anthropic/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY ?? '',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model, messages,
            ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
            max_tokens: opts.maxTokens ?? 1024, temperature: opts.temperature ?? 0.7, stream: true,
          }),
        })
        if (!res.ok || !res.body) throw new Error(`Anthropic stream error ${res.status}`)
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n'); buf = lines.pop() ?? ''
          for (const line of lines) {
            const payload = line.trim().replace(/^data:\s*/, '')
            if (!payload) continue
            try {
              const chunk = JSON.parse(payload) as { type: string; delta?: { text?: string } }
              if (chunk.type === 'content_block_delta' && chunk.delta?.text)
                controller.enqueue(encoder.encode(sseEvent({ response: chunk.delta.text })))
            } catch { /* skip malformed chunks */ }
          }
        }
        controller.enqueue(encoder.encode(sseEvent({ done: true }, 'done')))
      } catch (e) {
        controller.enqueue(encoder.encode(sseEvent({ error: String(e) }, 'error')))
      } finally {
        controller.close()
      }
    },
  })
}

function streamGoogle(env: Env, model: string, opts: CompletionOpts): ReadableStream {
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      try {
        const allMessages = buildMessages(opts)
        const system = allMessages.find(m => m.role === 'system')
        const contents = allMessages
          .filter(m => m.role !== 'system')
          .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
        const body: Record<string, unknown> = {
          contents,
          generationConfig: { temperature: opts.temperature ?? 0.7, maxOutputTokens: opts.maxTokens ?? 1024 },
          ...(system ? { systemInstruction: { parts: [{ text: system.content }] } } : {}),
        }
        const res = await fetch(
          `${gatewayBase(env)}/google-ai-studio/v1/models/${model}:streamGenerateContent?alt=sse&key=${env.GOOGLE_AI_KEY ?? ''}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        )
        if (!res.ok || !res.body) throw new Error(`Google stream error ${res.status}`)
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n'); buf = lines.pop() ?? ''
          for (const line of lines) {
            const payload = line.trim().replace(/^data:\s*/, '')
            if (!payload) continue
            try {
              const chunk = JSON.parse(payload) as { candidates: { content: { parts: { text: string }[] } }[] }
              const text = chunk.candidates[0]?.content?.parts[0]?.text
              if (text) controller.enqueue(encoder.encode(sseEvent({ response: text })))
            } catch { /* skip malformed chunks */ }
          }
        }
        controller.enqueue(encoder.encode(sseEvent({ done: true }, 'done')))
      } catch (e) {
        controller.enqueue(encoder.encode(sseEvent({ error: String(e) }, 'error')))
      } finally {
        controller.close()
      }
    },
  })
}

// ── Public complete ───────────────────────────────────────────────────────────

export async function complete(ai: Ai, env: Env, opts: CompletionOpts): Promise<string> {
  const gw = parseGateway(opts.model ?? '')
  if (gw) {
    if (gw.provider === 'openai')    return completeOpenAI(env, gw.id, opts)
    if (gw.provider === 'anthropic') return completeAnthropic(env, gw.id, opts)
    return completeGoogle(env, gw.id, opts)
  }
  const response = await run(ai)(opts.model ?? MODELS.text, {
    messages: buildMessages(opts),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 1024,
  })
  const r = response as { response?: string }
  return r.response ?? String(response)
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
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens ?? 1024,
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
        controller.enqueue(encoder.encode(sseEvent({ error: String(e) }, 'error')))
      } finally {
        controller.close()
      }
    },
  })
}

// ── Embeddings ────────────────────────────────────────────────────────────────

export async function embed(ai: Ai, text: string | string[], model?: string): Promise<number[][]> {
  const texts = Array.isArray(text) ? text : [text]
  const response = await run(ai)(model ?? MODELS.embed, { text: texts })
  const r = response as { data?: number[][] }
  return r.data ?? []
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
  })
}

// ── Vibe builder meta-prompt ──────────────────────────────────────────────────

export interface VibeConfig {
  name: string
  description: string
  systemPrompt: string
  tools: []
  model: string
  temperature: number
  maxTokens: number
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

  const metaPrompt = `You are an AI assistant configuration generator. Given a description of an AI app, output ONLY a valid JSON object — no markdown, no explanation, no code fences.

The JSON must have exactly these fields:
{
  "name": "<string, max 128 chars, descriptive app name>",
  "description": "<string, max 512 chars, what this app does>",
  "systemPrompt": "<string, detailed system instructions that make the AI excellent at the task>",
  "tools": [],
  "model": "<choose the most appropriate model from the options below>",
  "temperature": <number 0-2: 0.2 for factual, 0.7 for balanced, 1.2 for creative>,
  "maxTokens": <integer 256-4096>
}

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

  return {
    name:         typeof parsed.name === 'string'         ? parsed.name         : name ?? 'Untitled App',
    description:  typeof parsed.description === 'string'  ? parsed.description  : description.slice(0, 256),
    systemPrompt: typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : 'You are a helpful assistant.',
    tools:        [],
    model:        typeof parsed.model === 'string'        ? parsed.model        : MODELS.text,
    temperature:  typeof parsed.temperature === 'number'  ? parsed.temperature  : 0.7,
    maxTokens:    typeof parsed.maxTokens === 'number'    ? parsed.maxTokens    : 1024,
  }
}
