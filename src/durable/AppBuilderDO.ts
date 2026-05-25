import type { Env } from '../types/env'
import type { Message } from '../lib/schema'
import { completeStream, MODELS } from '../lib/ai'
import { json, ok, err } from '../lib/http'
import { MAX_BUILD_DESCRIPTION_LEN, MAX_BUILD_FILES, MAX_FILE_BYTES } from '../lib/constants'

// ── Build types ───────────────────────────────────────────────────────────────

interface BlueprintFile {
  filename: string
  description: string
  role: 'entry' | 'logic' | 'styles' | 'component'
}

interface Blueprint {
  name: string
  techStack: 'vanilla' | 'alpine' | 'react' | 'vue' | 'svelte'
  cdnDependencies: string[]
  files: BlueprintFile[]
  sandboxIntegration: boolean
}

interface BuildState {
  id: string
  name: string
  description: string
  sandboxId?: string
  model: string
  status: 'idle' | 'blueprinting' | 'generating' | 'complete' | 'error'
  blueprint?: Blueprint
  files: string[]
  errorMessage?: string
  createdAt: number
  completedAt?: number
}

// ── SSE stream reader ─────────────────────────────────────────────────────────

async function* readStreamTokens(stream: ReadableStream): AsyncGenerator<string> {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value as Uint8Array, { stream: true })
      const blocks = buf.split('\n\n')
      buf = blocks.pop() ?? ''
      for (const block of blocks) {
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if (!raw || raw === '[DONE]') continue
          let ev: { response?: string; done?: boolean; error?: string }
          try { ev = JSON.parse(raw) } catch { continue }
          if (ev.done) return
          if (ev.error) throw new Error(ev.error)
          if (ev.response) yield ev.response
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css:  'text/css; charset=utf-8',
    js:   'application/javascript; charset=utf-8',
    mjs:  'application/javascript; charset=utf-8',
    ts:   'application/typescript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg:  'image/svg+xml',
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    ico:  'image/x-icon',
    txt:  'text/plain; charset=utf-8',
    md:   'text/markdown; charset=utf-8',
  }
  return map[ext] ?? 'application/octet-stream'
}

function stripCodeFences(text: string): string {
  return text.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '').trim()
}

// ── AppBuilderDO ──────────────────────────────────────────────────────────────

