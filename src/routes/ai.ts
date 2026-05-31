import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, sseResponse, parseBody } from '../lib/http'
import {
  complete, completeStream, embed, generateImage, generateImageGateway, transcribe, synthesizeSpeech, MODELS,
} from '../lib/ai'
import {
  parseCompleteRequest, parseEmbedRequest, parseImageRequest,
  parseCompareRequest, parseSweepRequest, parseUsageQuery, parseTTSRequest,
} from '../lib/schema'
import { toBase64, now } from '../lib/utils'
import { MAX_AUDIO_BYTES } from '../lib/constants'
import { requireAccess } from '../lib/access'

export const aiRoutes: Array<[string, string, Handler]> = [

  // POST /api/ai/complete — blocking text completion
  ['POST', '/api/ai/complete', async (req: Request, env: Env) => {
    const p = await parseBody(req, parseCompleteRequest)
    if (!p.ok) return p.response
    try {
      const response = await complete(env.AI, env, p.data)
      return json(ok({ response }))
    } catch (e) {
      return json(err('AI completion failed'), 500)
    }
  }],

  // POST /api/ai/stream — SSE token stream
  ['POST', '/api/ai/stream', async (req: Request, env: Env) => {
    const p = await parseBody(req, parseCompleteRequest)
    if (!p.ok) return p.response
    return sseResponse(completeStream(env.AI, env, p.data))
  }],

  // POST /api/ai/embed — generate embeddings
  ['POST', '/api/ai/embed', async (req: Request, env: Env) => {
    const p = await parseBody(req, parseEmbedRequest)
    if (!p.ok) return p.response
    try {
      const embeddings = await embed(env.AI, p.data.text, p.data.model, env)
      return json(ok({ embeddings, count: embeddings.length }))
    } catch (e) {
      return json(err('Embedding failed'), 500)
    }
  }],

  // POST /api/ai/image — generate image via Workers AI (default) or gateway (fal:/ideogram: prefix)
  ['POST', '/api/ai/image', async (req: Request, env: Env) => {
    const p = await parseBody(req, parseImageRequest)
    if (!p.ok) return p.response
    const model = p.data.model ?? ''
    const isGateway = model.startsWith('fal:') || model.startsWith('ideogram:')
    try {
      if (isGateway) {
        const url = await generateImageGateway(env, p.data.prompt, model)
        return json(ok({ url, format: 'url' }))
      }
      const bytes = await generateImage(env.AI, p.data.prompt, model || undefined, p.data.steps, env)
      return json(ok({ image: toBase64(bytes), format: 'png' }))
    } catch (e) {
      return json(err('Image generation failed'), 500)
    }
  }],

  // POST /api/ai/tts — text-to-speech via ElevenLabs or Cartesia; returns binary audio
  ['POST', '/api/ai/tts', async (req: Request, env: Env) => {
    const p = await parseBody(req, parseTTSRequest)
    if (!p.ok) return p.response
    try {
      const { audio, contentType } = await synthesizeSpeech(env, p.data)
      return new Response(audio, {
        headers: { 'Content-Type': contentType, 'Content-Length': String(audio.byteLength) },
      })
    } catch (e) {
      return json(err('TTS failed'), 500)
    }
  }],

  // POST /api/ai/transcribe — multipart/form-data, field: "audio"
  ['POST', '/api/ai/transcribe', async (req: Request, env: Env) => {
    let formData: FormData
    try {
      formData = await req.formData()
    } catch (e) {
      return json(err('Expected multipart/form-data', String(e)), 400)
    }

    const audioFile = formData.get('audio')
    // FormDataEntryValue = File | string — non-string means it's a File blob
    if (!audioFile || typeof audioFile === 'string') {
      return json(err("Missing 'audio' file field in form data"), 400)
    }
    const audioBlob = audioFile as File

    if (audioBlob.size === 0) return json(err('Audio file is empty'), 400)
    if (audioBlob.size > MAX_AUDIO_BYTES) return json(err('Audio file too large (max 25 MB)'), 413)

    // Reject clearly non-audio MIME types; allow audio/*, video/*, octet-stream
    const mime = audioBlob.type ?? ''
    if (mime && !mime.startsWith('audio/') && !mime.startsWith('video/') && mime !== 'application/octet-stream') {
      return json(err('Invalid file type — expected audio or video'), 400)
    }

    const model = formData.get('model')

    try {
      const buffer = await audioBlob.arrayBuffer()
      const text = await transcribe(env.AI, buffer, typeof model === 'string' ? model : undefined, env)
      return json(ok({ text }))
    } catch (e) {
      return json(err('Transcription failed'), 500)
    }
  }],

  // POST /api/ai/compare — run same prompt across multiple models in parallel
  ['POST', '/api/ai/compare', async (req: Request, env: Env) => {
    const p = await parseBody(req, parseCompareRequest)
    if (!p.ok) return p.response
    const { models, ...opts } = p.data
    const results = await Promise.all(models.map(async model => {
      const start = now()
      try {
        const response = await complete(env.AI, env, { ...opts, model })
        return { model, response, latencyMs: now() - start, error: null }
      } catch (e) {
        return { model, response: null, latencyMs: now() - start, error: String(e) }
      }
    }))
    return json(ok({ results }))
  }],

  // POST /api/ai/sweep — run same prompt at multiple temperatures (attractor basin mapping)
  ['POST', '/api/ai/sweep', async (req: Request, env: Env) => {
    const p = await parseBody(req, parseSweepRequest)
    if (!p.ok) return p.response
    const { prompt, temperatures, model, systemPrompt, maxTokens, samples = 1 } = p.data
    const results = await Promise.all(temperatures.map(async temperature => {
      const start = now()
      const responses = await Promise.all(
        Array.from({ length: samples }, () =>
          complete(env.AI, env, { prompt, model, systemPrompt, maxTokens, temperature })
            .catch(e => `[error: ${String(e)}]`),
        ),
      )
      return { temperature, responses, latencyMs: now() - start }
    }))
    return json(ok({ results, model: model ?? MODELS.text }))
  }],

  // GET /api/usage — aggregate cost/token usage (CF Access required when configured)
  ['GET', '/api/usage', async (req: Request, env: Env) => {
    const { deny } = await requireAccess(req, env)
    if (deny) return deny

    let query: ReturnType<typeof parseUsageQuery>
    try {
      query = parseUsageQuery(new URL(req.url).searchParams)
    } catch (e) {
      return json(err(String(e)), 422)
    }

    const { sandboxId, model, provider, from, to, groupBy, limit } = query

    // Build WHERE clause
    const conditions: string[] = []
    const bindings: (string | number)[] = []
    if (sandboxId) { conditions.push('sandbox_id = ?'); bindings.push(sandboxId) }
    if (model)     { conditions.push('model = ?');      bindings.push(model) }
    if (provider)  { conditions.push('provider = ?');   bindings.push(provider) }
    if (from !== undefined) { conditions.push('created_at >= ?'); bindings.push(from) }
    if (to   !== undefined) { conditions.push('created_at <= ?'); bindings.push(to) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Build GROUP BY / SELECT
    let selectCols: string
    let groupBySql: string
    if (groupBy === 'day') {
      selectCols = `strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS period`
      groupBySql = `GROUP BY period`
    } else if (groupBy) {
      selectCols = `${groupBy} AS period`
      groupBySql = `GROUP BY ${groupBy}`
    } else {
      selectCols = `'all' AS period`
      groupBySql = ''
    }

    const sql = `
      SELECT ${selectCols},
             SUM(cost_usd)   AS totalCostUsd,
             SUM(tokens_in)  AS totalTokensIn,
             SUM(tokens_out) AS totalTokensOut,
             COUNT(*)        AS totalCalls
      FROM usage_metrics
      ${where}
      ${groupBySql}
      ORDER BY totalCostUsd DESC
      LIMIT ?
    `
    bindings.push(limit)

    try {
      const stmt = env.DB.prepare(sql)
      const result = await stmt.bind(...bindings).all<{
        period: string; totalCostUsd: number; totalTokensIn: number; totalTokensOut: number; totalCalls: number
      }>()
      const rows = result.results ?? []
      const totalCostUsd   = rows.reduce((s, r) => s + (r.totalCostUsd   ?? 0), 0)
      const totalCalls     = rows.reduce((s, r) => s + (r.totalCalls     ?? 0), 0)
      const totalTokensIn  = rows.reduce((s, r) => s + (r.totalTokensIn  ?? 0), 0)
      const totalTokensOut = rows.reduce((s, r) => s + (r.totalTokensOut ?? 0), 0)
      return json(ok({ rows, totalCostUsd, totalCalls, totalTokensIn, totalTokensOut }))
    } catch (e) {
      return json(err('Usage query failed', String(e)), 500)
    }
  }],
]
