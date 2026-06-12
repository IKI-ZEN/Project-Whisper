// ── Vibe builder meta-prompt ──────────────────────────────────────────────────

import type { Env } from '../../types/env'
import type { Tool } from '../schema'
import { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS } from '../constants'
import { MODELS } from './models'
import { complete } from './complete'

export interface VibeConfig {
  name: string
  description: string
  systemPrompt: string
  tools: Tool[]
  model: string
  temperature: number
  maxTokens: number
  appHtml?: string   // custom HTML page served at /app/:id; uses __SANDBOX_ID__ as placeholder
}

/**
 * Split a prompt into discrete clauses suitable for ablation analysis.
 * Handles numbered lists (1. / 1)), bullet lists (- / * / •), and plain paragraphs.
 */
export function parsePromptClauses(prompt: string): string[] {
  const lines = prompt.split(/\r?\n/)
  const clauses: string[] = []
  let current = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (current.trim()) { clauses.push(current.trim()); current = '' }
      continue
    }
    const isBullet = /^(\d+[.)]\s+|[-*•]\s+)/.test(trimmed)
    if (isBullet) {
      if (current.trim()) { clauses.push(current.trim()); current = '' }
      current = trimmed
    } else {
      current += (current ? ' ' : '') + trimmed
    }
  }
  if (current.trim()) clauses.push(current.trim())
  return clauses.filter(c => c.length > 0)
}

