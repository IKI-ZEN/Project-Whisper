import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, sseResponse, readJson } from '../lib/http'
import {
  complete, completeStream, embed, generateImage, transcribe,
} from '../lib/ai'
import {
  parseCompleteRequest, parseEmbedRequest, parseImageRequest,
} from '../lib/schema'
import { toBase64 } from '../lib/utils'

export const aiRoutes: Array<[string, string, Handler]> = [

  // POST /api/ai/complete — blocking text completion
  ['POST', '/api/ai/complete', async (req: Request, env: Env) => {
    let body: unknown
    try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
    let parsed
    try { parsed = parseCompleteRequest(body) } catch (e) { return json(err(String(e)), 422) }

    try {
      const response = await complete(env.AI, env, parsed)
      return json(ok({ response }))
    } catch (e) {
      return json(err('AI completion failed', String(e)), 500)
    }
  }],

  // POST /api/ai/stream — SSE token stream
  ['POST', '/api/ai/stream', async (req: Request, env: Env) => {
    let body: unknown
    try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
    let parsed
    try { parsed = parseCompleteRequest(body) } catch (e) { return json(err(String(e)), 422) }

    return sseResponse(completeStream(env.AI, env, parsed))
  }],

  // POST /api/ai/embed — generate embeddings
  ['POST', '/api/ai/embed', async (req: Request, env: Env) => {
    let body: unknown
    try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
    let parsed
    try { parsed = parseEmbedRequest(body) } catch (e) { return json(err(String(e)), 422) }

    try {
      const embeddings = await embed(env.AI, parsed.text, parsed.model)
      return json(ok({ embeddings, count: embeddings.length }))
    } catch (e) {
      return json(err('Embedding failed', String(e)), 500)
    }
  }],

  // POST /api/ai/image — generate image, returns base64 PNG
  ['POST', '/api/ai/image', async (req: Request, env: Env) => {
    let body: unknown
    try { body = await readJson(req) } catch (e) { return json(err(String(e)), 400) }
    let parsed
    try { parsed = parseImageRequest(body) } catch (e) { return json(err(String(e)), 422) }

    try {
      const bytes = await generateImage(env.AI, parsed.prompt, parsed.model, parsed.steps)
      return json(ok({ image: toBase64(bytes), format: 'png' }))
    } catch (e) {
      return json(err('Image generation failed', String(e)), 500)
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
    const audioBlob = audioFile as unknown as { arrayBuffer(): Promise<ArrayBuffer> }

    const model = formData.get('model')

    try {
      const buffer = await audioBlob.arrayBuffer()
      const text = await transcribe(env.AI, buffer, typeof model === 'string' ? model : undefined)
      return json(ok({ text }))
    } catch (e) {
      return json(err('Transcription failed', String(e)), 500)
    }
  }],
]
