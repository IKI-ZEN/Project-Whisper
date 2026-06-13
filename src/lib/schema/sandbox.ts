import type { ReindexBody, SessionBody, PatchSandboxRequest } from './types'
import { isObj, str, num, bool } from './helpers'
import {
  MAX_SESSION_ID_LEN, MAX_NAME_LEN, MAX_DESCRIPTION_LEN, MAX_SYSTEM_PROMPT_LEN,
  DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS,
} from '../constants'
import { parseTool } from './requests'

export function parseReindexBody(body: unknown): ReindexBody {
  if (body === null || body === undefined) return { docIds: undefined }
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  if (body.docIds === undefined) return { docIds: undefined }
  if (!Array.isArray(body.docIds)) throw new Error('docIds must be an array')
  return { docIds: body.docIds.map((d, i) => {
    if (typeof d !== 'string') throw new Error(`docIds[${i}] must be a string`)
    return d
  }) }
}

export function parseSessionBody(body: unknown): SessionBody {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  if (body.sessionId === undefined) return { sessionId: undefined }
  if (typeof body.sessionId !== 'string') throw new Error('sessionId must be a string')
  if (body.sessionId.length > MAX_SESSION_ID_LEN) throw new Error(`sessionId must be <= ${MAX_SESSION_ID_LEN} characters`)
  return { sessionId: body.sessionId || undefined }
}

export function parsePatchSandboxRequest(body: unknown): PatchSandboxRequest {
  if (!isObj(body)) throw new Error('Body must be a JSON object')
  const out: PatchSandboxRequest = {}
  if (body.name         !== undefined) out.name         = str(body.name, 'name').slice(0, MAX_NAME_LEN)
  if (body.description  !== undefined) out.description  = str(body.description, 'description').slice(0, MAX_DESCRIPTION_LEN)
  if (body.systemPrompt !== undefined) {
    const sp = str(body.systemPrompt, 'systemPrompt')
    if (sp.length > MAX_SYSTEM_PROMPT_LEN) throw new Error(`systemPrompt must be <= ${MAX_SYSTEM_PROMPT_LEN} characters`)
    out.systemPrompt = sp
  }
  if (body.model        !== undefined) out.model        = str(body.model, 'model')
  if (body.temperature  !== undefined) out.temperature  = num(body.temperature, 'temperature', DEFAULT_TEMPERATURE, 0, 2)
  if (body.maxTokens    !== undefined) out.maxTokens    = num(body.maxTokens, 'maxTokens', DEFAULT_MAX_TOKENS, 64, 8192)
  if (body.ragEnabled   !== undefined) out.ragEnabled   = bool(body, 'ragEnabled', false)
  if (body.guardMode    !== undefined) {
    const gm = str(body.guardMode, 'guardMode')
    if (gm !== 'strict' && gm !== 'audit' && gm !== 'off')
      throw new Error("guardMode must be 'strict', 'audit', or 'off'")
    out.guardMode = gm
  }
  if (body.guardOutput  !== undefined) {
    const go = str(body.guardOutput, 'guardOutput')
    if (go !== 'off' && go !== 'audit' && go !== 'block' && go !== 'redact')
      throw new Error("guardOutput must be 'off', 'audit', 'block', or 'redact'")
    out.guardOutput = go
  }
  if (body.redactPiiOutput !== undefined) out.redactPiiOutput = bool(body, 'redactPiiOutput', false)
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) throw new Error('tools must be an array')
    out.tools = (body.tools as unknown[]).slice(0, 20).map((t, i) => parseTool(t, i))
  }
  return out
}
