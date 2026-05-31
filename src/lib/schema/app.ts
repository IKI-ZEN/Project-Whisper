import type {
  AppStateValueRequest, EmailRequest, BuildRequest, ReindexBody, SessionBody,
  GuardProbeRequest, AblationRequest, DriftMessage, DriftRequest,
  ContextStressRequest, RubricCriterion, EvaluateRequest, ConsistencyRequest,
  UsageGroupBy, UsageQuery, CreatePipelineRequest, PatchPipelineRequest,
  PipelineRunRequest, VaultAnalyzeRequest, TTSRequest, PatchSandboxRequest,
  Tool,
} from './types'
import { isObj, str, num, bool } from './helpers'
import {
  MAX_APP_STATE_VALUE_LEN, MAX_APP_STATE_KEY_LEN, APP_STATE_KEY_RE,
  MAX_EMAIL_SUBJECT_LEN, MAX_EMAIL_TEXT_LEN,
  MAX_BUILD_DESCRIPTION_LEN, MAX_GUARD_PROBE_CHARS, MAX_ABLATION_CLAUSES,
  MAX_DRIFT_TURNS, MAX_STRESS_LEVELS, MAX_RUBRIC_CRITERIA, MAX_RUBRIC_SAMPLES,
  MAX_WEBHOOK_URL_LEN, MAX_TTS_TEXT_LEN, AI_SEARCH_MAX_RESULTS,
  USAGE_LIMIT_DEFAULT, USAGE_LIMIT_MAX,
  DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, MAX_NAME_LEN, MAX_SYSTEM_PROMPT_LEN,
  MAX_ENV_MODELS, MAX_DESCRIPTION_LEN,
  MAX_ENTROPY_SAMPLES, MAX_SESSION_ID_LEN,
} from '../constants'
import { parseQueryInt } from '../http'
import { isUUID } from '../utils'
import { parsePipelineRequest } from './whisperer'
import { parseTool } from './requests'

// ── App State / Email parsers ─────────────────────────────────────────────────

export function parseAppStateValueRequest(body: unknown, key: string): AppStateValueRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const value = str(body.value, 'value')
  if (value.length > MAX_APP_STATE_VALUE_LEN)
    throw new Error(`value must be <= ${MAX_APP_STATE_VALUE_LEN} characters`)
  if (key.length > MAX_APP_STATE_KEY_LEN)
    throw new Error(`key must be <= ${MAX_APP_STATE_KEY_LEN} characters`)
  if (!APP_STATE_KEY_RE.test(key))
    throw new Error('key may only contain alphanumeric, dot, underscore, hyphen, or slash')
  return { key, value }
}

export function parseEmailRequest(body: unknown): EmailRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const to = str(body.to, 'to')
  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(to))
    throw new Error('to must be a valid email address')
  const subject = str(body.subject, 'subject')
  if (subject.length === 0 || subject.length > MAX_EMAIL_SUBJECT_LEN)
    throw new Error(`subject must be a non-empty string <= ${MAX_EMAIL_SUBJECT_LEN} characters`)
  const text = str(body.text, 'text')
  if (text.length === 0 || text.length > MAX_EMAIL_TEXT_LEN)
    throw new Error(`text must be a non-empty string <= ${MAX_EMAIL_TEXT_LEN} characters`)
  return {
    to: to.trim().toLowerCase(),
    subject,
    text,
    html: body.html !== undefined ? str(body.html, 'html') : undefined,
  }
}

// ── App Builder ───────────────────────────────────────────────────────────────

export function parseBuildRequest(body: unknown): BuildRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const description = str(body.description, 'description')
  if (!description.trim())                           throw new Error('description must not be empty')
  if (description.length > MAX_BUILD_DESCRIPTION_LEN) throw new Error(`description must be <= ${MAX_BUILD_DESCRIPTION_LEN} characters`)
  const name      = body.name      !== undefined ? str(body.name,      'name')      : undefined
  const sandboxId = body.sandboxId !== undefined ? str(body.sandboxId, 'sandboxId') : undefined
  const model     = body.model     !== undefined ? str(body.model,     'model')     : undefined
  if (name      && name.length      > MAX_NAME_LEN) throw new Error(`name must be <= ${MAX_NAME_LEN} characters`)
  if (sandboxId && sandboxId.length > 64)           throw new Error('sandboxId must be <= 64 characters')
  if (model     && model.length     > 128)          throw new Error('model must be <= 128 characters')
  return { description: description.trim(), name, sandboxId, model }
}

// ── Optional-body parsers (used with parseBodyOptional) ───────────────────────

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

// ── Guard Laboratory ──────────────────────────────────────────────────────────

export function parseGuardProbeRequest(body: unknown): GuardProbeRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  if (typeof body.text !== 'string' || !body.text.trim()) throw new Error('text is required')
  if (body.text.length > MAX_GUARD_PROBE_CHARS) throw new Error(`text exceeds ${MAX_GUARD_PROBE_CHARS} character limit`)
  return { text: body.text }
}

// ── Prompt Ablation ───────────────────────────────────────────────────────────

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

// ── Multi-Turn Drift ──────────────────────────────────────────────────────────

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

