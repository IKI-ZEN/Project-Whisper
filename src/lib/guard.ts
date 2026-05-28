export type RiskLevel = 'clean' | 'suspicious' | 'blocked'

export interface ScanResult {
  riskLevel: RiskLevel
  patterns: string[]
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

// ── Scanner ────────────────────────────────────────────────────────────────────

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

/**
 * Scan arbitrary text for adversarial prompt injection, jailbreak attempts,
 * and leaked API secrets. Safe to call with any string — user messages,
 * system prompts, transcriptions, or extracted file content.
 *
 * Invisible Unicode characters are stripped, then NFKC normalisation is
 * applied to catch homoglyph substitutions before pattern matching.
 */
export function scan(text: string): ScanResult {
  const normalised = stripInvisible(text).normalize('NFKC')
  const matched: string[] = []

  // Check blocked patterns on normalised text
  const blocked = matchPatterns(normalised, BLOCKED_PATTERNS)
  matched.push(...blocked)

  // Recursive base64 decode — up to 3 layers to catch double/triple-encoded payloads
  let layer = normalised
  for (let depth = 0; depth < 3; depth++) {
    const decoded = decodeBase64Layer(layer)
    if (!decoded || decoded === layer) break
    layer = decoded
    const norm = layer.normalize('NFKC')
    const decodedBlocked = matchPatterns(norm, BLOCKED_PATTERNS)
    for (const p of decodedBlocked) {
      const tag = depth === 0 ? `base64:${p}` : `base64x${depth + 1}:${p}`
      if (!matched.includes(tag)) matched.push(tag)
    }
    if (decodedBlocked.length) break  // stop digging once we found something
  }

  if (matched.length > 0) {
    return { riskLevel: 'blocked', patterns: matched }
  }

  // Check suspicious + secret patterns
  const suspicious = [
    ...matchPatterns(normalised, SUSPICIOUS_PATTERNS),
    ...matchPatterns(normalised, SECRET_PATTERNS),
  ]

  if (suspicious.length > 0) {
    return { riskLevel: 'suspicious', patterns: suspicious }
  }

  return { riskLevel: 'clean', patterns: [] }
}
