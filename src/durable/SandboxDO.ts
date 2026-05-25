import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../types/env'
import type { SandboxConfig, Message } from '../lib/schema'
import { runInSandbox, streamInSandbox } from '../lib/ai'
import { json, sseResponse } from '../lib/http'
import { now } from '../lib/utils'
import { DO_STORAGE_KEY, MAX_MESSAGES, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS } from '../lib/constants'
import { computeConfigHash } from '../lib/integrity'
import { scan } from '../lib/guard'

export class SandboxDO extends DurableObject<Env> {
  private config: SandboxConfig | null = null
  private rlWindow: number[] = []   // in-memory sliding window; resets on hibernation

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

  // ── Rate limiting ─────────────────────────────────────────────────────────

  private checkRateLimit(): boolean {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS
    this.rlWindow = this.rlWindow.filter(t => t > cutoff)
    if (this.rlWindow.length >= RATE_LIMIT_MAX_REQUESTS) return false
    this.rlWindow.push(Date.now())
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

    const guard = scan(config.systemPrompt ?? '')
    if (guard.riskLevel === 'blocked') {
      return json({ ok: false, error: 'System prompt blocked: adversarial content detected', patterns: guard.patterns }, 422)
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

    if (patch.systemPrompt !== undefined) {
      const guard = scan(patch.systemPrompt)
      if (guard.riskLevel === 'blocked') {
        return json({ ok: false, error: 'System prompt blocked: adversarial content detected', patterns: guard.patterns }, 422)
      }
      if (guard.riskLevel === 'suspicious') {
        const config = await this.load()
        await this.env.DB.prepare(
          'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)',
        ).bind(config.id, 'guard_flag', JSON.stringify({ source: 'patch', patterns: guard.patterns }), now()).run()
      }
    }

    const config = await this.load()
    const { id: _i, memory: _m, createdAt: _c, ...allowed } = patch
    await this.save({ ...config, ...allowed, updatedAt: now() })
    return json({ ok: true, data: { updated: true } })
  }

  private async handleRun(req: Request): Promise<Response> {
    if (!this.checkRateLimit()) {
      return json({ ok: false, error: 'Rate limit exceeded — try again in a moment' }, 429)
    }

    const { message } = await req.json() as { message: string }

    const guard = scan(message)
    if (guard.riskLevel === 'blocked') {
      return json({ ok: false, error: 'Message blocked: adversarial content detected', patterns: guard.patterns }, 422)
    }

    const config = await this.load()

    if (guard.riskLevel === 'suspicious') {
      await this.env.DB.prepare(
        'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)',
      ).bind(config.id, 'guard_flag', JSON.stringify({ source: 'run', patterns: guard.patterns }), now()).run()
    }

    const ts = now()
    const reply = await runInSandbox(this.env.AI, this.env, config, message)

    const userMsg: Message  = { role: 'user',      content: message, timestamp: ts }
    const asstMsg: Message  = { role: 'assistant', content: reply,   timestamp: now() }
    const memory = [...config.memory, userMsg, asstMsg].slice(-MAX_MESSAGES)

    await this.save({ ...config, memory, updatedAt: now() })

    return json({ ok: true, data: { reply, turns: memory.length / 2 } })
  }

  private async handleStream(req: Request): Promise<Response> {
    if (!this.checkRateLimit()) {
      return json({ ok: false, error: 'Rate limit exceeded — try again in a moment' }, 429)
    }

    const { message } = await req.json() as { message: string }

    const guard = scan(message)
    if (guard.riskLevel === 'blocked') {
      return json({ ok: false, error: 'Message blocked: adversarial content detected', patterns: guard.patterns }, 422)
    }

    const config = await this.load()

    if (guard.riskLevel === 'suspicious') {
      await this.env.DB.prepare(
        'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)',
      ).bind(config.id, 'guard_flag', JSON.stringify({ source: 'stream', patterns: guard.patterns }), now()).run()
    }

    // Stream is preview-only — use /run to persist to memory
    return sseResponse(streamInSandbox(this.env.AI, this.env, config, message))
  }

  private async handleHistory(): Promise<Response> {
    const config = await this.load()
    return json({ ok: true, data: config.memory })
  }

  private async handleDelete(): Promise<Response> {
    await this.ctx.storage.deleteAll()
    this.config = null
    return json({ ok: true, data: { deleted: true } })
  }
}
