import { PII_REDACTION_FORMAT } from './constants'
import { maskSecrets } from './guard'

// ── PII detection & redaction ────────────────────────────────────────────────
// Pattern-based scanner for personally identifiable information. Mirrors the
// structure of guard.ts (named pattern tables) but targets data-protection
// concerns rather than prompt injection: emails, payment card numbers, US SSNs,
// phone numbers, and IPv4 addresses.
//
// This module is intentionally conservative — card numbers are Luhn-validated
// before being reported so random 16-digit strings do not trip the scanner.
// It is exposed as an opt-in tool (POST /api/ai/pii-scan) and an optional
// per-sandbox output redaction; it is never forced onto research endpoints.

export type PiiType = 'email' | 'credit_card' | 'ssn' | 'phone' | 'ipv4'

export interface PiiMatch {
  type: PiiType
  start: number
  end: number
  preview: string   // the matched substring (already PII — callers must handle with care)
}

export const PII_DESCRIPTIONS: Record<PiiType, string> = {
  email:       'Email address',
  credit_card: 'Payment card number (Luhn-valid)',
  ssn:         'US Social Security Number',
  phone:       'Phone number',
  ipv4:        'IPv4 address',
}

export const PII_TYPES: readonly PiiType[] = ['email', 'credit_card', 'ssn', 'phone', 'ipv4']

// ── Pattern table ──────────────────────────────────────────────────────────────
// Each pattern carries a global regex and an optional validator. Order matters:
// more specific types (card, ssn) are scanned before looser ones (phone) so a
// run of digits is attributed to the most meaningful type, and overlapping
// looser matches are dropped during merge.

interface PiiPattern {
  type: PiiType
  re: RegExp
  validate?: (raw: string) => boolean
}

// Luhn checksum — used to reject digit runs that are not valid card numbers.
function luhnValid(digits: string): boolean {
  const d = digits.replace(/[\s-]/g, '')
  if (d.length < 13 || d.length > 19 || !/^\d+$/.test(d)) return false
  let sum = 0
  let alt = false
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48
    if (alt) { n *= 2; if (n > 9) n -= 9 }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

const PII_PATTERNS: PiiPattern[] = [
  { type: 'email',       re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g },
  // 13–19 digit runs allowing spaces/dashes between groups; Luhn-validated.
  { type: 'credit_card', re: /\b(?:\d[ -]*?){13,19}\b/g, validate: luhnValid },
  { type: 'ssn',         re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // E.164 / North-American style phone numbers with optional country code.
  { type: 'phone',       re: /(?:\+?\d{1,3}[ .\-]?)?(?:\(\d{3}\)|\d{3})[ .\-]\d{3}[ .\-]\d{4}\b/g },
  { type: 'ipv4',        re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
]

/**
 * Scan text for PII. Returns non-overlapping matches ordered by position.
 * When two patterns match the same span, the earlier (more specific) pattern
 * in PII_PATTERNS wins.
 */
export function scanPII(text: string, types?: PiiType[]): PiiMatch[] {
  const want = types && types.length > 0 ? new Set(types) : null
  const raw: PiiMatch[] = []

  for (const pattern of PII_PATTERNS) {
    if (want && !want.has(pattern.type)) continue
    pattern.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.re.exec(text)) !== null) {
      const value = m[0]
      // Guard against zero-width matches creating an infinite loop.
      if (value.length === 0) { pattern.re.lastIndex++; continue }
      if (pattern.validate && !pattern.validate(value)) continue
      raw.push({ type: pattern.type, start: m.index, end: m.index + value.length, preview: value })
    }
  }

  // Resolve overlaps: sort by start, then by pattern specificity (table order),
  // and drop any match that overlaps one already kept.
  const order = new Map(PII_PATTERNS.map((p, i) => [p.type, i]))
  raw.sort((a, b) => a.start - b.start || (order.get(a.type)! - order.get(b.type)!))
  const kept: PiiMatch[] = []
  let lastEnd = -1
  for (const match of raw) {
    if (match.start < lastEnd) continue   // overlaps a higher-priority match
    kept.push(match)
    lastEnd = match.end
  }
  return kept
}

/**
 * Sanitize a string for storage in a security audit log: mask leaked secrets,
 * redact PII, then truncate. Used for event previews so the audit trail never
 * persists raw secrets or personal data. Research data (the vault) is not run
 * through this — researchers keep raw content.
 */
export function redactForLog(text: string, maxLen: number): string {
  const masked = maskSecrets(text).masked
  return redactPII(masked).redacted.slice(0, maxLen)
}

export interface RedactionResult {
  redacted: string
  counts: Record<string, number>
}

/**
 * Replace every PII match with a typed placeholder, e.g. "[REDACTED:email]".
 * Returns the redacted text and per-type counts. Splicing is done right-to-left
 * so earlier match offsets remain valid.
 */
export function redactPII(text: string, types?: PiiType[]): RedactionResult {
  const matches = scanPII(text, types)
  const counts: Record<string, number> = {}
  let redacted = text
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i]
    counts[match.type] = (counts[match.type] ?? 0) + 1
    redacted = redacted.slice(0, match.start) + PII_REDACTION_FORMAT(match.type) + redacted.slice(match.end)
  }
  return { redacted, counts }
}
