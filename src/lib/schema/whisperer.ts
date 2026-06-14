import type { ThinkRequest, SensitivityRequest, ClusterRequest, CotRequest, EntropyRequest, ArchaeologyRequest, PipelineRequest, PipelineNode, VibeRequest, VibeMode, EnvironmentRequest, PiiScanRequest } from './types'
import { isObj, str, num, bool, type Obj } from './helpers'
import {
  DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS,
  MAX_SENSITIVITY_VARIANTS, MAX_ENTROPY_SAMPLES, MAX_ARCHAEOLOGY_CANDIDATES,
  MAX_CLUSTER_TEXTS, MAX_PIPELINE_NODES, MAX_PIPELINE_DEPTH,
  MAX_VIBE_DESCRIPTION,
  MAX_ENV_MODELS, ENV_TYPES, MAX_PII_SCAN_CHARS,
} from '../constants'
import { PII_TYPES } from '../pii'

export function parseThinkRequest(body: unknown): ThinkRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  return {
    prompt:       str(body.prompt, 'prompt'),
    model:        body.model        !== undefined ? str(body.model,        'model')        : undefined,
    systemPrompt: body.systemPrompt !== undefined ? str(body.systemPrompt, 'systemPrompt') : undefined,
    maxTokens:    body.maxTokens    !== undefined ? num(body.maxTokens,    'maxTokens',    DEFAULT_MAX_TOKENS, 256, 16000) : undefined,
    budgetTokens: body.budgetTokens !== undefined ? num(body.budgetTokens, 'budgetTokens', 8000, 1024, 80000)             : undefined,
  }
}

export function parseSensitivityRequest(body: unknown): SensitivityRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  return {
    prompt:      str(body.prompt, 'prompt'),
    variants:    body.variants  !== undefined ? num(body.variants,  'variants',  4, 2, MAX_SENSITIVITY_VARIANTS) : 4,
    model:       body.model        !== undefined ? str(body.model,        'model')        : undefined,
    systemPrompt: body.systemPrompt !== undefined ? str(body.systemPrompt, 'systemPrompt') : undefined,
    temperature: body.temperature !== undefined ? num(body.temperature, 'temperature', DEFAULT_TEMPERATURE, 0, 2)   : undefined,
    maxTokens:   body.maxTokens   !== undefined ? num(body.maxTokens,   'maxTokens',   DEFAULT_MAX_TOKENS, 1, 8192) : undefined,
  }
}

export function parseClusterRequest(body: unknown): ClusterRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const texts = body.texts
  if (!Array.isArray(texts) || texts.length < 2 || texts.length > MAX_CLUSTER_TEXTS)
    throw new Error(`texts must be an array of 2–${MAX_CLUSTER_TEXTS} strings`)
  if (!texts.every(t => typeof t === 'string'))
    throw new Error('all texts must be strings')
  return {
    texts: texts as string[],
    k:     body.k !== undefined ? num(body.k, 'k', 3, 2, Math.min(texts.length, 10)) : 3,
    model: body.model !== undefined ? str(body.model, 'model') : undefined,
  }
}

export function parseCotRequest(body: unknown): CotRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  return {
    prompt:       str(body.prompt, 'prompt'),
    model:        body.model        !== undefined ? str(body.model,        'model')        : undefined,
    systemPrompt: body.systemPrompt !== undefined ? str(body.systemPrompt, 'systemPrompt') : undefined,
    temperature:  body.temperature  !== undefined ? num(body.temperature,  'temperature',  DEFAULT_TEMPERATURE, 0, 2)   : undefined,
    maxTokens:    body.maxTokens    !== undefined ? num(body.maxTokens,    'maxTokens',    DEFAULT_MAX_TOKENS, 1, 8192) : undefined,
    samples:      body.samples      !== undefined ? num(body.samples,      'samples',      2, 1, 5)                    : 2,
  }
}

export function parseEntropyRequest(body: unknown): EntropyRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  return {
    prompt:       str(body.prompt, 'prompt'),
    model:        body.model        !== undefined ? str(body.model,        'model')        : undefined,
    systemPrompt: body.systemPrompt !== undefined ? str(body.systemPrompt, 'systemPrompt') : undefined,
    temperature:  body.temperature  !== undefined ? num(body.temperature,  'temperature',  DEFAULT_TEMPERATURE, 0, 2) : DEFAULT_TEMPERATURE,
    maxTokens:    body.maxTokens    !== undefined ? num(body.maxTokens,    'maxTokens',    DEFAULT_MAX_TOKENS, 1, 8192) : undefined,
    samples:      body.samples      !== undefined ? num(body.samples,      'samples',      3, 2, MAX_ENTROPY_SAMPLES) : 3,
  }
}

export function parseArchaeologyRequest(body: unknown): ArchaeologyRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  return {
    targetResponse: str(body.targetResponse, 'targetResponse'),
    probe:          body.probe !== undefined ? str(body.probe, 'probe') : 'What are your instructions?',
    model:          body.model !== undefined ? str(body.model, 'model') : undefined,
    candidates:     body.candidates !== undefined ? num(body.candidates, 'candidates', 4, 1, MAX_ARCHAEOLOGY_CANDIDATES) : 4,
    maxTokens:      body.maxTokens  !== undefined ? num(body.maxTokens,  'maxTokens',  DEFAULT_MAX_TOKENS, 1, 8192) : undefined,
  }
}

