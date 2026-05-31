// ── Public complete ───────────────────────────────────────────────────────────

import type { Env } from '../../types/env'
import { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, AI_GATEWAY_TIMEOUT_MS, CARTESIA_API_VERSION, FALLBACK_TELEMETRY_BLOB, MAX_EMBED_CHARS } from '../constants'
import { sha256, now } from '../utils'
import { estimateCost, type CallType } from '../pricing'
import { sseEvent } from '../http'
import { MODELS } from './models'
import { type CompletionOpts, contentToText, buildMessages } from './messages'
import { parseGateway, gatewayBase, run, dispatchComplete, streamOpenAI, streamAnthropic, streamGoogle, streamCohere, toReadableStream } from './gateway'

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
  ).bind(sandboxId ?? '', model, tokensIn, tokensOut, latencyMs, null, now(), provider, callType, cost).run()
}

export async function complete(ai: Ai, env: Env, opts: CompletionOpts): Promise<string> {
  const t0 = now()
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
  const latencyMs   = now() - t0
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
  const t0 = now()
  const gw = parseGateway(opts.model ?? '')
  let raw: string
  if (gw?.def.format === 'anthropic') {
    raw = await dispatchComplete(ai, env, { ...opts, thinking: opts.budgetTokens ?? 8000, temperature: 1 })
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
  return { thinking, response, latencyMs: now() - t0 }
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
            Math.ceil(inputText.length / 4), Math.ceil(accumulated.length / 4), now() - t0)
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
  const t0 = now()
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

  const t0 = now()
  const response = await run(ai)(model ?? MODELS.embed, { text: texts })
  const r = response as { data?: number[][] }
  const result = r.data ?? []

  void caches.default.put(cacheKey, new Response(JSON.stringify(result), {
    headers: { 'Cache-Control': 'max-age=86400', 'Content-Type': 'application/json' },
  }))

  if (env) {
    logUsage(env, undefined, model ?? MODELS.embed, 'workers-ai', 'embed',
      Math.ceil(totalLen / 4), 0, now() - t0)
  }

  return result.map(r => new Float32Array(r))
}

// ── Image generation ──────────────────────────────────────────────────────────

export async function generateImage(ai: Ai, prompt: string, model?: string, steps?: number, env?: Env): Promise<Uint8Array> {
  const t0 = now()
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

  if (env) logUsage(env, undefined, model ?? MODELS.image, 'workers-ai', 'image', 1, 0, now() - t0)
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
  const t0 = now()
  const response = await run(ai)(model ?? MODELS.transcribe, {
    audio: [...new Uint8Array(audio)],
  })
  const r = response as { text?: string }
  const text = r.text ?? ''
  if (env) {
    logUsage(env, undefined, model ?? MODELS.transcribe, 'workers-ai', 'transcribe',
      Math.ceil(audio.byteLength / 16000), 0, now() - t0)
  }
  return text
}
