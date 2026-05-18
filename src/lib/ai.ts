import type { Message, SandboxConfig } from './schema'
import { sseEvent } from './http'

// ── Model registry ────────────────────────────────────────────────────────────

export const MODELS = {
  text:        '@cf/meta/llama-3.1-8b-instruct',
  textLarge:   '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  embed:       '@cf/baai/bge-base-en-v1.5',
  image:       '@cf/black-forest-labs/flux-1-schnell',
  transcribe:  '@cf/openai/whisper',
} as const

// ── Internal run helper ───────────────────────────────────────────────────────

// Workers AI's run() is overloaded for specific model/input pairs.
// We cast to a generic form to support dynamic model strings.
type AiRun = (model: string, inputs: Record<string, unknown>) => Promise<unknown>

function run(ai: Ai): AiRun {
  return (ai.run as unknown as AiRun).bind(ai)
}

// ── Text completion ───────────────────────────────────────────────────────────

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

export async function complete(ai: Ai, opts: CompletionOpts): Promise<string> {
  const response = await run(ai)(opts.model ?? MODELS.text, {
    messages: buildMessages(opts),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 1024,
  })
  const r = response as { response?: string }
  return r.response ?? String(response)
}

// ── Streaming completion ──────────────────────────────────────────────────────

export function completeStream(ai: Ai, opts: CompletionOpts): ReadableStream {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      try {
        // stream: true returns a ReadableStream of SSE-formatted chunks
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
  // Some models return { image: base64 }
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

export async function runInSandbox(ai: Ai, config: SandboxConfig, userMessage: string): Promise<string> {
  return complete(ai, {
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

export function streamInSandbox(ai: Ai, config: SandboxConfig, userMessage: string): ReadableStream {
  return completeStream(ai, {
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

export async function generateVibeConfig(ai: Ai, description: string, name?: string): Promise<VibeConfig> {
  const metaPrompt = `You are an AI assistant configuration generator. Given a description of an AI app, output ONLY a valid JSON object — no markdown, no explanation, no code fences.

The JSON must have exactly these fields:
{
  "name": "<string, max 128 chars, descriptive app name>",
  "description": "<string, max 512 chars, what this app does>",
  "systemPrompt": "<string, detailed system instructions that make the AI excellent at the task>",
  "tools": [],
  "model": "<'@cf/meta/llama-3.1-8b-instruct' for fast responses OR '@cf/meta/llama-3.3-70b-instruct-fp8-fast' for complex tasks>",
  "temperature": <number 0-2: 0.2 for factual, 0.7 for balanced, 1.2 for creative>,
  "maxTokens": <integer 256-4096>
}

${name ? `Use the name: "${name}"` : 'Generate an appropriate name from the description.'}

User description: "${description}"`

  const raw = await complete(ai, {
    model: MODELS.textLarge,
    prompt: metaPrompt,
    temperature: 0.2,
    maxTokens: 2048,
  })

  // Strip any accidental markdown fences
  const stripped = raw.replace(/```(?:json)?\n?/g, '').trim()
  const jsonMatch = stripped.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI did not return valid JSON for the vibe config')

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>

  // Ensure required fields exist with sensible defaults
  return {
    name:         typeof parsed.name === 'string'        ? parsed.name        : name ?? 'Untitled App',
    description:  typeof parsed.description === 'string' ? parsed.description : description.slice(0, 256),
    systemPrompt: typeof parsed.systemPrompt === 'string'? parsed.systemPrompt: 'You are a helpful assistant.',
    tools:        [],
    model:        typeof parsed.model === 'string'       ? parsed.model       : MODELS.text,
    temperature:  typeof parsed.temperature === 'number' ? parsed.temperature : 0.7,
    maxTokens:    typeof parsed.maxTokens === 'number'   ? parsed.maxTokens   : 1024,
  }
}