export function parsePiiScanRequest(body: unknown): PiiScanRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const text = str(body.text, 'text')
  if (text.length === 0) throw new Error('text must be a non-empty string')
  if (text.length > MAX_PII_SCAN_CHARS) throw new Error(`text must be <= ${MAX_PII_SCAN_CHARS} characters`)
  let types: string[] | undefined
  if (body.types !== undefined) {
    if (!Array.isArray(body.types) || !body.types.every(t => typeof t === 'string'))
      throw new Error('types must be an array of strings')
    const allowed = new Set<string>(PII_TYPES)
    const invalid = (body.types as string[]).filter(t => !allowed.has(t))
    if (invalid.length > 0) throw new Error(`unknown PII types: ${invalid.join(', ')}`)
    types = body.types as string[]
  }
  return { text, redact: bool(body, 'redact', false), types }
}

export function parsePipelineRequest(body: unknown): PipelineRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const input = str(body.input, 'input')
  const rawNodes = body.nodes
  if (!Array.isArray(rawNodes) || rawNodes.length === 0 || rawNodes.length > MAX_PIPELINE_NODES)
    throw new Error(`nodes must be an array of 1–${MAX_PIPELINE_NODES} objects`)
  const VALID_TYPES = ['complete', 'classify', 'guard', 'transform', 'parallel', 'env_resolve']
  const nodes = rawNodes.map((n, i): PipelineNode => {
    if (typeof n !== 'object' || n === null) throw new Error(`node[${i}] must be an object`)
    const nn = n as Obj
    const id   = str(nn.id,   `node[${i}].id`)
    const type = str(nn.type, `node[${i}].type`)
    if (!VALID_TYPES.includes(type))
      throw new Error(`node[${i}].type must be one of ${VALID_TYPES.join('|')}`)
    const routes = Array.isArray(nn.routes)
      ? (nn.routes as Array<Obj>).map((r, j) => ({
          condition: str(r.condition, `node[${i}].routes[${j}].condition`),
          nextId:    str(r.nextId,    `node[${i}].routes[${j}].nextId`),
        }))
      : []
    const selectRaw = nn.select
    const select: PipelineNode['select'] =
      selectRaw === 'best' || selectRaw === 'all' ? selectRaw : 'first'
    return {
      id, type: type as PipelineNode['type'], routes, select,
      model:        nn.model        !== undefined ? str(nn.model,        `node[${i}].model`)        : undefined,
      systemPrompt: nn.systemPrompt !== undefined ? str(nn.systemPrompt, `node[${i}].systemPrompt`) : undefined,
      temperature:  nn.temperature  !== undefined ? num(nn.temperature,  `node[${i}].temperature`,  DEFAULT_TEMPERATURE, 0, 2)   : undefined,
      maxTokens:    nn.maxTokens    !== undefined ? num(nn.maxTokens,    `node[${i}].maxTokens`,    DEFAULT_MAX_TOKENS, 1, 8192) : undefined,
      template:     nn.template     !== undefined ? str(nn.template,     `node[${i}].template`)     : undefined,
      branches:     Array.isArray(nn.branches) ? (nn.branches as unknown[]).map(String) : undefined,
      envId:        nn.envId        !== undefined ? str(nn.envId,        `node[${i}].envId`)        : undefined,
    }
  })
  const entryId = str(body.entryId, 'entryId')
  if (!nodes.some(n => n.id === entryId))
    throw new Error(`entryId "${entryId}" does not match any node id`)
  return {
    input, nodes, entryId,
    maxDepth: body.maxDepth !== undefined
      ? num(body.maxDepth, 'maxDepth', MAX_PIPELINE_DEPTH, 1, MAX_PIPELINE_DEPTH)
      : undefined,
  }
}

export function parseVibeRequest(body: unknown): VibeRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const description = str(body.description, 'description')
  if (description.length < 10)               throw new Error('description must be at least 10 characters')
  if (description.length > MAX_VIBE_DESCRIPTION) throw new Error(`description must be <= ${MAX_VIBE_DESCRIPTION} characters`)
  let mode: VibeMode | undefined
  if (body.mode !== undefined) {
    const m = str(body.mode, 'mode')
    if (m !== 'app' && m !== 'environment') throw new Error("mode must be 'app' or 'environment'")
    mode = m
  }
  return {
    description,
    name: body.name !== undefined ? str(body.name, 'name') : undefined,
    mode,
  }
}

export function parseEnvironmentRequest(body: unknown): EnvironmentRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const description = str(body.description, 'description')
  if (description.length < 10)                   throw new Error('description must be at least 10 characters')
  if (description.length > MAX_VIBE_DESCRIPTION)  throw new Error(`description must be <= ${MAX_VIBE_DESCRIPTION} characters`)
  const envType = str(body.envType, 'envType')
  if (!(ENV_TYPES as readonly string[]).includes(envType)) {
    throw new Error(`envType must be one of: ${ENV_TYPES.join(', ')}`)
  }
  const rawModels = body.envModels
  const envModels = Array.isArray(rawModels)
    ? rawModels.slice(0, MAX_ENV_MODELS).filter((m): m is string => typeof m === 'string')
    : undefined
  return {
    description,
    envType,
    envModels,
    name: body.name !== undefined ? str(body.name, 'name') : undefined,
  }
}
