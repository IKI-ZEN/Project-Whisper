import type { Env } from '../types/env'

// ── JWKS cache ────────────────────────────────────────────────────────────────
// Cloudflare Access public keys rotate infrequently. Cache them per Worker
// isolate for 1 hour to avoid an outbound fetch on every protected request.

let keyCache: Map<string, CryptoKey> | null = null
let keyCacheExpiry = 0

function b64urlToBytes(s: string): Uint8Array {
  // Restore standard base64 padding then decode
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}

async function fetchPublicKeys(teamDomain: string): Promise<Map<string, CryptoKey>> {
  if (keyCache && Date.now() < keyCacheExpiry) return keyCache

  const url = `https://${teamDomain}/cdn-cgi/access/certs`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Cloudflare Access JWKS fetch failed: ${res.status}`)

  type JWK = { kid: string; kty: string; n: string; e: string }
  const { keys } = await res.json() as { keys: JWK[] }

  const map = new Map<string, CryptoKey>()
  for (const jwk of keys) {
    if (jwk.kty !== 'RSA') continue
    const key = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify'],
    )
    map.set(jwk.kid, key)
  }

  keyCache      = map
  keyCacheExpiry = Date.now() + 3_600_000   // 1 hour
  return map
}

// ── JWT validation ────────────────────────────────────────────────────────────

export interface AccessIdentity {
  email: string
  sub:   string
}

async function validateJWT(
  token: string,
  teamDomain: string,
  aud: string,
): Promise<AccessIdentity | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const dec     = new TextDecoder()
    const header  = JSON.parse(dec.decode(b64urlToBytes(parts[0]))) as { kid: string; alg?: string }
    type Payload  = { aud: string | string[]; exp: number; email?: string; sub?: string }
    const payload = JSON.parse(dec.decode(b64urlToBytes(parts[1]))) as Payload

    // Validate expiry
    if (payload.exp < Math.floor(Date.now() / 1000)) return null

    // Validate audience
    const audOk = Array.isArray(payload.aud) ? payload.aud.includes(aud) : payload.aud === aud
    if (!audOk) return null

    // Fetch public key by kid
    const keys = await fetchPublicKeys(teamDomain)
    const key  = keys.get(header.kid)
    if (!key) return null

    // Verify RS256 signature
    const sigInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    const sig      = b64urlToBytes(parts[2])
    const valid    = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, sigInput)
    if (!valid) return null

    return { email: payload.email ?? '', sub: payload.sub ?? '' }
  } catch {
    return null
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AccessResult {
  deny:     Response | null
  identity: AccessIdentity | null
}

/**
 * Check for a valid Cloudflare Access JWT on the request.
 * Returns `{ deny: null, identity }` when authenticated.
 * Returns `{ deny: 401Response, identity: null }` when auth fails.
 * Returns `{ deny: null, identity: null }` when Access is not configured.
 *
 * Token is read from:
 *   1. Cf-Access-Jwt-Assertion header (set automatically by the Access proxy)
 *   2. Authorization: Bearer <token> header (for programmatic clients)
 */
export async function requireAccess(req: Request, env: Env): Promise<AccessResult> {
  if (!env.CF_ACCESS_AUD || !env.CF_ACCESS_TEAM_DOMAIN) return { deny: null, identity: null }

  const token = req.headers.get('Cf-Access-Jwt-Assertion')
             ?? req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')

  const deny = (msg: string): AccessResult => ({
    deny: new Response(JSON.stringify({ ok: false, error: msg }), {
      status:  401,
      headers: {
        'Content-Type':     'application/json',
        'WWW-Authenticate': `Bearer realm="${env.CF_ACCESS_TEAM_DOMAIN}"`,
      },
    }),
    identity: null,
  })

  if (!token) return deny('Authentication required — provide a Cloudflare Access token')

  const identity = await validateJWT(token, env.CF_ACCESS_TEAM_DOMAIN, env.CF_ACCESS_AUD)
  if (!identity) return deny('Invalid or expired Cloudflare Access token')

  return { deny: null, identity }
}

/**
 * Returns true for requests that must be authenticated when Cloudflare Access
 * is configured: any state-mutation (POST/PATCH/DELETE) under /api/, excluding
 * the public sandbox run/stream endpoints and the CSP report sink.
 */
export function isProtectedRequest(method: string, pathname: string): boolean {
  if (!['POST', 'PATCH', 'DELETE', 'PUT'].includes(method)) return false
  if (pathname.startsWith('/s/'))              return false   // short public API
  if (pathname === '/api/csp-report')          return false   // reporting sink
  if (/^\/api\/sandbox\/[^/]+\/(run|stream)$/.test(pathname)) return false  // core run API
  return pathname.startsWith('/api/')
}