export class AppBuilderDO {
  private state: DurableObjectState
  private env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') === 'websocket') return this.handleWebSocket(req)
    const { pathname } = new URL(req.url)
    if (req.method === 'POST'   && pathname === '/init')             return this.handleInit(req)
    if (req.method === 'GET'    && pathname === '/status')           return this.handleStatus()
    if (req.method === 'GET'    && pathname === '/files')            return this.handleFileList()
    if (req.method === 'GET'    && pathname.startsWith('/files/'))   return this.handleFile(decodeURIComponent(pathname.slice(7)))
    if (req.method === 'DELETE' && pathname === '/')                 return this.handleDelete()
    return json(err('Not found'), 404)
  }

  private async handleInit(req: Request): Promise<Response> {
    const body = await req.json() as {
      id: string; description: string; name?: string; sandboxId?: string; model?: string
    }
    const state: BuildState = {
      id:          body.id,
      name:        body.name ?? 'My App',
      description: body.description.slice(0, MAX_BUILD_DESCRIPTION_LEN),
      sandboxId:   body.sandboxId,
      model:       body.model ?? MODELS.textLarge,
      status:      'idle',
      files:       [],
      createdAt:   Date.now(),
    }
    await this.state.storage.put('state', state)
    return json(ok({ buildId: state.id, status: state.status }))
  }

  private async handleStatus(): Promise<Response> {
    const state = await this.state.storage.get<BuildState>('state')
    if (!state) return json(err('Not found'), 404)
    return json(ok(state))
  }

  private async handleFileList(): Promise<Response> {
    const state = await this.state.storage.get<BuildState>('state')
    if (!state) return json(err('Not found'), 404)
    return json(ok({ files: state.files, total: state.files.length }))
  }

  private async handleFile(filename: string): Promise<Response> {
    const state = await this.state.storage.get<BuildState>('state')
    if (!state) return new Response('Not found', { status: 404 })
    const obj = await this.env.FILES.get(`apps/${state.id}/${filename}`)
    if (!obj) return new Response('File not found', { status: 404 })
    return new Response(obj.body, { headers: { 'Content-Type': mimeType(filename) } })
  }

  private async handleDelete(): Promise<Response> {
    const state = await this.state.storage.get<BuildState>('state')
    if (state?.files.length) {
      await Promise.all(state.files.map(f => this.env.FILES.delete(`apps/${state.id}/${f}`)))
    }
    await this.state.storage.deleteAll()
    return json(ok({ deleted: true }))
  }

  private async handleWebSocket(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    server.accept()

    const state = await this.state.storage.get<BuildState>('state')
    if (!state) {
      server.send(JSON.stringify({ type: 'error', message: 'Build not found' }))
      server.close(1011, 'Build not found')
      return new Response(null, { status: 101, webSocket: client })
    }

    server.send(JSON.stringify({ type: 'connected', buildId: state.id }))

    server.addEventListener('message', ({ data }: MessageEvent) => {
      let msg: { type: string; description?: string; name?: string; sandboxId?: string; model?: string }
      try { msg = JSON.parse(data as string) } catch { return }

      if (msg.type === 'start') {
        ;(async () => {
          const fresh = await this.state.storage.get<BuildState>('state')
          if (!fresh) {
            server.send(JSON.stringify({ type: 'error', message: 'Build not found' }))
            return
          }
          if (msg.description) fresh.description = msg.description.slice(0, MAX_BUILD_DESCRIPTION_LEN)
          if (msg.name)        fresh.name = msg.name
          if (msg.sandboxId !== undefined) fresh.sandboxId = msg.sandboxId
          if (msg.model)       fresh.model = msg.model
          await this.state.storage.put('state', fresh)
          try {
            await this.runBuild(server, fresh)
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            try { server.send(JSON.stringify({ type: 'error', message: errMsg })) } catch { /* ws closed */ }
            const s = await this.state.storage.get<BuildState>('state')
            if (s) { s.status = 'error'; s.errorMessage = errMsg; await this.state.storage.put('state', s) }
          }
        })()
      } else if (msg.type === 'stop') {
        server.close(1000, 'Client stopped')
      }
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  private async runBuild(ws: WebSocket, initialState: BuildState): Promise<void> {
    const wsend = (obj: unknown) => { try { ws.send(JSON.stringify(obj)) } catch { /* ws may be closed */ } }

    // ── Blueprint phase ────────────────────────────────────────────────────────
    initialState.status = 'blueprinting'
    await this.state.storage.put('state', initialState)
    wsend({ type: 'blueprint_generating' })

    const blueprintSystem = `You are an expert web developer. Design a minimal self-contained web app from a description.
Output ONLY valid JSON — no markdown fences, no prose, no preamble.

Tech stack options:
- "vanilla": plain HTML/CSS/JavaScript — prefer this unless a framework is clearly needed
- "alpine": Alpine.js for reactive UI without a build step
- "react": React 18 via CDN ESM (complex UIs with many interactive components)
- "vue": Vue 3 via CDN ESM

CDN pattern: https://esm.sh/react@18, https://esm.sh/vue@3 etc.
index.html MUST always be included as the entry file.
Maximum ${MAX_BUILD_FILES} files total. Aim for 2-3. Keep it minimal and self-contained.

Output exactly this JSON structure (no other text):
{"name":"string","techStack":"vanilla|alpine|react|vue","cdnDependencies":["url"],"files":[{"filename":"index.html","description":"what it does","role":"entry"}],"sandboxIntegration":false}`

    const userContent = (initialState.sandboxId
      ? '[This app integrates with an Aether-Lite AI sandbox backend. Set sandboxIntegration:true]\n'
      : '') + initialState.description

    const blueprintMessages: Message[] = [{ role: 'user', content: userContent, timestamp: Date.now() }]
    const blueprintStream = completeStream(this.env.AI, this.env, {
      model:       initialState.model,
      systemPrompt: blueprintSystem,
      messages:    blueprintMessages,
      maxTokens:   1024,
      temperature: 0.1,
    })

    let blueprintText = ''
    for await (const token of readStreamTokens(blueprintStream)) {
      blueprintText += token
      wsend({ type: 'blueprint_chunk', text: token })
    }

    // Parse blueprint JSON — fall back to minimal vanilla app on parse failure
    let blueprint: Blueprint
    try {
      const jsonMatch = blueprintText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found in blueprint')
      const parsed = JSON.parse(jsonMatch[0]) as Partial<Blueprint>
      const validStacks = ['vanilla', 'alpine', 'react', 'vue', 'svelte']
      blueprint = {
        name:               typeof parsed.name === 'string' ? parsed.name : initialState.name,
        techStack:          validStacks.includes(parsed.techStack ?? '') ? parsed.techStack! : 'vanilla',
        cdnDependencies:    Array.isArray(parsed.cdnDependencies) ? parsed.cdnDependencies : [],
        files:              Array.isArray(parsed.files) && parsed.files.length > 0
                              ? parsed.files
                              : [{ filename: 'index.html', description: 'Main app page', role: 'entry' }],
        sandboxIntegration: parsed.sandboxIntegration === true,
      }
      if (!blueprint.files.find(f => f.filename === 'index.html')) {
        blueprint.files.unshift({ filename: 'index.html', description: 'Main entry point', role: 'entry' })
      }
      blueprint.files = blueprint.files.slice(0, MAX_BUILD_FILES)
    } catch {
      blueprint = {
        name: initialState.name, techStack: 'vanilla', cdnDependencies: [],
        files: [{ filename: 'index.html', description: 'Main app page', role: 'entry' }],
        sandboxIntegration: false,
      }
    }

    const stateWithBp = (await this.state.storage.get<BuildState>('state'))!
    stateWithBp.blueprint = blueprint
    stateWithBp.name      = blueprint.name || stateWithBp.name
    stateWithBp.status    = 'generating'
    await this.state.storage.put('state', stateWithBp)
    wsend({ type: 'blueprint_ready', blueprint })

    // ── File generation phase ──────────────────────────────────────────────────
    const fileListDesc  = blueprint.files.map((f, i) => `${i + 1}. ${f.filename} — ${f.description}`).join('\n')
    const cdnList       = blueprint.cdnDependencies.length > 0 ? blueprint.cdnDependencies.join(', ') : 'none'
    const sandboxNote   = blueprint.sandboxIntegration && initialState.sandboxId
      ? `\nThis app integrates with an Aether-Lite AI sandbox (ID: "${initialState.sandboxId}"). ` +
        `Import AetherLiteClient from /vibe-sdk.js and use client.sandbox.get('${initialState.sandboxId}').run(msg) for AI responses.`
      : ''

    const generatedFiles: string[] = []
    const enc = new TextEncoder()

    for (let i = 0; i < blueprint.files.length; i++) {
      const file = blueprint.files[i]
      wsend({ type: 'file_generating', filename: file.filename, index: i, total: blueprint.files.length })

      const doneList = generatedFiles.length > 0
        ? `\nFiles already written: ${generatedFiles.join(', ')}`
        : ''

      const fileMessages: Message[] = [{
        role: 'user',
        content: `App description: ${initialState.description}
Tech stack: ${blueprint.techStack}
CDN dependencies: ${cdnList}${sandboxNote}

All files in this app:
${fileListDesc}${doneList}

Write the complete content of: ${file.filename}
Purpose: ${file.description}`,
        timestamp: Date.now(),
      }]

      const fileStream = completeStream(this.env.AI, this.env, {
        model:       initialState.model,
        systemPrompt: `You are writing source code for a web app file.
Output ONLY the raw file content. No markdown fences, no explanation, no surrounding text.
The output is written directly to ${file.filename}.`,
        messages:    fileMessages,
        maxTokens:   4096,
        temperature: 0.1,
      })

      let fileContent = ''
      for await (const token of readStreamTokens(fileStream)) {
        fileContent += token
        wsend({ type: 'file_chunk', filename: file.filename, text: token })
      }

      fileContent = stripCodeFences(fileContent)
      let bytes = enc.encode(fileContent)
      if (bytes.length > MAX_FILE_BYTES) bytes = bytes.slice(0, MAX_FILE_BYTES)

      await this.env.FILES.put(`apps/${initialState.id}/${file.filename}`, bytes, {
        customMetadata: { buildId: initialState.id, filename: file.filename },
        httpMetadata:   { contentType: mimeType(file.filename) },
      })

      generatedFiles.push(file.filename)
      wsend({ type: 'file_complete', filename: file.filename, bytes: bytes.length })
    }

    // ── Complete ───────────────────────────────────────────────────────────────
    const finalState = await this.state.storage.get<BuildState>('state')
    if (finalState) {
      finalState.status      = 'complete'
      finalState.files       = generatedFiles
      finalState.completedAt = Date.now()
      await this.state.storage.put('state', finalState)
    }

    wsend({ type: 'build_complete', buildId: initialState.id, appUrl: `/build/${initialState.id}`, files: generatedFiles })
    ws.close(1000, 'Build complete')
  }
}
