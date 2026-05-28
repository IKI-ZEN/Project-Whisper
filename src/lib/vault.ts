// ── Base64url codec ───────────────────────────────────────────────────────────

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromB64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}

// ── AES-GCM envelope encryption for system prompts at rest ───────────────────
// Per-sandbox key derived via HKDF(SHA-256, SIGNING_SECRET, salt=sandboxId).
// Sealed format: "v1:" + base64url(12-byte IV) + "." + base64url(ciphertext).
// Plaintext passthrough: if value does not start with "v1:", openPrompt returns it unchanged.

const ENC  = new TextEncoder()
const DEC  = new TextDecoder()
const INFO = ENC.encode('aether-lite-system-prompt-v1')

async function deriveAesKey(secret: string, sandboxId: string): Promise<CryptoKey> {
  const rawKey = await crypto.subtle.importKey('raw', ENC.encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: ENC.encode(sandboxId), info: INFO },
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt'],
  )
}

export async function sealPrompt(prompt: string, secret: string, sandboxId: string): Promise<string> {
  const key = await deriveAesKey(secret, sandboxId)
  const iv  = crypto.getRandomValues(new Uint8Array(12))
  const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, ENC.encode(prompt))
  return `v1:${b64url(iv)}.${b64url(ct)}`
}

export async function openPrompt(sealed: string, secret: string, sandboxId: string): Promise<string> {
  if (!sealed.startsWith('v1:')) return sealed   // plaintext passthrough
  const rest         = sealed.slice(3)
  const dotPos       = rest.indexOf('.')
  if (dotPos < 0) return sealed                  // malformed — treat as plaintext
  const iv           = fromB64url(rest.slice(0, dotPos))
  const ct           = fromB64url(rest.slice(dotPos + 1))
  const key          = await deriveAesKey(secret, sandboxId)
  const plain        = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return DEC.decode(plain)
}

// ── HMAC-SHA256 utilities ─────────────────────────────────────────────────────
// Shared across sandbox.ts, SandboxDO.ts, and any other module needing signing.

export async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', ENC.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  )
}

export async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, ENC.encode(payload))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  const expected = await signPayload(payload, secret)
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}
