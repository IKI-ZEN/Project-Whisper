import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../types/env'
import type { SandboxConfig, Message } from '../lib/schema'
import { runInSandboxWithRAG, streamInSandboxWithRAG } from '../lib/ai'
import { json, sseResponse } from '../lib/http'
import { now } from '../lib/utils'
import { DO_STORAGE_KEY, MAX_MESSAGES, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS } from '../lib/constants'
import { computeConfigHash } from '../lib/integrity'
import { scan, type ScanResult } from '../lib/guard'

const RL_STORAGE_KEY = 'rlState'

export class SandboxDO extends DurableObject<Env> {
  private config: SandboxConfig | null = null

  // ── Guard helper ─────────────────────────────────────────────────────────

  private guardedScan(text: string, mode?: string): ScanResult | null {
    if (mode === 'off') return null
    return scan(text)
  }

  // ── Hydration ─────────────────────────────────────────────────────────────

  private async load(): Promise<SandboxConfig> {
    if (this.config) return this.config
    const stored = await this.ctx.storage.get<SandboxConfig>(DO_STORAGE_KEY)
    if (!stored) throw new Error('Sandbox not initialized')
    this.config = stored
    return stored
  }

  private async save(config: SandboxConfig): Promise<void> {
    config.integrityHash = await computeConfigHash(config)
    this.config = config
    await this.ctx.storage.put(DO_STORAGE_KEY, config)
  }

  // ── Rate limiting (persistent — survives DO hibernation) ─────────────────

  private async checkRateLimit(): Promise<boolean> {
    const stored = await this.ctx.storage.get<{ window: number[] }>(RL_STORAGE_KEY) ?? { window: [] }
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS
    const window = stored.window.filter(t => t > cutoff)
    if (window.length >= RATE_LIMIT_MAX_REQUESTS) return false
    window.push(Date.now())
    // Fire-and-forget — don't block the request on the write
    void this.ctx.storage.put(RL_STORAGE_KEY, { window })
    return true
  }

  // ── Fetch router ──────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)

