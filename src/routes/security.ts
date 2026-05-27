import type { Env } from '../types/env'
import type { Handler } from '../lib/http'

// POST /api/csp-report — receives browser CSP violation reports and writes them to D1.
// Browsers send Content-Type: application/csp-report with a JSON body.
const cspReport: Handler = async (req, env) => {
  try {
    const cl = parseInt(req.headers.get('Content-Length') ?? '0', 10)
    if (cl > 65536) return new Response(null, { status: 204 })
    const body = await req.text()
    const now  = Date.now()
    await env.DB.prepare(
      'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind('system', 'csp_violation', body.slice(0, 4096), null, now).run()
  } catch { /* non-fatal — never let logging break the response */ }
  return new Response(null, { status: 204 })
}

export const securityRoutes: Array<[string, string, Handler]> = [
  ['POST', '/api/csp-report', cspReport],
]
