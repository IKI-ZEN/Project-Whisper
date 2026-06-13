import type { TTSRequest } from './types'
import { isObj, str, num } from './helpers'
import { MAX_TTS_TEXT_LEN } from '../constants'

export function parseTTSRequest(body: unknown): TTSRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const providerRaw = typeof body.provider === 'string' ? body.provider : 'elevenlabs'
  if (providerRaw !== 'elevenlabs' && providerRaw !== 'cartesia')
    throw new Error('provider must be "elevenlabs" or "cartesia"')
  const provider = providerRaw as 'elevenlabs' | 'cartesia'
  const text = str(body.text, 'text')
  if (text.length === 0) throw new Error('text is required')
  if (text.length > MAX_TTS_TEXT_LEN) throw new Error(`text must be <= ${MAX_TTS_TEXT_LEN} characters`)
  const result: TTSRequest = { provider, text }
  if (body.voiceId    !== undefined) result.voiceId  = str(body.voiceId, 'voiceId')
  if (body.modelId    !== undefined) result.modelId  = str(body.modelId, 'modelId')
  if (body.voice      !== undefined) {
    if (!isObj(body.voice)) throw new Error('voice must be an object')
    result.voice = { mode: str(body.voice.mode, 'voice.mode'), id: str(body.voice.id, 'voice.id') }
  }
  if (body.outputFormat !== undefined) {
    if (!isObj(body.outputFormat)) throw new Error('outputFormat must be an object')
    result.outputFormat = {
      container:  str(body.outputFormat.container,  'outputFormat.container'),
      encoding:   str(body.outputFormat.encoding,   'outputFormat.encoding'),
      sampleRate: num(body.outputFormat.sampleRate, 'outputFormat.sampleRate', 44100, 8000, 48000),
    }
  }
  return result
}
