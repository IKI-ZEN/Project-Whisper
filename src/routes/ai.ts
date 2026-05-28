// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 IKI-ZEN

import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, sseResponse, parseBody } from '../lib/http'
import {
  complete, completeStream, embed, generateImage, transcribe, MODELS,
} from '../lib/ai'
import {
  parseCompleteRequest, parseEmbedRequest, parseImageRequest,
  parseCompareRequest, parseSweepRequest,
} from '../lib/schema'
import { toBase64 } from '../lib/utils'
import { MAX_AUDIO_BYTES } from '../lib/constants'

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
      const embeddings = await embed(env.AI, p.data.text, p.data.model)
      return json(ok({ embeddings, count: embeddings.length }))
    } catch (e) {
      return json(err('Embedding failed'), 500)
    }
  }],

  // POST /api/ai/image — generate image, returns base64 PNG
  ['POST', '/api/ai/image', async (req: Request, env: Env) => {
    const p = await parseBody(req, parseImageRequest)
    if (!p.ok) return p.response
    try {
      const bytes = await generateImage(env.AI, p.data.prompt, p.data.model, p.data.steps)
      return json(ok({ image: toBase64(bytes), format: 'png' }))
    } catch (e) {
      return json(err('Image generation failed'), 500)
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
      const text = await transcribe(env.AI, buffer, typeof model === 'string' ? model : undefined)
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
      const start = Date.now()
      try {
        const response = await complete(env.AI, env, { ...opts, model })
        return { model, response, latencyMs: Date.now() - start, error: null }
      } catch (e) {
        return { model, response: null, latencyMs: Date.now() - start, error: String(e) }
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
      const start = Date.now()
      const responses = await Promise.all(
        Array.from({ length: samples }, () =>
          complete(env.AI, env, { prompt, model, systemPrompt, maxTokens, temperature })
            .catch(e => `[error: ${String(e)}]`),
        ),
      )
      return { temperature, responses, latencyMs: Date.now() - start }
    }))
    return json(ok({ results, model: model ?? MODELS.text }))
  }],
]
