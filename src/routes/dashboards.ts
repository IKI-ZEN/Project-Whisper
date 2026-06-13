import type { Handler } from '../lib/http'
import { json, ok, err, parseBody, rateLimitByIp, readIdentity } from '../lib/http'
import { generateVibeConfig } from '../lib/ai'
import { parseDashboardRequest, type SandboxConfig } from '../lib/schema'
import { newId, now } from '../lib/utils'
import { registerSandbox, stub, doFetch, identityHeader } from '../lib/do'
import { VIBE_CREATE_RATE_LIMIT_MAX, VIBE_CREATE_RATE_LIMIT_WINDOW_MS } from '../lib/constants'
import { logSandboxEvent } from '../lib/events'

// ── Dashboard builder ─────────────────────────────────────────────────────────
// Creates vibe-generated single-file dashboard apps that can pull live platform
// data via /api/app/:id/platform/* endpoints.
// Listing: GET /api/sandbox?only=dashboards

const createDashboard: Handler = async (req, env) => {
  const rl = await rateLimitByIp(req, env, 'rl:vibe-create', VIBE_CREATE_RATE_LIMIT_MAX, VIBE_CREATE_RATE_LIMIT_WINDOW_MS)
  if (rl) return rl
  const p = await parseBody(req, parseDashboardRequest)
  if (!p.ok) return p.response
  const { description, name } = p.data

  let vibeConfig
  try {
    vibeConfig = await generateVibeConfig(env.AI, env, description, name, 'dashboard')
  } catch (e) {
    return json(err('Dashboard generation failed — try a more detailed description', String(e)), 500)
  }

  if (!vibeConfig.name) {
    return json(err('Generated config was invalid — try a more detailed description'), 422)
  }

  const id       = newId()
  const ts       = now()
  const identity = readIdentity(req)
  const config: SandboxConfig = { ...vibeConfig, id, memory: [], createdAt: ts, updatedAt: ts }

  await doFetch(stub(env, id), 'init', 'POST', config, identityHeader(req))

  await registerSandbox(env, {
    id,
    name:          config.name,
    description:   config.description.slice(0, 200),
    model:         config.model,
    createdAt:     ts,
    fromVibe:      true,
    fromDashboard: true,
  })

  await logSandboxEvent(env, {
    sandboxId: id,
    type:      'dashboard_created',
    metadata:  { description: description.slice(0, 256) },
    identity,
    at:        ts,
  })

  return json(ok({
    dashboardId: id,
    name:        config.name,
    description: config.description,
    appUrl:      `/app/${id}`,
  }), 201)
}

export const dashboardsRoutes: Array<[string, string, Handler]> = [
  ['POST', '/api/dashboards', createDashboard],
]
