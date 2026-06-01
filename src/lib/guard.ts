export type RiskLevel = 'clean' | 'suspicious' | 'blocked'

export interface ScanResult {
  riskLevel: RiskLevel
  patterns: string[]
}

export interface ScanLayer {
  name: 'raw' | 'stripped' | 'normalised' | 'base64_1' | 'base64_2' | 'base64_3'
  preview: string   // first 500 chars of the text at this processing stage
  matched: string[] // all pattern names that fired at this layer
}

export interface VerboseScanResult extends ScanResult {
  layers: ScanLayer[]
}

// ── Pattern tables ─────────────────────────────────────────────────────────────

const BLOCKED_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'ignore_instructions', re: /ignore\s+(all\s+)?(previous|above|prior|your)\s+(instructions?|prompts?|rules?|constraints?)/i },
  { name: 'new_instructions',    re: /(your\s+)?(new\s+)?(instructions?|rules?|directive)\s+(?:are|is)\s*:/i },
  { name: 'jailbreak_dan',       re: /\bdo\s+anything\s+now\b/i },
  { name: 'prompt_override',     re: /\[\s*(?:OVERRIDE|JAILBREAK|IGNORE\s+ABOVE)\s*\]/i },
  { name: 'forget_training',     re: /forget\s+(?:everything|all\s+(?:previous\s+)?instructions|your\s+(?:training|programming|instructions))/i },
]

const SUSPICIOUS_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'role_switch',     re: /you\s+are\s+now\s+(?:a\s+|an\s+)?/i },
  { name: 'act_as',          re: /act\s+as\s+(?:if\s+you(?:'re|are)\s+)?(?:a\s+|an\s+)?/i },
  { name: 'reveal_prompt',   re: /(?:repeat|print|output|show|echo)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions?)/i },
  { name: 'role_delimiter',  re: /\[(?:INST|SYSTEM|USER|ASSISTANT|SYS)\]/ },
  { name: 'llm_tag',         re: /<\|(?:system|user|assistant|im_start|im_end)\|>/ },
  { name: 'jinja_template',  re: /\{\{.*?\}\}|\{%.*?%\}/ },
  { name: 'prompt_leak',     re: /what\s+(?:are|were)\s+(?:your\s+)?(?:initial\s+)?(?:instructions?|system\s+prompt|directives?)/i },
]

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'openai_key',    re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'aws_key',       re: /AKIA[A-Z0-9]{16}/ },
  { name: 'github_token',  re: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'anthropic_key', re: /sk-ant-[A-Za-z0-9-]{20,}/ },
]

// Covers standard base64 (+/) and URL-safe base64 (-_); chunks ≥40 chars
const BASE64_RE = /[A-Za-z0-9+/\-_]{40,}={0,2}/g

// Zero-width, directional override, and invisible Unicode code points that can
// split words across normalization boundaries to evade regex patterns.
const INVISIBLE_RE = /[​-‏‪-‮⁠-⁤﻿]/g

// Human-readable descriptions for use by the Guard Laboratory UI
export const PATTERN_DESCRIPTIONS: Record<string, string> = {
  ignore_instructions: 'Attempts to override prior system instructions',
  new_instructions:    'Tries to inject replacement instructions mid-conversation',
  jailbreak_dan:       '"Do Anything Now" jailbreak pattern',
  prompt_override:     'Square-bracket override/jailbreak directive',
  forget_training:     'Asks the model to ignore its training or programming',
  role_switch:         'Persona injection — "you are now" role takeover',
  act_as:              'Role-play injection — asks model to act as another entity',
  reveal_prompt:       'Tries to extract or echo the system prompt',
  role_delimiter:      'LLM chat-format role delimiter (e.g. [INST], [SYSTEM])',
  llm_tag:             'Model control token (e.g. <|system|>, <|im_start|>)',
  jinja_template:      'Template expression — could evaluate injected code',
  prompt_leak:         'Asks what the original instructions or system prompt were',
  openai_key:          'Possible OpenAI API key detected',
  aws_key:             'Possible AWS access key detected',
  github_token:        'Possible GitHub personal access token detected',
  anthropic_key:       'Possible Anthropic API key detected',
}

// ── Scanner ────────────────────────────────────────────────────────────────────

/**
 * Mask any leaked API secrets (OpenAI/AWS/GitHub/Anthropic key shapes) in text,
 * replacing each match with "[REDACTED:secret]". Used by the sandbox output guard
 * in 'redact' mode to scrub secrets a model may have been coaxed into emitting.
 * Returns the masked text and the number of secrets masked.
 */
