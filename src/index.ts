import type { Env, AetherJob } from './types/env'
import { Router, json, ok } from './lib/http'
import { aiRoutes }      from './routes/ai'
import { sandboxRoutes } from './routes/sandbox'
import { vibeRoutes }    from './routes/vibes'

// Required: Wrangler binds the DO class via the export from this entry file.
export { SandboxDO } from './durable/SandboxDO'

// ── Router setup ──────────────────────────────────────────────────────────────

const router = new Router()

// Health / discovery
router.get('/', (_req, _env) => Promise.resolve(json(ok({
  name:    'Project Aether-Lite',
  version: '0.1.0',
  status:  'operational',
  api: {
    ai:       { complete: 'POST /api/ai/complete', stream: 'POST /api/ai/stream', embed: 'POST /api/ai/embed', image: 'POST /api/ai/image', transcribe: 'POST /api/ai/transcribe' },
    sandbox:  { create: 'POST /api/sandbox', run: 'POST /api/sandbox/:id/run', stream: 'POST /api/sandbox/:id/stream' },
    vibes:    { list: 'GET /api/vibes', generate: 'POST /api/vibes' },
    playground: '/playground.html',
  },
}))))

// Mount route groups
for (const [method, path, handler] of [...aiRoutes, ...sandboxRoutes, ...vibeRoutes]) {
  router.on(method, path, handler)
}

// ── Worker export ─────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return router.handle(req, env)
  },

  async queue(batch: MessageBatch<AetherJob>, _env: Env): Promise<void> {
    for (const msg of batch.messages) {
      // Async job processing hook — extend per job type as needed
      console.log('[queue]', msg.body.type, msg.body.sandboxId)
      msg.ack()
    }
  },
}
