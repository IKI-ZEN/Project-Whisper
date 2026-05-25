import {
  DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, DEFAULT_SYSTEM_PROMPT, DEFAULT_MODEL,
  MAX_NAME_LEN, MAX_DESCRIPTION_LEN, MAX_SYSTEM_PROMPT_LEN, MAX_VIBE_DESCRIPTION,
} from './constants'

// ── Domain types ──────────────────────────────────────────────────────────────

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface ToolParam {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description: string
  required?: boolean
}

export interface Tool {
  name: string
  description: string
  parameters: Record<string, ToolParam>
}

export interface SandboxConfig {
  id: string
  name: string
  description: string
  systemPrompt: string
  tools: Tool[]
  model: string
  temperature: number
  maxTokens: number
  memory: Message[]
  createdAt: number
  updatedAt: number
  integrityHash?: string
  guardMode?: 'strict' | 'audit' | 'off'
}

// ── Request shapes ─────────────────────────────────────────────────────────────

export interface CompleteRequest {
  prompt?: string
  messages?: Message[]
  systemPrompt?: string
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface EmbedRequest {
  text: string | string[]
  model?: string
}

export interface ImageRequest {
  prompt: string
  model?: string
  steps?: number
}

export interface CreateSandboxRequest {
  name: string
  description: string
  systemPrompt: string
  tools: Tool[]
  model: string
  temperature: number
  maxTokens: number
  guardMode?: 'strict' | 'audit' | 'off'
}

export interface CompareRequest {
  prompt: string
  models: string[]
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}

export interface SweepRequest {
  prompt: string
  temperatures: number[]
  model?: string
  systemPrompt?: string
  maxTokens?: number
  samples?: number
}

export interface RunSandboxRequest {
  message: string
}

export interface VibeRequest {
  description: string
  name?: string
}

// ── Parsers ───────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, field: string): string
function str(v: unknown, field: string, fallback: string): string
function str(v: unknown, field: string, fallback?: string): string {
  if (v === undefined || v === null) {
    if (fallback !== undefined) return fallback
    throw new Error(`${field} is required`)
  }
  if (typeof v !== 'string') throw new Error(`${field} must be a string`)
  return v
}

function num(v: unknown, field: string, fallback: number, min?: number, max?: number): number {
  if (v === undefined || v === null) return fallback
  if (typeof v !== 'number' || !isFinite(v)) throw new Error(`${field} must be a finite number`)
  if (min !== undefined && v < min) throw new Error(`${field} must be >= ${min}`)
  if (max !== undefined && v > max) throw new Error(`${field} must be <= ${max}`)
  return v
}

export function parseCompleteRequest(body: unknown): CompleteRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  if (!body.prompt && !body.messages) throw new Error('prompt or messages is required')
  return {
    prompt:       body.prompt       !== undefined ? str(body.prompt,       'prompt')       : undefined,
    messages:     Array.isArray(body.messages)   ? (body.messages as Message[])            : undefined,
    systemPrompt: body.systemPrompt !== undefined ? str(body.systemPrompt, 'systemPrompt') : undefined,
    model:        body.model        !== undefined ? str(body.model,        'model')        : undefined,
    temperature:  body.temperature  !== undefined ? num(body.temperature,  'temperature',  DEFAULT_TEMPERATURE, 0, 2)    : undefined,
    maxTokens:    body.maxTokens    !== undefined ? num(body.maxTokens,    'maxTokens',    DEFAULT_MAX_TOKENS,  1, 8192) : undefined,
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

export function parseCreateSandboxRequest(body: unknown): CreateSandboxRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const name         = str(body.name,         'name')
  const description  = str(body.description,  'description',  '')
  const systemPrompt = str(body.systemPrompt, 'systemPrompt', DEFAULT_SYSTEM_PROMPT)
  if (name.length         > MAX_NAME_LEN)          throw new Error(`name must be <= ${MAX_NAME_LEN} characters`)
  if (description.length  > MAX_DESCRIPTION_LEN)   throw new Error(`description must be <= ${MAX_DESCRIPTION_LEN} characters`)
  if (systemPrompt.length > MAX_SYSTEM_PROMPT_LEN) throw new Error(`systemPrompt must be <= ${MAX_SYSTEM_PROMPT_LEN} characters`)
  const gm = body.guardMode
  return {
    name,
    description,
    systemPrompt,
    tools:       [],
    model:       str(body.model, 'model', DEFAULT_MODEL),
    temperature: num(body.temperature, 'temperature', DEFAULT_TEMPERATURE, 0, 2),
    maxTokens:   num(body.maxTokens,   'maxTokens',   DEFAULT_MAX_TOKENS,  1, 8192),
    guardMode:   gm === 'audit' || gm === 'off' ? gm : 'strict',
  }
}

export function parseRunSandboxRequest(body: unknown): RunSandboxRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const message = str(body.message, 'message')
  if (!message.trim()) throw new Error('message cannot be empty')
  return { message }
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

export function parseVibeRequest(body: unknown): VibeRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const description = str(body.description, 'description')
  if (description.length < 10)               throw new Error('description must be at least 10 characters')
  if (description.length > MAX_VIBE_DESCRIPTION) throw new Error(`description must be <= ${MAX_VIBE_DESCRIPTION} characters`)
  return {
    description,
    name: body.name !== undefined ? str(body.name, 'name') : undefined,
  }
}