export function maskSecrets(text: string): { masked: string; count: number } {
  let count = 0
  let masked = text
  for (const { re } of SECRET_PATTERNS) {
    masked = masked.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), () => {
      count++
      return '[REDACTED:secret]'
    })
  }
  return { masked, count }
}

function stripInvisible(text: string): string {
  return text.replace(INVISIBLE_RE, '')
}

function matchPatterns(text: string, table: Array<{ name: string; re: RegExp }>): string[] {
  return table.filter(p => p.re.test(text)).map(p => p.name)
}

function decodeBase64Layer(text: string): string {
  let result = ''
  for (const chunk of text.match(BASE64_RE) ?? []) {
    try {
      result += atob(chunk.replace(/-/g, '+').replace(/_/g, '/'))
    } catch { /* not valid base64 */ }
  }
  return result
}

const PREVIEW_LEN = 500

/**
 * Verbose scan: runs the full guard pipeline and records findings at each
 * processing stage. Use this when you need to explain *why* text was flagged.
 * The final riskLevel and patterns are identical to what scan() would return.
 */
export function scanVerbose(text: string): VerboseScanResult {
  const layers: ScanLayer[] = []

  // Layer 1: raw text — no processing applied
  const rawMatched = [
    ...matchPatterns(text, BLOCKED_PATTERNS),
    ...matchPatterns(text, SUSPICIOUS_PATTERNS),
    ...matchPatterns(text, SECRET_PATTERNS),
  ]
  layers.push({ name: 'raw', preview: text.slice(0, PREVIEW_LEN), matched: rawMatched })

  // Layer 2: invisible chars stripped
  const stripped = stripInvisible(text)
  const strippedMatched = [
    ...matchPatterns(stripped, BLOCKED_PATTERNS),
    ...matchPatterns(stripped, SUSPICIOUS_PATTERNS),
    ...matchPatterns(stripped, SECRET_PATTERNS),
  ]
  layers.push({ name: 'stripped', preview: stripped.slice(0, PREVIEW_LEN), matched: strippedMatched })

  // Layer 3: NFKC normalised — the primary detection surface
  const normalised = stripped.normalize('NFKC')
  const normBlocked    = matchPatterns(normalised, BLOCKED_PATTERNS)
  const normSuspicious = [
    ...matchPatterns(normalised, SUSPICIOUS_PATTERNS),
    ...matchPatterns(normalised, SECRET_PATTERNS),
  ]
  layers.push({ name: 'normalised', preview: normalised.slice(0, PREVIEW_LEN), matched: [...normBlocked, ...normSuspicious] })

  // Layers 4–6: recursive base64 decode (up to 3 levels)
  const base64Matched: string[] = []
  let layer = normalised
  const b64Names = ['base64_1', 'base64_2', 'base64_3'] as const
  for (let depth = 0; depth < 3; depth++) {
    const decoded = decodeBase64Layer(layer)
    if (!decoded || decoded === layer) break
    layer = decoded
    const norm         = layer.normalize('NFKC')
    const decodedBlocked    = matchPatterns(norm, BLOCKED_PATTERNS)
    const decodedSuspicious = [
      ...matchPatterns(norm, SUSPICIOUS_PATTERNS),
      ...matchPatterns(norm, SECRET_PATTERNS),
    ]
    const taggedBlocked = decodedBlocked.map(p =>
      depth === 0 ? `base64:${p}` : `base64x${depth + 1}:${p}`,
    )
    for (const t of taggedBlocked) {
      if (!base64Matched.includes(t)) base64Matched.push(t)
    }
    layers.push({
      name: b64Names[depth],
      preview: norm.slice(0, PREVIEW_LEN),
      matched: [...taggedBlocked, ...decodedSuspicious],
    })
    if (decodedBlocked.length) break
  }

  // Final result — same precedence logic as scan()
  const blocked = [...normBlocked, ...base64Matched]
  if (blocked.length > 0) {
    return { riskLevel: 'blocked', patterns: blocked, layers }
  }
  if (normSuspicious.length > 0) {
    return { riskLevel: 'suspicious', patterns: normSuspicious, layers }
  }
  return { riskLevel: 'clean', patterns: [], layers }
}

/**
 * Scan arbitrary text for adversarial prompt injection, jailbreak attempts,
 * and leaked API secrets. Safe to call with any string — user messages,
 * system prompts, transcriptions, or extracted file content.
 *
 * Invisible Unicode characters are stripped, then NFKC normalisation is
 * applied to catch homoglyph substitutions before pattern matching.
 */
export function scan(text: string): ScanResult {
  const { riskLevel, patterns } = scanVerbose(text)
  return { riskLevel, patterns }
}
