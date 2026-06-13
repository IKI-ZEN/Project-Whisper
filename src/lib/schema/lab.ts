import type {
  GuardProbeRequest, AblationRequest, DriftMessage, DriftRequest,
  ContextStressRequest, RubricCriterion, EvaluateRequest, ConsistencyRequest,
  VaultAnalyzeRequest, UsageGroupBy, UsageQuery,
} from './types'
import { isObj, str, num } from './helpers'
import {
  MAX_GUARD_PROBE_CHARS, MAX_DRIFT_TURNS, MAX_STRESS_LEVELS,
  MAX_RUBRIC_CRITERIA, MAX_RUBRIC_SAMPLES, MAX_ENTROPY_SAMPLES,
  USAGE_LIMIT_DEFAULT, USAGE_LIMIT_MAX,
  DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, MAX_SYSTEM_PROMPT_LEN,
} from '../constants'
import { parseQueryInt } from '../http'
import { isUUID } from '../utils'

export function parseGuardProbeRequest(body: unknown): GuardProbeRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  if (typeof body.text !== 'string' || !body.text.trim()) throw new Error('text is required')
  if (body.text.length > MAX_GUARD_PROBE_CHARS) throw new Error(`text exceeds ${MAX_GUARD_PROBE_CHARS} character limit`)
  return { text: body.text }
}

export function parseAblationRequest(body: unknown): AblationRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const prompt = str(body.prompt, 'prompt')
  if (prompt.length > MAX_SYSTEM_PROMPT_LEN) throw new Error(`prompt exceeds ${MAX_SYSTEM_PROMPT_LEN} character limit`)
  return {
    prompt,
    model:        body.model        !== undefined ? str(body.model,        'model')        : undefined,
    systemPrompt: body.systemPrompt !== undefined ? str(body.systemPrompt, 'systemPrompt') : undefined,
    temperature:  body.temperature  !== undefined ? num(body.temperature,  'temperature',  DEFAULT_TEMPERATURE, 0, 2) : undefined,
    maxTokens:    body.maxTokens    !== undefined ? num(body.maxTokens,    'maxTokens',    DEFAULT_MAX_TOKENS, 1, 8192) : undefined,
  }
}

export function parseDriftRequest(body: unknown): DriftRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  if (!Array.isArray(body.messages)) throw new Error('messages must be an array')
  if (body.messages.length < 2 || body.messages.length > MAX_DRIFT_TURNS)
    throw new Error(`messages must have 2–${MAX_DRIFT_TURNS} user turns`)
  const messages: DriftMessage[] = body.messages.map((m: unknown, i: number) => {
    if (!isObj(m)) throw new Error(`messages[${i}] must be an object`)
    if (m.role !== 'user') throw new Error(`messages[${i}].role must be "user"`)
    return { role: 'user' as const, content: str(m.content, `messages[${i}].content`) }
  })
  return {
    messages,
    model:        body.model        !== undefined ? str(body.model,        'model')        : undefined,
    systemPrompt: body.systemPrompt !== undefined ? str(body.systemPrompt, 'systemPrompt') : undefined,
    temperature:  body.temperature  !== undefined ? num(body.temperature,  'temperature',  DEFAULT_TEMPERATURE, 0, 2) : undefined,
    maxTokens:    body.maxTokens    !== undefined ? num(body.maxTokens,    'maxTokens',    DEFAULT_MAX_TOKENS, 1, 8192) : undefined,
  }
}

export function parseContextStressRequest(body: unknown): ContextStressRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const defaults = [0, 100, 500, 1000, 2000, 4000]
  let paddingLevels = defaults
  if (body.paddingLevels !== undefined) {
    if (!Array.isArray(body.paddingLevels)) throw new Error('paddingLevels must be an array')
    if (body.paddingLevels.length > MAX_STRESS_LEVELS) throw new Error(`paddingLevels must have at most ${MAX_STRESS_LEVELS} entries`)
    paddingLevels = body.paddingLevels.map((v: unknown, i: number) => {
      if (typeof v !== 'number' || !isFinite(v) || v < 0) throw new Error(`paddingLevels[${i}] must be a non-negative number`)
      return Math.floor(v)
    })
  }
  return {
    prompt:        str(body.prompt, 'prompt'),
    systemPrompt:  body.systemPrompt !== undefined ? str(body.systemPrompt, 'systemPrompt') : undefined,
    model:         body.model        !== undefined ? str(body.model,        'model')        : undefined,
    maxTokens:     body.maxTokens    !== undefined ? num(body.maxTokens,    'maxTokens',    DEFAULT_MAX_TOKENS, 1, 8192) : undefined,
    paddingLevels,
  }
}

