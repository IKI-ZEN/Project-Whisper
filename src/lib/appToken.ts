import { signPayload, verifySignature } from './vault'
import { APP_TOKEN_TTL_MS } from './constants'
import { now } from './utils'

// ── App token lifecycle ───────────────────────────────────────────────────────
// Tokens prove that the holder loaded the app page from this platform.
// Format: "{payload}.{hmac-hex}"
// Payload: "app:{appId}:{expiresAt}" (plain text — not secret, just unforgeable)

export async function issueAppToken(appId: string, secret: string): Promise<string> {
  // Defense in depth: appId is server-generated, but reject anything that could
  // confuse the path-scope check in isAppScopedPath (e.g. '/' or '..').
  if (!/^[a-zA-Z0-9_-]+$/.test(appId)) throw new Error('Invalid appId')
  const expiresAt = now() + APP_TOKEN_TTL_MS
  const payload   = `app:${appId}:${expiresAt}`
  const sig       = await signPayload(payload, secret)
  return `${payload}.${sig}`
}

export async function verifyAppToken(token: string, secret: string): Promise<string | null> {
  const dot = token.lastIndexOf('.')
  if (dot < 0) return null
  const payload = token.slice(0, dot)
  const sig     = token.slice(dot + 1)

  const parts = payload.split(':')
  if (parts.length !== 3 || parts[0] !== 'app') return null
  const appId     = parts[1]
  const expiresAt = parseInt(parts[2], 10)
  if (!appId || isNaN(expiresAt) || now() > expiresAt) return null

  const valid = await verifySignature(payload, sig, secret)
  return valid ? appId : null
}

export function extractAppToken(req: Request): string | null {
  return req.headers.get('X-App-Token')
}

// Returns true when the request path is scoped to the given appId.
// Allows: /api/app/{appId}/*, /s/{appId}/run, /s/{appId}/stream
export function isAppScopedPath(pathname: string, appId: string): boolean {
  if (pathname.startsWith(`/api/app/${appId}/`)) return true
  if (pathname === `/s/${appId}/run`)    return true
  if (pathname === `/s/${appId}/stream`) return true
  return false
}

