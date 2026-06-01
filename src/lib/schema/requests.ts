import type { CompleteRequest, EmbedRequest, ImageRequest, CreateSandboxRequest, RunSandboxRequest, CompareRequest, SweepRequest, Tool, ToolParam } from './types'
import { isObj, str, num, bool, parseMessage } from './helpers'
import {
  DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, DEFAULT_SYSTEM_PROMPT, DEFAULT_MODEL,
  MAX_NAME_LEN, MAX_DESCRIPTION_LEN, MAX_SYSTEM_PROMPT_LEN,
  MAX_SESSION_ID_LEN, MAX_APP_HTML_LEN, MAX_JSON_SCHEMA_BYTES,
} from '../constants'

export function parseCompleteRequest(body: unknown): CompleteRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  if (!body.prompt && !body.messages) throw new Error('prompt or messages is required')
  const tc = body.toolChoice
  const re = body.reasoningEffort
  const rf = body.responseFormat
  let jsonSchema: Record<string, unknown> | undefined
  if (body.jsonSchema !== undefined) {
    if (!isObj(body.jsonSchema)) throw new Error('jsonSchema must be an object')
    if (JSON.stringify(body.jsonSchema).length > MAX_JSON_SCHEMA_BYTES)
      throw new Error(`jsonSchema must be <= ${MAX_JSON_SCHEMA_BYTES} bytes`)
    jsonSchema = body.jsonSchema as Record<string, unknown>
  }
  return {
    prompt:          body.prompt       !== undefined ? str(body.prompt,       'prompt')       : undefined,
    messages:        Array.isArray(body.messages)   ? body.messages.map((m, i) => parseMessage(m, i)) : undefined,
    systemPrompt:    body.systemPrompt !== undefined ? str(body.systemPrompt, 'systemPrompt') : undefined,
    model:           body.model        !== undefined ? str(body.model,        'model')        : undefined,
    temperature:     body.temperature  !== undefined ? num(body.temperature,  'temperature',  DEFAULT_TEMPERATURE, 0, 2)    : undefined,
    maxTokens:       body.maxTokens    !== undefined ? num(body.maxTokens,    'maxTokens',    DEFAULT_MAX_TOKENS,  1, 8192) : undefined,
    tools:           Array.isArray(body.tools)       ? (body.tools as unknown[]).slice(0, 20).map((t, i) => parseTool(t, i)) : undefined,
    toolChoice:      tc === 'required' || tc === 'none' ? tc : tc !== undefined ? 'auto' : undefined,
    responseFormat:  rf === 'json' ? 'json' : rf === 'text' ? 'text' : undefined,
    jsonSchema,
    groundingEnabled:  bool(body, 'groundingEnabled', false),
    reasoningEffort:   re === 'low' || re === 'medium' || re === 'high' ? re : undefined,
    thinking:          body.thinking !== undefined ? num(body.thinking, 'thinking', 8000, 1024, 80000) : undefined,
    byokAlias:         body.byokAlias    !== undefined ? str(body.byokAlias, 'byokAlias') : undefined,
    zdr:               bool(body, 'zdr', false),
    collectLogPayload: body.collectLogPayload !== undefined ? bool(body, 'collectLogPayload', false) : undefined,
    fallbackModel:     body.fallbackModel !== undefined ? str(body.fallbackModel, 'fallbackModel') : undefined,
  }
}

export function parseEmbedRequest(body: unknown): EmbedRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const text = body.text
  if (typeof text !== 'string' && !Array.isArray(text)) throw new Error('text must be a string or string[]')
  return {
    text: text as string | string[],
    model: body.model !== undefined ? str(body.model, 'model') : undefined,
  }
}

export function parseImageRequest(body: unknown): ImageRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  return {
    prompt: str(body.prompt, 'prompt'),
    model: body.model !== undefined ? str(body.model, 'model') : undefined,
    steps: body.steps !== undefined ? num(body.steps, 'steps', 4, 1, 20) : undefined,
  }
}

// ── Tool parser helper ────────────────────────────────────────────────────────

const VALID_PARAM_TYPES = ['string', 'number', 'boolean', 'array', 'object'] as const

export function parseTool(v: unknown, idx: number): Tool {
  if (!isObj(v)) throw new Error(`tools[${idx}] must be an object`)
  const name = str(v.name, `tools[${idx}].name`)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`tools[${idx}].name must be alphanumeric/underscore`)
  const description = str(v.description, `tools[${idx}].description`)
  const rawParams = v.parameters
  if (!isObj(rawParams)) throw new Error(`tools[${idx}].parameters must be an object`)
  const parameters: Record<string, ToolParam> = {}
  for (const [k, p] of Object.entries(rawParams)) {
    if (!isObj(p)) throw new Error(`tools[${idx}].parameters.${k} must be an object`)
    const type = str(p.type, `tools[${idx}].parameters.${k}.type`)
    if (!(VALID_PARAM_TYPES as readonly string[]).includes(type))
      throw new Error(`tools[${idx}].parameters.${k}.type must be one of ${VALID_PARAM_TYPES.join('|')}`)
    parameters[k] = {
      type: type as ToolParam['type'],
      description: str(p.description, `tools[${idx}].parameters.${k}.description`),
      required: p.required === true,
    }
  }
  return { name, description, parameters }
}

