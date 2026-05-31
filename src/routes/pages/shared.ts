import type { Env } from '../../types/env'
import { issueAppToken } from '../../lib/appToken'

// Injects the app token as a meta tag before </head> (fallback: before </body>)
export async function injectAppToken(html: string, appId: string, env: Env): Promise<string> {
  if (!env.SIGNING_SECRET) return html
  const token = await issueAppToken(appId, env.SIGNING_SECRET)
  const tag = `<meta name="whisper-token" content="${token}">`
  if (html.includes('</head>')) return html.replace('</head>', `${tag}</head>`)
  if (html.includes('</body>')) return html.replace('</body>', `${tag}</body>`)
  return html
}

export function genNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
}

export function htmlHeaders(nonce: string, allowFrame = false): Record<string, string> {
  return {
    'Content-Type':            'text/html; charset=utf-8',
    'X-Content-Type-Options':  'nosniff',
    'Referrer-Policy':         'strict-origin',
    // app pages are designed to be embedded; all others deny framing
    ...(allowFrame ? {} : { 'X-Frame-Options': 'SAMEORIGIN' }),
    'Content-Security-Policy': `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors ${allowFrame ? "'self' *" : "'self'"}`,
    'Content-Security-Policy-Report-Only': `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors ${allowFrame ? "'self' *" : "'self'"}; report-uri /api/csp-report`,
  }
}
