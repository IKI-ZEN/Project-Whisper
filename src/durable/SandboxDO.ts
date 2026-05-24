import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../types/env'
import type { SandboxConfig, Message } from '../lib/schema'
import { runInSandbox, streamInSandbox } from '../lib/ai'
import { json, sseResponse } from '../lib/http'
import { now } from '../lib/utils'
import { DO_STORAGE_KEY, MAX_MESSAGES } from '../lib/constants'

export class SandboxDO extends DurableObject<Env> {
  private config: SandboxConfig | null = null

  // ── Hydration ─────────────────────────────────────────────────────────────

  private async load(): Promise<SandboxConfig> {
    if (this.config) return this.config
    const stored = await this.ctx.storage.get<SandboxConfig>(DO_STORAGE_KEY)
    if (!stored) throw new Error('Sandbox not initialized')
    this.config = stored
    return stored
  }

  private async save(config: SandboxConfig): Promise<void> {
    this.config = config
    await this.ctx.storage.put(DO_STORAGE_KEY, config)
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
    await this.save(config)
    return json({ ok: true, data: { id: config.id } })
  }

  private async handleGetConfig(): Promise<Response> {
    const config = await this.load()
    const { memory: _memory, ...meta } = config
    return json({ ok: true, data: meta })
  }

  private async handlePatchConfig(req: Request): Promise<Response> {
    const patch = await req.json() as Partial<SandboxConfig>
    const config = await this.load()
    // Disallow patching server-managed fields
    const { id: _i, memory: _m, createdAt: _c, ...allowed } = patch
    await this.save({ ...config, ...allowed, updatedAt: now() })
    return json({ ok: true, data: { updated: true } })
  }

  private async handleRun(req: Request): Promise<Response> {
    const { message } = await req.json() as { message: string }
    const config = await this.load()
    const ts = now()

    const reply = await runInSandbox(this.env.AI, this.env, config, message)

    const userMsg: Message  = { role: 'user',      content: message, timestamp: ts }
    const asstMsg: Message  = { role: 'assistant', content: reply,   timestamp: now() }
    const memory = [...config.memory, userMsg, asstMsg].slice(-MAX_MESSAGES)

    await this.save({ ...config, memory, updatedAt: now() })

    return json({ ok: true, data: { reply, turns: memory.length / 2 } })
  }

  private async handleStream(req: Request): Promise<Response> {
    const { message } = await req.json() as { message: string }
    const config = await this.load()

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