export function parseCreateSandboxRequest(body: unknown): CreateSandboxRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const name         = str(body.name,         'name')
  const description  = str(body.description,  'description',  '')
  const systemPrompt = str(body.systemPrompt, 'systemPrompt', DEFAULT_SYSTEM_PROMPT)
  if (name.length         > MAX_NAME_LEN)          throw new Error(`name must be <= ${MAX_NAME_LEN} characters`)
  if (description.length  > MAX_DESCRIPTION_LEN)   throw new Error(`description must be <= ${MAX_DESCRIPTION_LEN} characters`)
  if (systemPrompt.length > MAX_SYSTEM_PROMPT_LEN) throw new Error(`systemPrompt must be <= ${MAX_SYSTEM_PROMPT_LEN} characters`)
  const gm = body.guardMode
  const go = body.guardOutput
  const rawTools = body.tools
  const tools = Array.isArray(rawTools) ? rawTools.slice(0, 20).map((t, i) => parseTool(t, i)) : []
  return {
    name,
    description,
    systemPrompt,
    tools,
    model:       str(body.model, 'model', DEFAULT_MODEL),
    temperature: num(body.temperature, 'temperature', DEFAULT_TEMPERATURE, 0, 2),
    maxTokens:   num(body.maxTokens,   'maxTokens',   DEFAULT_MAX_TOKENS,  1, 8192),
    guardMode:   gm === 'audit' || gm === 'off' ? gm : 'strict',
    guardOutput: go === 'off' || go === 'block' || go === 'redact' ? go : 'audit',
    redactPiiOutput: bool(body, 'redactPiiOutput', false),
    ragEnabled:  bool(body, 'ragEnabled', false),
    appHtml:     body.appHtml !== undefined
      ? (() => {
          const h = str(body.appHtml, 'appHtml')
          if (h.length > MAX_APP_HTML_LEN) throw new Error(`appHtml must be <= ${MAX_APP_HTML_LEN} chars`)
          return h
        })()
      : undefined,
  }
}

export function parseRunSandboxRequest(body: unknown): RunSandboxRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const message = str(body.message, 'message')
  if (!message.trim()) throw new Error('message cannot be empty')
  let sessionId: string | undefined
  if (body.sessionId !== undefined) {
    sessionId = str(body.sessionId, 'sessionId')
    if (sessionId.length > MAX_SESSION_ID_LEN) throw new Error(`sessionId must be <= ${MAX_SESSION_ID_LEN} chars`)
    if (!/^[a-zA-Z0-9_\-]+$/.test(sessionId)) throw new Error('sessionId may only contain alphanumeric, hyphen, underscore')
  }
  return { message, sessionId }
}

export function parseCompareRequest(body: unknown): CompareRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const prompt = str(body.prompt, 'prompt')
  const models = body.models
  if (!Array.isArray(models) || models.length < 2 || models.length > 6)
    throw new Error('models must be an array of 2–6 model strings')
  if (!models.every(m => typeof m === 'string'))
    throw new Error('all models must be strings')
  return {
    prompt,
    models: models as string[],
    systemPrompt: body.systemPrompt !== undefined ? str(body.systemPrompt, 'systemPrompt') : undefined,
    temperature:  body.temperature  !== undefined ? num(body.temperature, 'temperature', DEFAULT_TEMPERATURE, 0, 2)    : undefined,
    maxTokens:    body.maxTokens    !== undefined ? num(body.maxTokens,   'maxTokens',   DEFAULT_MAX_TOKENS,  1, 8192) : undefined,
  }
}

export function parseSweepRequest(body: unknown): SweepRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const prompt = str(body.prompt, 'prompt')
  const temps = body.temperatures
  if (!Array.isArray(temps) || temps.length < 1 || temps.length > 8)
    throw new Error('temperatures must be an array of 1–8 values')
  if (!temps.every(t => typeof t === 'number' && t >= 0 && t <= 2))
    throw new Error('each temperature must be a number between 0 and 2')
  const samples = body.samples !== undefined ? num(body.samples, 'samples', 1, 1, 3) : 1
  return {
    prompt,
    temperatures: temps as number[],
    model:        body.model       !== undefined ? str(body.model,        'model')        : undefined,
    systemPrompt: body.systemPrompt !== undefined ? str(body.systemPrompt, 'systemPrompt') : undefined,
    maxTokens:    body.maxTokens   !== undefined ? num(body.maxTokens,    'maxTokens',    DEFAULT_MAX_TOKENS, 1, 8192) : undefined,
    samples,
  }
}
