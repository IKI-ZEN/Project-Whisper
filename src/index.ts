import type { Env, AetherJob } from './types/env'
import { Router, json, ok } from './lib/http'
import { aiRoutes }              from './routes/ai'
import { sandboxRoutes, runHandler, streamHandler } from './routes/sandbox'
import { vibeRoutes }            from './routes/vibes'
import { pageRoutes }            from './routes/pages'
import { documentRoutes }        from './routes/documents'
import { whispererRoutes }       from './routes/whisperer'
import { processFile, processEmbeddingBatch } from './jobs/fileProcess'

// Required: Wrangler binds the DO class via the export from this entry file.
export { SandboxDO } from './durable/SandboxDO'

// ── Router setup ──────────────────────────────────────────────────────────────

const router = new Router()

// Health / discovery (JSON)
router.get('/api', (_req, _env) => Promise.resolve(json(ok({
  name:    'Project Aether-Lite',
  version: '0.2.0',
  status:  'operational',
  api: {
    ai:       { complete: 'POST /api/ai/complete', stream: 'POST /api/ai/stream', embed: 'POST /api/ai/embed', image: 'POST /api/ai/image', transcribe: 'POST /api/ai/transcribe' },
    sandbox:  { list: 'GET /api/sandbox', create: 'POST /api/sandbox', import: 'POST /api/sandbox/import', run: 'POST /api/sandbox/:id/run', stream: 'POST /api/sandbox/:id/stream', export: 'GET /api/sandbox/:id/export' },
    vibes:    { list: 'GET /api/vibes', generate: 'POST /api/vibes' },
    platform: { landing: '/', apps: '/apps', app: '/app/:id', shortApi: '/s/:id/run' },
  },
}))))

// Short public API — stable clean URLs for integrations and embeds
router.get('/s/:id', (_req, _env, params) =>
  Promise.resolve(new Response(null, { status: 302, headers: { Location: `/app/${params.id ?? ''}` } }))
)
router.post('/s/:id/run',    runHandler)
router.post('/s/:id/stream', streamHandler)

// Mount route groups
for (const [method, path, handler] of [...aiRoutes, ...sandboxRoutes, ...vibeRoutes, ...pageRoutes, ...documentRoutes, ...whispererRoutes]) {
  router.on(method, path, handler)
}

// ── Worker export ─────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // WebSocket upgrades must bypass the HTTP router — pass directly to the DO
    if (req.headers.get('Upgrade') === 'websocket') {
      const match = new URL(req.url).pathname.match(/^\/api\/sandbox\/([^/]+)\/ws$/)
      if (match) return env.SANDBOX.get(env.SANDBOX.idFromName(match[1])).fetch(req)
    }
    return router.handle(req, env)
  },

  async queue(batch: MessageBatch<AetherJob>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        if (msg.body.type === 'file_process')    await processFile(msg.body, env)
        if (msg.body.type === 'embedding_batch') await processEmbeddingBatch(msg.body, env)
        msg.ack()
      } catch (e) {
        console.error('[queue] job failed:', msg.body.type, e)
        msg.retry()
      }
    }
  },
}