export function parseEvaluateRequest(body: unknown): EvaluateRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  if (!Array.isArray(body.criteria)) throw new Error('criteria must be an array')
  if (body.criteria.length < 1 || body.criteria.length > MAX_RUBRIC_CRITERIA)
    throw new Error(`criteria must have 1–${MAX_RUBRIC_CRITERIA} items`)
  const criteria: RubricCriterion[] = body.criteria.map((c: unknown, i: number) => {
    if (!isObj(c)) throw new Error(`criteria[${i}] must be an object`)
    const name   = str(c.name, `criteria[${i}].name`)
    const desc   = str(c.description, `criteria[${i}].description`)
    const weight = typeof c.weight === 'number' && isFinite(c.weight) && c.weight >= 0 && c.weight <= 1
      ? c.weight : 1 / (body.criteria as unknown[]).length
    return { name, description: desc, weight }
  })
  return {
    prompt:       str(body.prompt, 'prompt'),
    systemPrompt: body.systemPrompt !== undefined ? str(body.systemPrompt, 'systemPrompt') : undefined,
    model:        body.model        !== undefined ? str(body.model,        'model')        : undefined,
    judgeModel:   body.judgeModel   !== undefined ? str(body.judgeModel,   'judgeModel')   : undefined,
    samples:      body.samples      !== undefined ? num(body.samples, 'samples', 1, 1, MAX_RUBRIC_SAMPLES) : 1,
    criteria,
  }
}

export function parseConsistencyRequest(body: unknown): ConsistencyRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  return {
    prompt:       str(body.prompt, 'prompt'),
    model:        body.model        !== undefined ? str(body.model,        'model')        : undefined,
    systemPrompt: body.systemPrompt !== undefined ? str(body.systemPrompt, 'systemPrompt') : undefined,
    maxTokens:    body.maxTokens    !== undefined ? num(body.maxTokens,    'maxTokens',    DEFAULT_MAX_TOKENS, 1, 8192) : undefined,
    samples:      body.samples      !== undefined ? num(body.samples,      'samples',      3, 3, MAX_ENTROPY_SAMPLES) : 3,
  }
}

export function parseVaultAnalyzeRequest(body: unknown): VaultAnalyzeRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const since = body.since !== undefined
    ? (typeof body.since === 'number' && isFinite(body.since)
        ? body.since
        : (() => { throw new Error('since must be a number (unix ms)') })())
    : undefined
  return {
    k:     body.k     !== undefined ? num(body.k,     'k',     5,   2,  20)  : 5,
    limit: body.limit !== undefined ? num(body.limit, 'limit', 200, 10, 500) : 200,
    tool:  body.tool  !== undefined ? str(body.tool,  'tool')                : undefined,
    since,
  }
}

const USAGE_GROUP_BY_VALUES: UsageGroupBy[] = ['model', 'provider', 'call_type', 'sandbox_id', 'day']

export function parseUsageQuery(params: URLSearchParams): UsageQuery {
  const sandboxId = params.get('sandboxId') ?? undefined
  if (sandboxId !== undefined && !isUUID(sandboxId)) throw new Error('sandboxId must be a valid UUID')

  const model    = params.get('model')    ?? undefined
  const provider = params.get('provider') ?? undefined

  const fromStr = params.get('from')
  const toStr   = params.get('to')
  const from    = fromStr !== null ? parseInt(fromStr, 10) : undefined
  const to      = toStr   !== null ? parseInt(toStr,   10) : undefined
  if (from !== undefined && isNaN(from)) throw new Error('from must be a number (unix ms)')
  if (to   !== undefined && isNaN(to))   throw new Error('to must be a number (unix ms)')

  const groupByStr = params.get('groupBy') ?? undefined
  if (groupByStr !== undefined && !(USAGE_GROUP_BY_VALUES as string[]).includes(groupByStr)) {
    throw new Error(`groupBy must be one of: ${USAGE_GROUP_BY_VALUES.join(', ')}`)
  }
  const groupBy = groupByStr as UsageGroupBy | undefined

  const limit = parseQueryInt(params, 'limit', USAGE_LIMIT_DEFAULT, 1, USAGE_LIMIT_MAX)

  return { sandboxId, model, provider, from, to, groupBy, limit }
}