    try {
      switch (`${request.method} ${pathname}`) {
        case 'POST /init':    return this.handleInit(request)
        case 'GET /config':   return this.handleGetConfig()
        case 'PATCH /config': return this.handlePatchConfig(request)
        case 'POST /run':     return this.handleRun(request)
        case 'POST /stream':  return this.handleStream(request)
        case 'GET /history':  return this.handleHistory()
        case 'DELETE /':      return this.handleDelete()
        default: return json({ ok: false, error: 'DO route not found' }, 404)
      }
    } catch (e) {
      return json({ ok: false, error: String(e) }, 500)
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  private async handleInit(req: Request): Promise<Response> {
    const config = await req.json() as SandboxConfig

    const guard = this.guardedScan(config.systemPrompt ?? '', config.guardMode)
    if (guard) {
      if (guard.riskLevel === 'blocked' && config.guardMode !== 'audit') {
        return json({ ok: false, error: 'System prompt blocked: adversarial content detected', patterns: guard.patterns }, 422)
      }
      if (guard.riskLevel !== 'clean') {
        void this.env.DB.prepare(
          'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)',
        ).bind(config.id, 'guard_flag', JSON.stringify({ source: 'init', patterns: guard.patterns }), now()).run()
      }
    }

    await this.save(config)
    return json({ ok: true, data: { id: config.id } })
  }

  private async handleGetConfig(): Promise<Response> {
    const config = await this.load()
    const freshHash = await computeConfigHash(config)
    const tampered = !!config.integrityHash && config.integrityHash !== freshHash
    const { memory: _memory, ...meta } = config
    return json({ ok: true, data: { ...meta, tampered } })
  }

  private async handlePatchConfig(req: Request): Promise<Response> {
    const patch = await req.json() as Partial<SandboxConfig>
    const config = await this.load()

    if (patch.systemPrompt !== undefined) {
      const effectiveMode = patch.guardMode ?? config.guardMode ?? 'strict'
      const guard = this.guardedScan(patch.systemPrompt, effectiveMode)
      if (guard) {
        if (guard.riskLevel === 'blocked' && effectiveMode !== 'audit') {
          return json({ ok: false, error: 'System prompt blocked: adversarial content detected', patterns: guard.patterns }, 422)
        }
        if (guard.riskLevel !== 'clean') {
          void this.env.DB.prepare(
            'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)',
          ).bind(config.id, 'guard_flag', JSON.stringify({ source: 'patch', patterns: guard.patterns }), now()).run()
        }
      }
    }

    // Disallow patching server-managed fields including integrityHash
    const { id: _i, memory: _m, createdAt: _c, integrityHash: _ih, ...allowed } = patch
    await this.save({ ...config, ...allowed, updatedAt: now() })
    return json({ ok: true, data: { updated: true } })
  }

  private async handleRun(req: Request): Promise<Response> {
    if (!await this.checkRateLimit()) {
      return json({ ok: false, error: 'Rate limit exceeded — try again in a moment' }, 429)
    }

    const { message } = await req.json() as { message: string }
    const config = await this.load()
    const gMode = config.guardMode ?? 'strict'

    const guard = this.guardedScan(message, gMode)
    if (guard) {
      if (guard.riskLevel === 'blocked' && gMode !== 'audit') {
        return json({ ok: false, error: 'Message blocked: adversarial content detected', patterns: guard.patterns }, 422)
      }
      if (guard.riskLevel !== 'clean') {
        void this.env.DB.prepare(
          'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)',
        ).bind(config.id, 'guard_flag', JSON.stringify({ source: 'run', patterns: guard.patterns }), now()).run()
      }
    }

    const ts = now()
    const startMs = Date.now()
    const reply = await runInSandboxWithRAG(this.env.AI, this.env, config, message)
    const latencyMs = Date.now() - startMs

    void this.env.DB.prepare(
      'INSERT INTO usage_metrics (sandbox_id, model, tokens_in, tokens_out, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(config.id, config.model, Math.ceil(message.length / 4), Math.ceil(reply.length / 4), latencyMs, now()).run()

    // Outbound scan — detect if the model was successfully jailbroken
    const replyGuard = this.guardedScan(reply, gMode)
    if (replyGuard && replyGuard.riskLevel !== 'clean') {
      void this.env.DB.prepare(
        'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)',
      ).bind(config.id, 'response_flag', JSON.stringify({ patterns: replyGuard.patterns }), now()).run()
    }

    const userMsg: Message  = { role: 'user',      content: message, timestamp: ts }
    const asstMsg: Message  = { role: 'assistant', content: reply,   timestamp: now() }
    const memory = [...config.memory, userMsg, asstMsg].slice(-MAX_MESSAGES)

    await this.save({ ...config, memory, updatedAt: now() })

    return json({ ok: true, data: { reply, turns: memory.length / 2 } })
  }

  private async handleStream(req: Request): Promise<Response> {
    if (!await this.checkRateLimit()) {
      return json({ ok: false, error: 'Rate limit exceeded — try again in a moment' }, 429)
    }

    const { message } = await req.json() as { message: string }
    const config = await this.load()
    const gMode = config.guardMode ?? 'strict'

    const guard = this.guardedScan(message, gMode)
    if (guard) {
      if (guard.riskLevel === 'blocked' && gMode !== 'audit') {
        return json({ ok: false, error: 'Message blocked: adversarial content detected', patterns: guard.patterns }, 422)
      }
      if (guard.riskLevel !== 'clean') {
        void this.env.DB.prepare(
          'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)',
        ).bind(config.id, 'guard_flag', JSON.stringify({ source: 'stream', patterns: guard.patterns }), now()).run()
      }
    }

    // Stream is preview-only — use /run to persist to memory
    return sseResponse(streamInSandboxWithRAG(this.env.AI, this.env, config, message))
  }

  private async handleHistory(): Promise<Response> {
    const config = await this.load()
    return json({ ok: true, data: config.memory })
  }

  private async handleDelete(): Promise<Response> {
    try {
      const config = await this.load()
      const sandboxId = config.id
      // Best-effort: clean up R2 documents and their Vectorize chunks
      void this.env.FILES.list({ prefix: `sandboxes/${sandboxId}/documents/` }).then(async listed => {
        for (const obj of listed.objects) {
          const docId = obj.key.split('/').pop() ?? ''
          if (docId) {
            const ids = Array.from({ length: 500 }, (_, i) => `${sandboxId}_${docId}_${i}`)
            void this.env.VECTORS.deleteByIds(ids).catch(() => {})
          }
          void this.env.FILES.delete(obj.key).catch(() => {})
        }
      }).catch(() => {})
    } catch { /* config not found — nothing to clean */ }
    await this.ctx.storage.deleteAll()
    this.config = null
    return json({ ok: true, data: { deleted: true } })
  }
}
