import { isObj, str, num } from './helpers'
import { MAX_ENV_MODELS, DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS } from '../constants'

export function parsePatchEnvironmentRequest(body: unknown): {
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  envModels?: string[]
} {
  if (!isObj(body)) throw new Error('Body must be a JSON object')
  const out: { systemPrompt?: string; temperature?: number; maxTokens?: number; envModels?: string[] } = {}
  if (body.systemPrompt !== undefined) out.systemPrompt = str(body.systemPrompt, 'systemPrompt')
  if (body.temperature  !== undefined) out.temperature  = num(body.temperature, 'temperature', DEFAULT_TEMPERATURE, 0, 2)
  if (body.maxTokens    !== undefined) out.maxTokens    = num(body.maxTokens, 'maxTokens', DEFAULT_MAX_TOKENS, 64, 8192)
  if (body.envModels    !== undefined) {
    if (!Array.isArray(body.envModels) || body.envModels.length === 0 || body.envModels.length > MAX_ENV_MODELS)
      throw new Error(`envModels must be an array of 1–${MAX_ENV_MODELS} model strings`)
    if (!(body.envModels as unknown[]).every((m: unknown) => typeof m === 'string'))
      throw new Error('All envModels entries must be strings')
    out.envModels = body.envModels as string[]
  }
  return out
}
