// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 IKI-ZEN

import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../types/env'
import type { SandboxConfig, Message } from '../lib/schema'
import { runInSandboxWithRAG, streamInSandboxWithRAG, isToolCallReply, decodeToolCalls, encodeToolResult } from '../lib/ai'
import { json, sseResponse } from '../lib/http'
import { now } from '../lib/utils'
import { DO_STORAGE_KEY, MAX_MESSAGES, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS, CODE_EXEC_TIMEOUT_MS } from '../lib/constants'
import { computeConfigHash } from '../lib/integrity'
import { scan, type ScanResult } from '../lib/guard'
import { sealPrompt, openPrompt, signPayload } from '../lib/vault'

const RL_STORAGE_KEY = 'rlState'
const MAX_TOOL_LOOPS = 10

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
    // Unseal systemPrompt if stored sealed (v1: prefix) and key is available.
    // openPrompt passes plaintext through unchanged if no v1: prefix.
    if (this.env.SIGNING_SECRET && stored.systemPrompt) {
      stored.systemPrompt = await openPrompt(stored.systemPrompt, this.env.SIGNING_SECRET, stored.id)
    }
    this.config = stored
    return stored
  }

  private async save(config: SandboxConfig): Promise<void> {
    config.integrityHash = await computeConfigHash(config)
    this.config = config   // always keep unsealed in memory
    // Seal systemPrompt before writing to DO storage when key is available.
    const sp = config.systemPrompt
    const toStore = (this.env.SIGNING_SECRET && sp && !sp.startsWith('v1:'))
      ? { ...config, systemPrompt: await sealPrompt(sp, this.env.SIGNING_SECRET, config.id) }
      : config
    await this.ctx.storage.put(DO_STORAGE_KEY, toStore)
  }

  // ── Per-session memory ────────────────────────────────────────────────────
  // Empty/undefined sessionId uses config.memory (default thread).
  // Named sessionIds get their own Message[] stored under session:{id}.

  private async loadSessionMemory(sessionId: string | undefined, config: SandboxConfig): Promise<Message[]> {
    if (!sessionId) return config.memory
    return (await this.ctx.storage.get<Message[]>(`session:${sessionId}`)) ?? []
  }

  private async saveSessionMemory(sessionId: string | undefined, memory: Message[], config: SandboxConfig): Promise<void> {
    if (!sessionId) {
      await this.save({ ...config, memory, updatedAt: now() })
      return
    }
    await this.ctx.storage.put(`session:${sessionId}`, memory)
  }

  // ── Rate limiting (persistent — survives DO hibernation) ─────────────────

  private async checkRateLimit(): Promise<boolean> {
    const stored = await this.ctx.storage.get<{ window: number[] }>(RL_STORAGE_KEY) ?? { window: [] }
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS
    const window = stored.window.filter(t => t > cutoff)
    if (window.length >= RATE_LIMIT_MAX_REQUESTS) return false
    window.push(Date.now())
    void this.ctx.storage.put(RL_STORAGE_KEY, { window })
    return true
  }

  // ── Built-in code execution ───────────────────────────────────────────────

  private async executeCode(code: string): Promise<string> {
    try {
      const result = await Promise.race([
        new Promise<string>(resolve => {
          // eslint-disable-next-line no-new-func
          const fn = new Function('__code', `
            const logs = []
            const c = {
              log:   (...a) => logs.push(a.map(String).join(' ')),
              error: (...a) => logs.push('ERROR: ' + a.map(String).join(' ')),
              warn:  (...a) => logs.push('WARN: '  + a.map(String).join(' ')),
            }
            let __result
            try {
              __result = eval(__code)
            } catch(e) {
              resolve('Error: ' + e.message)
              return
            }
            const out = logs.join('\\n')
            if (__result !== undefined && __result !== null) {
              resolve(out ? out + '\\n' + String(__result) : String(__result))
            } else {
              resolve(out || '(no output)')
            }
          `)
          fn(code)
        }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error(`Execution timed out after ${CODE_EXEC_TIMEOUT_MS / 1000}s`)), CODE_EXEC_TIMEOUT_MS)
        ),
      ])
      return result
    } catch (e) {
      return `Error: ${String(e)}`
    }
  }

  // ── Tool call loop ────────────────────────────────────────────────────────
  // Runs tool calls server-side for built-in tools (run_code).
  // Returns the final non-tool-call reply and the full updated memory.

  private async runWithToolLoop(
    config: SandboxConfig, memory: Message[], userMessage: string,
  ): Promise<{ reply: string; memory: Message[] }> {
    let currentMemory = [...memory, { role: 'user' as const, content: userMessage, timestamp: now() }]
    let loops = 0

    while (loops < MAX_TOOL_LOOPS) {
      loops++
      const configWithMem = { ...config, memory: currentMemory.slice(0, -1) }
      const lastMsg = currentMemory[currentMemory.length - 1]
      const reply = await runInSandboxWithRAG(this.env.AI, this.env, configWithMem, lastMsg.content)
      const assistantMsg: Message = { role: 'assistant', content: reply, timestamp: now() }

      if (!isToolCallReply(reply)) {
        currentMemory = [...currentMemory, assistantMsg]
        return { reply, memory: currentMemory }
      }

      // Handle tool calls — currently only run_code is executed server-side
      const calls = decodeToolCalls(reply)
      currentMemory = [...currentMemory, assistantMsg]

      for (const call of calls) {
        let result: string
        if (call.name === 'run_code') {
          const code = typeof call.input.code === 'string' ? call.input.code : String(call.input.code ?? '')
          result = await this.executeCode(code)
        } else {
          // Non-built-in tool: return tool_call reply so caller can handle it
          return { reply, memory: currentMemory }
        }
        const toolResultMsg: Message = {
          role: 'user',
          content: encodeToolResult(call.id, call.name, result),
          timestamp: now(),
        }
        currentMemory = [...currentMemory, toolResultMsg]
      }
    }

    // Max loops hit — return last state
    const last = currentMemory[currentMemory.length - 1]
    return { reply: last.content, memory: currentMemory }
  }

  // ── Fetch router ──────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    // WebSocket upgrade — handled before the switch to avoid URL matching issues
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request)
    }

    const { pathname } = new URL(request.url)

    try {
      switch (`${request.method} ${pathname}`) {
        case 'POST /init':    return this.handleInit(request)
        case 'GET /config':   return this.handleGetConfig()
        case 'PATCH /config': return this.handlePatchConfig(request)
        case 'POST /run':     return this.handleRun(request)
        case 'POST /stream':  return this.handleStream(request)
        case 'GET /history':  return this.handleHistory(request)
        case 'DELETE /':      return this.handleDelete()
        default: return json({ ok: false, error: 'DO route not found' }, 404)
      }
    } catch (e) {
      return json({ ok: false, error: String(e) }, 500)
    }
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  private handleWebSocket(req: Request): Response {
    const url = new URL(req.url)
    const sessionId = url.searchParams.get('sessionId') ?? undefined

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()

    // pendingResolve allows the message handler to wait for a tool_result reply
    let pendingResolve: ((raw: string) => void) | null = null

    server.addEventListener('message', async ({ data }: MessageEvent) => {
      const raw = typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer)
      let msg: { type: string; content?: string; results?: unknown[] }
      try { msg = JSON.parse(raw) } catch { return }

      if (msg.type === 'tool_result' && pendingResolve) {
        const r = pendingResolve
        pendingResolve = null
        r(raw)
        return
      }

      if (msg.type !== 'message' || !msg.content) return

      try {
        if (!await this.checkRateLimit()) {
          server.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }))
          return
        }

        const config = await this.load()
        const gMode = config.guardMode ?? 'strict'
        const guard = this.guardedScan(msg.content, gMode)

        if (guard) {
          if (guard.riskLevel === 'blocked' && gMode !== 'audit') {
            server.send(JSON.stringify({ type: 'error', message: 'Message blocked: adversarial content detected' }))
            return
          }
          if (guard.riskLevel !== 'clean') {
            void this.env.DB.prepare(
              'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
            ).bind(config.id, 'guard_flag', JSON.stringify({ source: 'ws', patterns: guard.patterns }), null, now()).run()
          }
        }

        const memory = await this.loadSessionMemory(sessionId, config)
        const { reply, memory: updatedMemory } = await this.runWithToolLoop(config, memory, msg.content)

        // If the final reply is still a tool call, client must handle it
        if (isToolCallReply(reply)) {
          const calls = decodeToolCalls(reply)
          server.send(JSON.stringify({ type: 'tool_call', calls }))
          // Wait for client tool_result
          const toolResultRaw = await new Promise<string>(resolve => { pendingResolve = resolve })
          let toolMsg: { type: string; results?: Array<{ toolUseId: string; toolName: string; content: string }> }
          try { toolMsg = JSON.parse(toolResultRaw) } catch { return }
          const resultMemory = [...updatedMemory]
          for (const r of (toolMsg.results ?? [])) {
            resultMemory.push({ role: 'user', content: encodeToolResult(r.toolUseId, r.toolName, r.content), timestamp: now() })
          }
          const finalReply = await runInSandboxWithRAG(
            this.env.AI, this.env,
            { ...config, memory: resultMemory.slice(0, -1) },
            resultMemory[resultMemory.length - 1].content,
          )
          const finalMemory = [...resultMemory, { role: 'assistant' as const, content: finalReply, timestamp: now() }]
          await this.saveSessionMemory(sessionId, finalMemory.slice(-MAX_MESSAGES), config)
          server.send(JSON.stringify({ type: 'done', reply: finalReply }))
          return
        }

        const trimmed = updatedMemory.slice(-MAX_MESSAGES)
        await this.saveSessionMemory(sessionId, trimmed, config)
        server.send(JSON.stringify({ type: 'done', reply }))
      } catch (e) {
        server.send(JSON.stringify({ type: 'error', message: String(e) }))
      }
    })

    server.addEventListener('close', () => { /* connection closed */ })
    server.addEventListener('error', () => { try { server.close(1011, 'Internal error') } catch {} })

    return new Response(null, { status: 101, webSocket: client })
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  private async handleInit(req: Request): Promise<Response> {
    const config   = await req.json() as SandboxConfig
    const identity = req.headers.get('X-Aether-Identity') ?? null

    const guard = this.guardedScan(config.systemPrompt ?? '', config.guardMode)
    if (guard) {
      if (guard.riskLevel === 'blocked' && config.guardMode !== 'audit') {
        return json({ ok: false, error: 'System prompt blocked: adversarial content detected', patterns: guard.patterns }, 422)
      }
      if (guard.riskLevel !== 'clean') {
        void this.env.DB.prepare(
          'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(config.id, 'guard_flag', JSON.stringify({ source: 'init', patterns: guard.patterns }), identity, now()).run()
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
    const patch    = await req.json() as Partial<SandboxConfig>
    const config   = await this.load()
    const identity = req.headers.get('X-Aether-Identity') ?? null

    if (patch.systemPrompt !== undefined) {
      const effectiveMode = patch.guardMode ?? config.guardMode ?? 'strict'
      const guard = this.guardedScan(patch.systemPrompt, effectiveMode)
      if (guard) {
        if (guard.riskLevel === 'blocked' && effectiveMode !== 'audit') {
          return json({ ok: false, error: 'System prompt blocked: adversarial content detected', patterns: guard.patterns }, 422)
        }
        if (guard.riskLevel !== 'clean') {
          void this.env.DB.prepare(
            'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
          ).bind(config.id, 'guard_flag', JSON.stringify({ source: 'patch', patterns: guard.patterns }), identity, now()).run()
        }
      }
    }

    const { id: _i, memory: _m, createdAt: _c, integrityHash: _ih, ...allowed } = patch
    await this.save({ ...config, ...allowed, updatedAt: now() })
    return json({ ok: true, data: { updated: true } })
  }

  private async handleRun(req: Request): Promise<Response> {
    if (!await this.checkRateLimit()) {
      return json({ ok: false, error: 'Rate limit exceeded — try again in a moment' }, 429)
    }

    const body     = await req.json() as { message: string; sessionId?: string }
    const { message, sessionId } = body
    const identity = req.headers.get('X-Aether-Identity') ?? null
    const config   = await this.load()
    const gMode    = config.guardMode ?? 'strict'

    const guard = this.guardedScan(message, gMode)
    if (guard) {
      if (guard.riskLevel === 'blocked' && gMode !== 'audit') {
        return json({ ok: false, error: 'Message blocked: adversarial content detected', patterns: guard.patterns }, 422)
      }
      if (guard.riskLevel !== 'clean') {
        void this.env.DB.prepare(
          'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(config.id, 'guard_flag', JSON.stringify({ source: 'run', patterns: guard.patterns }), identity, now()).run()
      }
    }

    const startMs = Date.now()
    const memory  = await this.loadSessionMemory(sessionId, config)
    const { reply, memory: updatedMemory } = await this.runWithToolLoop(config, memory, message)
    const latencyMs = Date.now() - startMs

    void this.env.DB.prepare(
      'INSERT INTO usage_metrics (sandbox_id, model, tokens_in, tokens_out, latency_ms, identity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(config.id, config.model, Math.ceil(message.length / 4), Math.ceil(reply.length / 4), latencyMs, identity, now()).run()

    const replyGuard = this.guardedScan(reply, gMode)
    if (replyGuard && replyGuard.riskLevel !== 'clean') {
      void this.env.DB.prepare(
        'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(config.id, 'response_flag', JSON.stringify({ patterns: replyGuard.patterns }), identity, now()).run()
    }

    const trimmed = updatedMemory.slice(-MAX_MESSAGES)
    await this.saveSessionMemory(sessionId, trimmed, config)

    // Signal E: HMAC over the response so clients can verify provenance.
    const resData    = { ok: true, data: { reply, turns: Math.floor(trimmed.length / 2) } }
    const resHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.env.SIGNING_SECRET) {
      resHeaders['X-Response-Sig'] = await signPayload(
        JSON.stringify({ response: reply, messageCount: trimmed.length, sandboxId: config.id }),
        this.env.SIGNING_SECRET,
      )
    }
    return new Response(JSON.stringify(resData), { status: 200, headers: resHeaders })
  }

  private async handleStream(req: Request): Promise<Response> {
    if (!await this.checkRateLimit()) {
      return json({ ok: false, error: 'Rate limit exceeded — try again in a moment' }, 429)
    }

    const body     = await req.json() as { message: string; sessionId?: string }
    const { message } = body
    const identity = req.headers.get('X-Aether-Identity') ?? null
    const config   = await this.load()
    const gMode    = config.guardMode ?? 'strict'

    const guard = this.guardedScan(message, gMode)
    if (guard) {
      if (guard.riskLevel === 'blocked' && gMode !== 'audit') {
        return json({ ok: false, error: 'Message blocked: adversarial content detected', patterns: guard.patterns }, 422)
      }
      if (guard.riskLevel !== 'clean') {
        void this.env.DB.prepare(
          'INSERT INTO sandbox_events (sandbox_id, event_type, metadata, identity, created_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(config.id, 'guard_flag', JSON.stringify({ source: 'stream', patterns: guard.patterns }), identity, now()).run()
      }
    }

    return sseResponse(streamInSandboxWithRAG(this.env.AI, this.env, config, message))
  }

  private async handleHistory(req: Request): Promise<Response> {
    const config = await this.load()
    // Accept sessionId as query param for GET requests
    const url = new URL(req.url)
    const sessionId = url.searchParams.get('sessionId') ?? undefined
    const memory = await this.loadSessionMemory(sessionId, config)
    return json({ ok: true, data: memory })
  }

  private async handleDelete(): Promise<Response> {
    try {
      const config = await this.load()
      const sandboxId = config.id
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
