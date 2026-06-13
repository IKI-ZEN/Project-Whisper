import type { Env } from '../../../types/env'
import { AZURE_OPENAI_API_VERSION } from '../../constants'

// ── Gateway provider registry ─────────────────────────────────────────────────

export type WireFormat = 'openai' | 'anthropic' | 'google' | 'cohere' | 'huggingface' | 'replicate'

export interface ProviderCapabilities {
  tools?:        boolean
  vision?:       boolean
  streaming?:    boolean
  systemPrompt?: boolean
  jsonMode?:     boolean
}

export interface GatewayProviderDef {
  format:        WireFormat
  path:          (id: string) => string
  apiKey:        (env: Env) => string
  authHeaders?:  (key: string) => Record<string, string>
  modelId?:      (id: string) => string
  capabilities?: ProviderCapabilities
}

// Each entry maps the model prefix (before ':') to its gateway path and auth.
// All OpenAI-compatible providers share the same request/response format.
// Paths are confirmed against official Cloudflare AI Gateway provider docs.
const GATEWAY_PROVIDERS: Record<string, GatewayProviderDef> = {
  openai: {
    format: 'openai', path: _ => '/openai/chat/completions', apiKey: e => e.OPENAI_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  anthropic: {
    format: 'anthropic', path: _ => '/anthropic/v1/messages', apiKey: e => e.ANTHROPIC_API_KEY ?? '',
    authHeaders: key => ({ 'x-api-key': key }),
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true },
  },
  google: {
    format: 'google', path: id => `/google-ai-studio/v1/models/${encodeURIComponent(id)}:generateContent`,
    apiKey: e => e.GOOGLE_AI_KEY ?? '', authHeaders: key => ({ 'x-goog-api-key': key }),
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  groq: {
    format: 'openai', path: _ => '/groq/chat/completions', apiKey: e => e.GROQ_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  mistral: {
    format: 'openai', path: _ => '/mistral/v1/chat/completions', apiKey: e => e.MISTRAL_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  deepseek: {
    format: 'openai', path: _ => '/deepseek/chat/completions', apiKey: e => e.DEEPSEEK_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  xai: {
    format: 'openai', path: _ => '/grok/v1/chat/completions', apiKey: e => e.XAI_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  perplexity: {
    format: 'openai', path: _ => '/perplexity-ai/chat/completions', apiKey: e => e.PERPLEXITY_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  cerebras: {
    format: 'openai', path: _ => '/cerebras/chat/completions', apiKey: e => e.CEREBRAS_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  openrouter: {
    format: 'openai', path: _ => '/openrouter/chat/completions', apiKey: e => e.OPENROUTER_API_KEY ?? '',
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  // Bedrock via AI Gateway compat endpoint. Auth is CF_AIG_TOKEN; body model becomes "aws-bedrock/{id}".
  // Requires BYOK credentials configured in CF dashboard and CF_AIG_TOKEN set.
  bedrock: {
    format: 'openai', path: _ => '/compat/chat/completions',
    apiKey: e => e.CF_AIG_TOKEN ?? '', authHeaders: key => ({ 'cf-aig-authorization': `Bearer ${key}` }),
    modelId: id => `aws-bedrock/${id}`,
    capabilities: { tools: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  // Azure OpenAI — model string format: azure:{resource-name}/{deployment-name}
  azure: {
    format: 'openai',
    path: id => {
      const slash = id.indexOf('/')
      const resource = encodeURIComponent(slash === -1 ? id : id.slice(0, slash))
      const dep      = encodeURIComponent(slash === -1 ? id : id.slice(slash + 1))
      return `/azure-openai/${resource}/${dep}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`
    },
    apiKey: e => e.AZURE_OPENAI_API_KEY ?? '', authHeaders: key => ({ 'api-key': key }),
    modelId: id => { const s = id.indexOf('/'); return s === -1 ? id : id.slice(s + 1) },
    capabilities: { tools: true, vision: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  // Baseten — OpenAI-compatible inference for custom and open-source models
  baseten: {
    format: 'openai', path: _ => '/baseten/v1/chat/completions', apiKey: e => e.BASETEN_API_KEY ?? '',
    capabilities: { tools: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  // Cohere — native Cohere chat format; auth uses "Token {key}" not "Bearer"
  cohere: {
    format: 'cohere', path: _ => '/cohere/v1/chat', apiKey: e => e.COHERE_API_KEY ?? '',
    authHeaders: key => ({ Authorization: `Token ${key}` }),
    capabilities: { tools: true, streaming: true, systemPrompt: true },
  },
  // HuggingFace — model ID is embedded in the URL path; body uses "inputs" key
  huggingface: {
    format: 'huggingface', path: id => `/huggingface/${id}`, apiKey: e => e.HUGGINGFACE_API_KEY ?? '',
    capabilities: { streaming: false, systemPrompt: true },
  },
  // Replicate — async prediction API; polls until completion
  replicate: {
    format: 'replicate', path: _ => '/replicate/predictions', apiKey: e => e.REPLICATE_API_KEY ?? '',
    capabilities: { streaming: false },
  },
  // Parallel — chat via unified compat endpoint; model format "parallel/{model-id}"
  parallel: {
    format: 'openai', path: _ => '/compat/chat/completions',
    apiKey: e => e.PARALLEL_API_KEY ?? '', authHeaders: key => ({ 'x-api-key': key }),
    modelId: id => `parallel/${id}`,
    capabilities: { tools: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
  // Google Vertex AI via compat endpoint + BYOK; model format "google-vertex-ai/{model}"
  vertex: {
    format: 'openai', path: _ => '/compat/chat/completions',
    apiKey: e => e.CF_AIG_TOKEN ?? '', authHeaders: key => ({ 'cf-aig-authorization': `Bearer ${key}` }),
    modelId: id => `google-vertex-ai/${id}`,
    capabilities: { tools: true, streaming: true, systemPrompt: true, jsonMode: true },
  },
}

export type GatewayResult = { provider: string; id: string; def: GatewayProviderDef }

export function parseGateway(model: string): GatewayResult | null {
  const sep = model.indexOf(':')
  if (sep === -1) return null
  const p = model.slice(0, sep)
  const def = GATEWAY_PROVIDERS[p]
  if (!def) return null
  const id = model.slice(sep + 1)
  // Block '..' to prevent path traversal in URL-encoded path segments.
  // Allow '/' (Azure resource/deployment, Baseten model IDs, OpenRouter)
  // and ':' (Bedrock ARN-style version suffixes like 'v1:0').
  if (id.includes('..')) return null
  if (!/^[a-zA-Z0-9][\w.\-:/]*$/.test(id)) return null
  return { provider: p, id, def }
}

export function gatewayBase(env: Env): string {
  const { CLOUDFLARE_ACCOUNT_ID: acct, AI_GATEWAY_ID: gw } = env
  if (!acct || !gw) throw new Error(
    'AI Gateway not configured — set CLOUDFLARE_ACCOUNT_ID and AI_GATEWAY_ID',
  )
  return `https://gateway.ai.cloudflare.com/v1/${acct}/${gw}`
}