export async function generateVibeConfig(ai: Ai, env: Env, description: string, name?: string): Promise<VibeConfig> {
  const hasGateway = Boolean(env.AI_GATEWAY_ID && env.CLOUDFLARE_ACCOUNT_ID)

  const modelOptions = hasGateway
    ? `Workers AI (fast, no key needed):
  - "@cf/meta/llama-3.1-8b-instruct" — fast, efficient
  - "@cf/meta/llama-3.3-70b-instruct-fp8-fast" — large, complex tasks
Flagship via AI Gateway (requires API keys):
  - "openai:gpt-4o" — best overall quality
  - "openai:gpt-4o-mini" — fast, cost-efficient OpenAI
  - "anthropic:claude-sonnet-4-6" — excellent reasoning and writing
  - "anthropic:claude-opus-4-7" — most capable Anthropic model
  - "google:gemini-2.0-flash" — fast Google model`
    : `- "@cf/meta/llama-3.1-8b-instruct" — fast, efficient
- "@cf/meta/llama-3.3-70b-instruct-fp8-fast" — large, complex tasks`

  const metaPrompt = `You are an AI app generator. Given a description, output ONLY a valid JSON object — no markdown, no explanation, no code fences.

The JSON must have exactly these fields:
{
  "name": "<string, max 128 chars, descriptive app name>",
  "description": "<string, max 512 chars, what this app does>",
  "systemPrompt": "<string, detailed system instructions that make the AI excellent at the task>",
  "tools": [<optional array — define tools ONLY if the app description implies the AI needs to call external functions. Each tool: { "name": "snake_case_name", "description": "what this tool does", "parameters": { "param_name": { "type": "string|number|boolean", "description": "...", "required": true|false } } }>],
  "model": "<choose the most appropriate model from the options below>",
  "temperature": <number 0-2: 0.2 for factual, 0.7 for balanced, 1.2 for creative>,
  "maxTokens": <integer 256-4096>,
  "appHtml": "<complete single-file HTML app — see requirements below>"
}

Tool guidelines: define tools ONLY when the description explicitly requires calling external APIs or services. For knowledge-based or conversational apps, tools should be an empty array [].

App HTML requirements:
- Generate a COMPLETE, self-contained HTML page (DOCTYPE, head, body, styles, scripts all inline)
- Use __SANDBOX_ID__ (double underscore each side) as the sandbox ID placeholder — it will be replaced at runtime
- Load the SDK: <script type="module"> ... import { VibeClient } from '/vibe-sdk.js'; const client = new VibeClient(); ...
- For simple chat apps: use the <vibe-chat sandbox-id="__SANDBOX_ID__"> web component
- For richer apps (dashboards, tools, multi-step flows): build a full custom UI using client.sandbox.get('__SANDBOX_ID__') and client.ai.*
- Style with inline CSS — dark theme (#0c0c0f background, #d8d8e8 text, #7c3aed accent)
- All script tags must be type="module" — no inline event handlers (use addEventListener)
- The page must be fully functional with no external CDN dependencies (only /vibe-sdk.js from same origin)

Available models:
${modelOptions}

${name ? `Use the name: "${name}"` : 'Generate an appropriate name from the description.'}

User description: "${description}"`

  const raw = await complete(ai, env, {
    model: MODELS.textLarge,
    prompt: metaPrompt,
    temperature: 0.2,
    maxTokens: 2048,
  })

  const stripped = raw.replace(/```(?:json)?\n?/g, '').trim()
  const jsonMatch = stripped.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI did not return valid JSON for the vibe config')

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>

  // Parse tools defensively — invalid entries are silently dropped
  const rawTools = Array.isArray(parsed.tools) ? parsed.tools : []
  const tools: Tool[] = rawTools.flatMap((t: unknown) => {
    try {
      if (typeof t !== 'object' || t === null) return []
      const tt = t as Record<string, unknown>
      const tname = typeof tt.name === 'string' ? tt.name : ''
      if (!tname || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tname)) return []
      const rawParams = typeof tt.parameters === 'object' && tt.parameters !== null ? tt.parameters as Record<string, unknown> : {}
      const parameters: Record<string, { type: 'string' | 'number' | 'boolean' | 'array' | 'object'; description: string; required?: boolean }> = {}
      for (const [k, p] of Object.entries(rawParams)) {
        if (typeof p !== 'object' || p === null) continue
        const pp = p as Record<string, unknown>
        const ptype = typeof pp.type === 'string' ? pp.type : 'string'
        parameters[k] = { type: ptype as 'string', description: typeof pp.description === 'string' ? pp.description : k, required: pp.required === true }
      }
      return [{ name: tname, description: typeof tt.description === 'string' ? tt.description : tname, parameters }]
    } catch { return [] }
  })

  const rawAppHtml = typeof parsed.appHtml === 'string' ? parsed.appHtml.trim() : ''

  return {
    name:         typeof parsed.name === 'string'         ? parsed.name         : name ?? 'Untitled App',
    description:  typeof parsed.description === 'string'  ? parsed.description  : description.slice(0, 256),
    systemPrompt: typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : 'You are a helpful assistant.',
    tools,
    model:        typeof parsed.model === 'string'        ? parsed.model        : MODELS.text,
    temperature:  typeof parsed.temperature === 'number'  ? parsed.temperature  : DEFAULT_TEMPERATURE,
    maxTokens:    typeof parsed.maxTokens === 'number'    ? parsed.maxTokens    : DEFAULT_MAX_TOKENS,
    appHtml:      rawAppHtml.length > 0 && rawAppHtml.length <= 51_200 ? rawAppHtml : undefined,
  }
}

// ── Environment config generator ──────────────────────────────────────────────

export interface EnvConfig {
  name: string
  description: string
  systemPrompt: string
  model: string
  temperature: number
  maxTokens: number
  envModels: string[]
}

// ── Built-in environment templates ────────────────────────────────────────────
// These bypass generateEnvConfig — zero latency, zero AI cost.
// Template IDs are stable; the UI uses them to pre-fill the builder form.

interface EnvTemplate {
  id:           string
  label:        string
  description:  string
  envType:      string
  systemPrompt: string
  temperature:  number
  maxTokens:    number
  models:       string[]   // suggested models; empty = AI-generated defaults
}

const BUILT_IN_TEMPLATES: EnvTemplate[] = [
  {
    id:           'python-code-reviewer',
    label:        'Python Code Reviewer',
    description:  'Spots bugs, suggests PEP-8 fixes, and explains issues clearly.',
    envType:      'coding',
    systemPrompt: 'You are an expert Python code reviewer. Identify bugs, security issues, and style violations (PEP-8, type hints). Explain each issue concisely and provide a corrected snippet. Use code blocks with `python` tags.',
    temperature:  0.2,
    maxTokens:    2048,
    models:       [],
  },
  {
    id:           'research-synthesiser',
    label:        'Research Synthesiser',
    description:  'Summarises sources with academic rigour and citation awareness.',
    envType:      'research',
    systemPrompt: 'You are a rigorous research assistant. Synthesise information from multiple sources, cite claims explicitly, flag uncertainty with hedge phrases, and structure responses with clear section headers. Prefer precision over brevity.',
    temperature:  0.3,
    maxTokens:    3072,
    models:       [],
  },
  {
    id:           'json-schema-builder',
    label:        'JSON Schema Builder',
    description:  'Responds only with valid JSON. Perfect for structured data extraction.',
    envType:      'structured',
    systemPrompt: 'You produce structured JSON output only. Every response must be a single, valid JSON object matching the schema the user specifies. Never include prose, markdown, or explanation outside the JSON. If the schema is ambiguous, infer the most reasonable structure.',
    temperature:  0.0,
    maxTokens:    2048,
    models:       [],
  },
  {
    id:           'brainstorm-partner',
    label:        'Brainstorm Partner',
    description:  'Free-form idea generation — bold, no hedging, builds on your ideas.',
    envType:      'creative',
    systemPrompt: 'You are a bold brainstorm partner. Generate wild, concrete, actionable ideas without hedging. Build on every idea the user shares — amplify, combine, twist. Never water down. Short punchy responses unless depth is requested.',
    temperature:  1.1,
    maxTokens:    1024,
    models:       [],
  },
  {
    id:           'security-analyst',
    label:        'Security Analyst',
    description:  'OWASP-focused threat modelling and vulnerability review.',
    envType:      'coding',
    systemPrompt: 'You are an expert application security analyst. Identify vulnerabilities using the OWASP Top 10 as a framework. For each issue, state the vulnerability class, severity (Critical/High/Medium/Low), attack vector, and a concrete remediation. Include secure code examples.',
    temperature:  0.1,
    maxTokens:    2048,
    models:       [],
  },
]

export async function generateEnvConfig(
  ai: Ai, env: Env,
  description: string,
  envType: string,
  requestedModels?: string[],
  name?: string,
): Promise<EnvConfig> {
  const hasGateway = Boolean(env.AI_GATEWAY_ID && env.CLOUDFLARE_ACCOUNT_ID)

  const modelDefaults: Record<string, string[]> = hasGateway ? {
    general:    [MODELS.text,    MODELS.gpt4oMini],
    coding:     [MODELS.claude,  MODELS.gpt4o],
    research:   [MODELS.claude,  MODELS.gemini],
    structured: [MODELS.gpt4o,   MODELS.claude],
    creative:   [MODELS.claude,  MODELS.gemini],
    agent:      [MODELS.claude,  MODELS.gpt4o],
    debate:     [MODELS.claude,  MODELS.gpt4o, MODELS.gemini],
  } : {
    general:    [MODELS.text,      MODELS.textLarge],
    coding:     [MODELS.textLarge, MODELS.text],
    research:   [MODELS.textLarge, MODELS.text],
    structured: [MODELS.textLarge, MODELS.text],
    creative:   [MODELS.textLarge, MODELS.text],
    agent:      [MODELS.textLarge, MODELS.text],
    debate:     [MODELS.textLarge, MODELS.text],
  }

  const systemPromptHints: Record<string, string> = {
    general:    'You are a helpful, knowledgeable assistant. Be concise and clear.',
    coding:     'You are an expert programmer. Review code carefully, explain bugs clearly, and provide idiomatic, well-commented solutions. Use code blocks with language tags.',
    research:   'You are a research assistant. Provide thorough, accurate answers with citations where possible. Summarise sources clearly and flag uncertainty.',
    structured: 'You produce structured JSON output only. Respond with valid JSON matching the schema the user specifies. No prose outside the JSON object.',
    creative:   'You are a creative collaborator. Think boldly, break conventions, and produce vivid, surprising, original content. Embrace voice and style. Do not hedge or water down ideas.',
    agent:      'You are a task-oriented AI agent. Break goals into concrete steps, take initiative, reason through obstacles explicitly, and always produce actionable output. State assumptions clearly.',
    debate:     'You are a rigorous analytical debater. When presented with a topic, argue the position assigned to you with evidence and logic. Engage directly with counter-arguments. Be direct and assertive.',
  }

  const metaPrompt = `You are configuring a chat environment. Given the user description and environment type, output ONLY valid JSON — no markdown, no explanation.

JSON fields:
{
  "name": "<short descriptive name, max 64 chars>",
  "description": "<one sentence describing what this environment does, max 256 chars>",
  "systemPrompt": "<detailed system instructions tuned for the environment type>",
  "temperature": <0.2 for factual/structured, 0.7 for balanced, 1.0 for creative>,
  "maxTokens": <512–4096>
}

Environment type: ${envType}
Type guidance: ${systemPromptHints[envType] ?? 'You are a helpful assistant.'}
${name ? `Use the name: "${name}"` : 'Generate an appropriate name from the description.'}

User description: "${description}"`

  const raw = await complete(ai, env, {
    model:       MODELS.textLarge,
    prompt:      metaPrompt,
    temperature: 0.2,
    maxTokens:   512,
  })

  const stripped    = raw.replace(/```(?:json)?\n?/g, '').trim()
  const jsonMatch   = stripped.match(/\{[\s\S]*\}/)
  const parsed      = jsonMatch ? JSON.parse(jsonMatch[0]) as Record<string, unknown> : {}

  const envModels = (requestedModels && requestedModels.length > 0)
    ? requestedModels
    : (modelDefaults[envType] ?? modelDefaults.general)

  return {
    name:         typeof parsed.name         === 'string' ? parsed.name.slice(0, 64)   : name ?? 'Untitled Environment',
    description:  typeof parsed.description  === 'string' ? parsed.description.slice(0, 256) : description.slice(0, 256),
    systemPrompt: typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : systemPromptHints[envType] ?? 'You are a helpful assistant.',
    model:        envModels[0],
    temperature:  typeof parsed.temperature  === 'number' ? parsed.temperature  : DEFAULT_TEMPERATURE,
    maxTokens:    typeof parsed.maxTokens    === 'number' ? Math.min(4096, Math.max(512, parsed.maxTokens)) : DEFAULT_MAX_TOKENS,
    envModels,
  }
}
