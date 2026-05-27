import type { Env, AetherLiteJob } from './types/env'
import { Router, json, ok } from './lib/http'
import { aiRoutes }              from './routes/ai'
import { sandboxRoutes, runHandler, streamHandler } from './routes/sandbox'
import { vibeRoutes }            from './routes/vibes'
import { pageRoutes }            from './routes/pages'
import { documentRoutes }        from './routes/documents'
import { whispererRoutes }       from './routes/whisperer'
import { buildRoutes }           from './routes/build'
import { securityRoutes }        from './routes/security'
import { appstateRoutes }        from './routes/appstate'
import { processFile, processEmbeddingBatch } from './jobs/fileProcess'
import { monitorRoutes }    from './routes/monitor'
import { vaultRoutes }      from './routes/vault'
import { replayRoutes }     from './routes/replay'
import { assertionRoutes }  from './routes/assertions'
import { atlasRoutes }      from './routes/atlas'
import { probesRoutes, runProbeById } from './routes/probes'

// Required: Wrangler binds DO classes via exports from this entry file.
export { SandboxDO }     from './durable/SandboxDO'
export { AppBuilderDO }  from './durable/AppBuilderDO'
export { AppStateDO }    from './durable/AppStateDO'

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
for (const [method, path, handler] of [...aiRoutes, ...sandboxRoutes, ...vibeRoutes, ...buildRoutes, ...pageRoutes, ...documentRoutes, ...whispererRoutes, ...securityRoutes, ...appstateRoutes, ...monitorRoutes, ...vaultRoutes, ...replayRoutes, ...assertionRoutes, ...atlasRoutes, ...probesRoutes]) {
  router.on(method, path, handler)
}

// ── Worker export ─────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // WebSocket upgrades must bypass the HTTP router — pass directly to the appropriate DO
    if (req.headers.get('Upgrade') === 'websocket') {
      const { pathname } = new URL(req.url)
      const sandboxWs = pathname.match(/^\/api\/sandbox\/([^/]+)\/ws$/)
      if (sandboxWs) return env.SANDBOX.get(env.SANDBOX.idFromName(sandboxWs[1])).fetch(req)
      const builderWs = pathname.match(/^\/api\/v2\/build\/([^/]+)\/ws$/)
      if (builderWs) return env.APP_BUILDER.get(env.APP_BUILDER.idFromName(builderWs[1])).fetch(req)
    }
    return router.handle(req, env)
  },

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const schedule = event.cron === '0 * * * *' ? 'hourly'
      : event.cron === '0 9 * * 1' ? 'weekly'
      : 'daily'
    try {
      const { results } = await env.DB.prepare(
        'SELECT id FROM probes WHERE schedule = ?',
      ).bind(schedule).all<{ id: string }>()
      for (const row of results ?? []) {
        await runProbeById(row.id, env).catch(e =>
          console.error(`[scheduled] probe ${row.id} failed:`, e)
        )
      }
    } catch (e) {
      console.error('[scheduled] cron handler failed:', e)
    }
  },

  async queue(batch: MessageBatch<AetherLiteJob>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        if (msg.body.type === 'file_process')    await processFile(msg.body, env)
        if (msg.body.type === 'embedding_batch') await processEmbeddingBatch(msg.body, env)
        msg.ack()
      } catch (e) {
        console.error('[queue] job failed:', msg.body.type, e)
        try {
          await env.DB.prepare(
            'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
          ).bind(
            msg.body.sandboxId ?? '',
            'job_failed',
            JSON.stringify({ jobType: msg.body.type, error: String(e), attempts: msg.attempts }),
            null,
            Date.now(),
          ).run()
        } catch { /* D1 write must not prevent retry */ }
        msg.retry()
      }
    }
  },
}