// ── Context Stress Test ───────────────────────────────────────────────────────

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

// ── Rubric Evaluator ──────────────────────────────────────────────────────────

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

// ── Consistency Probe ─────────────────────────────────────────────────────────

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

// ── Usage query params ────────────────────────────────────────────────────────

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

// ── Saved Pipelines ───────────────────────────────────────────────────────────

export function parseCreatePipeline(body: unknown): CreatePipelineRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const name = str(body.name, 'name')
  if (name.length > MAX_NAME_LEN) throw new Error(`name must be <= ${MAX_NAME_LEN} characters`)
  const description = body.description !== undefined ? str(body.description, 'description', '') : ''
  if (description.length > MAX_DESCRIPTION_LEN) throw new Error(`description must be <= ${MAX_DESCRIPTION_LEN} characters`)
  // Reuse parsePipelineRequest for node validation; inject a dummy input so it satisfies the schema
  const { nodes, entryId } = parsePipelineRequest({ ...body, input: body.input ?? '' })
  return { name, description, nodes, entryId }
}

export function parsePatchPipeline(body: unknown): PatchPipelineRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const out: PatchPipelineRequest = {}
  if (body.name !== undefined) {
    const name = str(body.name, 'name')
    if (name.length > MAX_NAME_LEN) throw new Error(`name must be <= ${MAX_NAME_LEN} characters`)
    out.name = name
  }
  if (body.description !== undefined) {
    out.description = str(body.description, 'description', '')
    if (out.description.length > MAX_DESCRIPTION_LEN)
      throw new Error(`description must be <= ${MAX_DESCRIPTION_LEN} characters`)
  }
  if (body.nodes !== undefined || body.entryId !== undefined) {
    if (body.nodes === undefined || body.entryId === undefined)
      throw new Error('nodes and entryId must be provided together')
    const { nodes, entryId } = parsePipelineRequest({ nodes: body.nodes, entryId: body.entryId, input: '' })
    out.nodes   = nodes
    out.entryId = entryId
  }
  return out
}

export function parsePipelineRunRequest(body: unknown): PipelineRunRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  return { input: str(body.input, 'input') }
}

// ── Vault Cluster Analysis ────────────────────────────────────────────────────

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

// ── Probe Webhook ─────────────────────────────────────────────────────────────

const BLOCKED_WEBHOOK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(p => !Number.isFinite(p) || p < 0 || p > 255)) return false
  const [a, b] = parts
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  return false
}

export function isPrivateIp(host: string): boolean {
  // Strip brackets from IPv6 literals (URL.hostname returns e.g. "[fc00::1]")
  const h = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()

  // IPv4-mapped IPv6, dotted form: ::ffff:192.168.1.1
  const v4mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (v4mapped) return isPrivateIpv4(v4mapped[1])
  // IPv4-mapped IPv6, hex form (WHATWG URL canonicalizes ::ffff:192.168.1.1 → ::ffff:c0a8:101)
  const v4mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (v4mappedHex) {
    const hi = parseInt(v4mappedHex[1], 16)
    const lo = parseInt(v4mappedHex[2], 16)
    return isPrivateIpv4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`)
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return isPrivateIpv4(h)

  // IPv6 literals contain colons; only then apply IPv6 range checks
  if (h.includes(':')) {
    if (h === '::1') return true            // loopback ::1/128
    if (/^fe[89ab]/.test(h)) return true    // link-local fe80::/10
    if (/^f[cd]/.test(h)) return true       // unique-local fc00::/7
  }
  return false
}

export function parseWebhookUrl(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new Error('webhookUrl must be a string')
  if (v.length === 0) return undefined
  if (!v.startsWith('https://')) throw new Error('webhookUrl must start with https://')
  if (v.length > MAX_WEBHOOK_URL_LEN) throw new Error(`webhookUrl must be <= ${MAX_WEBHOOK_URL_LEN} characters`)
  let parsed: URL
  try { parsed = new URL(v) } catch { throw new Error('webhookUrl must be a valid URL') }
  const host = parsed.hostname.toLowerCase()
  if (BLOCKED_WEBHOOK_HOSTNAMES.has(host)) throw new Error('webhookUrl must not target localhost')
  if (host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.localhost'))
    throw new Error('webhookUrl must not target internal hostnames')
  if (isPrivateIp(host)) throw new Error('webhookUrl must not target private IP ranges')
  return v
}

// ── TTS request ───────────────────────────────────────────────────────────────

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

// ── Vault semantic search ──────────────────────────────────────────────────────

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
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) throw new Error('tools must be an array')
    out.tools = (body.tools as unknown[]).slice(0, 20).map((t, i) => parseTool(t, i))
  }
  return out
}

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

export function parseVaultSearchRequest(body: unknown): { q: string; limit: number; tool: string | null } {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const q = str(body.q, 'q')
  if (!q.trim()) throw new Error('q must not be empty')
  return {
    q,
    limit: body.limit !== undefined ? num(body.limit, 'limit', 20, 1, AI_SEARCH_MAX_RESULTS) : 20,
    tool:  body.tool  !== undefined ? str(body.tool, 'tool') : null,
  }
}
