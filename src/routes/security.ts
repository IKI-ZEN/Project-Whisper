import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { MAX_CSP_REPORT_BYTES } from '../lib/constants'
import { logSandboxEvent } from '../lib/events'

// POST /api/csp-report — receives browser CSP violation reports and writes them to D1.
// Browsers send Content-Type: application/csp-report with a JSON body.
const cspReport: Handler = async (req, env) => {
  try {
    const cl = parseInt(req.headers.get('Content-Length') ?? '0', 10)
    if (cl > MAX_CSP_REPORT_BYTES) return new Response(null, { status: 204 })
    const body = await req.text()
    await logSandboxEvent(env, { sandboxId: 'system', type: 'csp_violation', metadata: body.slice(0, 4096) })
  } catch { /* non-fatal — never let logging break the response */ }
  return new Response(null, { status: 204 })
}

export const securityRoutes: Array<[string, string, Handler]> = [
  ['POST', '/api/csp-report', cspReport],
]
