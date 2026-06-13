/**
 * Whisper SDK — zero-dependency client for Project Whisper
 *
 * Usage (ES module):
 *   import { WhisperClient } from '/vibe-sdk.js'
 *   const client = new WhisperClient()
 *
 * Usage (web component):
 *   <script type="module" src="/vibe-sdk.js"></script>
 *   <whisper-chat sandbox-id="abc123"></whisper-chat>
 *
 * @module vibe-sdk
 */

// ── Error ─────────────────────────────────────────────────────────────────────

export class VibeError extends Error {
  /** @type {number} */ status
  /** @type {unknown} */ detail

  /**
   * @param {string} message
   * @param {number} [status]
   * @param {unknown} [detail]
   */
  constructor(message, status = 0, detail) {
    super(message)
    this.name = 'VibeError'
    this.status = status
    this.detail = detail
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Parse a ReadableStream of SSE data, yielding response string tokens.
 * Throws VibeError on ev.error; returns on ev.done.
 * @param {ReadableStream<Uint8Array>} body
 * @returns {AsyncGenerator<string>}
 */
async function* parseSSEStream(body) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const blocks = buf.split('\n\n')
      buf = blocks.pop() ?? ''
      for (const block of blocks) {
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if (!raw || raw === '[DONE]') continue
          /** @type {any} */
          let ev
          try { ev = JSON.parse(raw) } catch { continue }
          if (ev.done) return
          if (ev.error) throw new VibeError(ev.error)
          if (typeof ev.response === 'string') yield ev.response
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Fetch wrapper that unwraps the { ok, data, error } envelope.
 * Throws VibeError on non-ok responses.
 * @param {string} baseUrl
 * @param {string} path
 * @param {string} method
 * @param {unknown} [body]
 * @returns {Promise<unknown>}
 */
async function apiRequest(baseUrl, path, method, body) {
  const isForm = body instanceof FormData
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: !isForm && body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })
  /** @type {any} */
  const data = await res.json()
  if (!data.ok) throw new VibeError(data.error ?? 'Request failed', res.status, data.detail)
  return data.data
}

// ── AiClient ──────────────────────────────────────────────────────────────────

export class AiClient {
  /** @param {string} baseUrl */
  constructor(baseUrl) { this._base = baseUrl }

  /**
   * Blocking text completion.
   * @param {{ model?: string, prompt?: string, messages?: object[], systemPrompt?: string, temperature?: number, maxTokens?: number }} opts
   * @returns {Promise<string>}
   */
  async complete(opts) {
    const data = /** @type {{ response: string }} */ (
      await apiRequest(this._base, '/api/ai/complete', 'POST', opts)
    )
    return data.response
  }

  /**
   * Streaming text completion — yields tokens as they arrive.
   * @param {{ model?: string, prompt?: string, messages?: object[], systemPrompt?: string, temperature?: number, maxTokens?: number }} opts
   * @returns {AsyncGenerator<string>}
   */
  async * stream(opts) {
    const res = await fetch(`${this._base}/api/ai/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    })
    if (!res.ok || !res.body) throw new VibeError('Stream request failed', res.status)
    yield * parseSSEStream(res.body)
  }

  /**
   * Generate vector embeddings.
   * @param {string | string[]} text
   * @param {string} [model]
   * @returns {Promise<number[][]>}
   */
  async embed(text, model) {
    const data = /** @type {{ embeddings: number[][] }} */ (
      await apiRequest(this._base, '/api/ai/embed', 'POST', { text, model })
    )
    return data.embeddings
  }

  /**
   * Generate an image and return a base64-encoded PNG string.
   * @param {string} prompt
   * @param {{ model?: string, steps?: number }} [opts]
   * @returns {Promise<string>}
   */
  async image(prompt, opts = {}) {
    const data = /** @type {{ image: string }} */ (
      await apiRequest(this._base, '/api/ai/image', 'POST', { prompt, ...opts })
    )
    return data.image
  }

  /**
   * Transcribe audio to text.
   * @param {File | Blob} audio
   * @param {string} [model]
   * @returns {Promise<string>}
   */
  async transcribe(audio, model) {
    const form = new FormData()
    form.append('audio', audio)
    if (model) form.append('model', model)
    const data = /** @type {{ text: string }} */ (
      await apiRequest(this._base, '/api/ai/transcribe', 'POST', form)
    )
    return data.text
  }

  /**
   * Run the same prompt across multiple models in parallel and return results with latency.
   * @param {string[]} models
   * @param {string} prompt
   * @param {{ systemPrompt?: string, temperature?: number, maxTokens?: number }} [opts]
   */
  async compare(models, prompt, opts = {}) {
    return /** @type {any} */ (
      await apiRequest(this._base, '/api/ai/compare', 'POST', { models, prompt, ...opts })
    )
  }

  /**
   * Run the same prompt at multiple temperatures to map attractor basin behavior.
   * @param {string} prompt
   * @param {number[]} temperatures
   * @param {{ model?: string, systemPrompt?: string, maxTokens?: number, samples?: number }} [opts]
   */
  async sweep(prompt, temperatures, opts = {}) {
    return /** @type {any} */ (
      await apiRequest(this._base, '/api/ai/sweep', 'POST', { prompt, temperatures, ...opts })
    )
  }

  /**
   * Prompt sensitivity analysis — generate paraphrases and measure response variance.
   * @param {string} prompt
   * @param {{ variants?: number, model?: string, systemPrompt?: string, temperature?: number, maxTokens?: number }} [opts]
   * @returns {Promise<{ variants: Array<{ prompt: string, response: string }>, similarityMatrix: number[][], latencyMs: number }>}
   */
  async sensitivity(prompt, opts = {}) {
    return /** @type {any} */ (
      await apiRequest(this._base, '/api/ai/sensitivity', 'POST', { prompt, ...opts })
    )
  }

  /**
   * Semantic response clustering — embed texts and cluster by cosine similarity.
   * @param {string[]} texts
   * @param {{ k?: number, model?: string }} [opts]
   * @returns {Promise<{ k: number, labels: number[], clusters: Array<{ label: number, items: string[] }>, similarityMatrix: number[][], latencyMs: number }>}
   */
  async cluster(texts, opts = {}) {
    return /** @type {any} */ (
      await apiRequest(this._base, '/api/ai/cluster', 'POST', { texts, ...opts })
    )
  }

  /**
   * Chain-of-thought probing — run 4 reasoning styles in parallel and compare outputs.
   * @param {string} prompt
   * @param {{ model?: string, systemPrompt?: string, temperature?: number, maxTokens?: number, samples?: number }} [opts]
   * @returns {Promise<{ results: Array<{ style: string, response: string, latencyMs: number }> }>}
   */
  async cot(prompt, opts = {}) {
    return /** @type {any} */ (
      await apiRequest(this._base, '/api/ai/cot', 'POST', { prompt, ...opts })
    )
  }

  /**
   * Token entropy / attractor stability — sample the model multiple times and measure response diversity.
   * @param {string} prompt
   * @param {{ model?: string, systemPrompt?: string, temperature?: number, maxTokens?: number, samples?: number }} [opts]
   * @returns {Promise<{ samples: string[], entropy: number, avgCosineSimilarity: number, latencyMs: number }>}
   */
  async entropy(prompt, opts = {}) {
    return /** @type {any} */ (
      await apiRequest(this._base, '/api/ai/entropy', 'POST', { prompt, ...opts })
    )
  }

  /**
   * Prompt archaeology — reverse-engineer candidate system prompts from a target response.
   * @param {string} targetResponse
   * @param {{ probe?: string, model?: string, candidates?: number, maxTokens?: number }} [opts]
   * @returns {Promise<{ candidates: Array<{ candidate: string, similarity: number }> }>}
   */
  async archaeology(targetResponse, opts = {}) {
    return /** @type {any} */ (
      await apiRequest(this._base, '/api/ai/archaeology', 'POST', { targetResponse, ...opts })
    )
  }

  /**
   * Pipeline executor — run a declarative node graph where each node routes through a specific model.
   * @param {string} input
   * @param {Array<{ id: string, type: 'complete'|'classify'|'guard'|'transform'|'parallel', model?: string, systemPrompt?: string, temperature?: number, maxTokens?: number, template?: string, branches?: string[], select?: 'first'|'best'|'all', routes: Array<{ condition: string, nextId: string }> }>} nodes
   * @param {string} entryId
   * @param {{ maxDepth?: number }} [opts]
   * @returns {Promise<{ output: string, trace: Array<{ nodeId: string, type: string, input: string, output: string, conditionMet?: string, latencyMs: number }> }>}
   */
  async pipeline(input, nodes, entryId, opts = {}) {
    return /** @type {any} */ (
      await apiRequest(this._base, '/api/ai/pipeline', 'POST', { input, nodes, entryId, ...opts })
    )
  }

  /**
   * Extended thinking — generate a response with an explicit reasoning trace.
   * Uses Anthropic extended thinking for `anthropic:*` models; falls back to XML reasoning prompt.
   * @param {string} prompt
   * @param {{ model?: string, systemPrompt?: string, maxTokens?: number, budgetTokens?: number }} [opts]
   * @returns {Promise<{ thinking: string, response: string, latencyMs: number }>}
   */
  async think(prompt, opts = {}) {
    return /** @type {any} */ (
      await apiRequest(this._base, '/api/ai/think', 'POST', { prompt, ...opts })
    )
  }

  /**
   * Check if a reply from run() is a tool call rather than plain text.
   * @param {string} reply
   * @returns {boolean}
   */
  static isToolCall(reply) {
    try { const o = JSON.parse(reply); return Array.isArray(o?.__tool_calls__) } catch { return false }
  }

  /**
   * Parse tool calls from a run() reply.
   * @param {string} reply
   * @returns {Array<{ id: string, name: string, input: object }>}
   */
  static parseToolCalls(reply) {
    try { const o = JSON.parse(reply); return Array.isArray(o?.__tool_calls__) ? o.__tool_calls__ : [] } catch { return [] }
  }

  /**
   * Encode a tool result to send back to the sandbox via run().
   * @param {string} toolUseId - The id from the tool call
   * @param {string} toolName - The name from the tool call
   * @param {string} content - Result of your tool execution
   * @returns {string}
   */
  static encodeToolResult(toolUseId, toolName, content) {
    return '__TOOL_RESULT__:' + JSON.stringify({ toolUseId, toolName, content })
  }
}

// ── SandboxConnection (WebSocket) ─────────────────────────────────────────────

/**
 * Live WebSocket connection to a sandbox.
 * Supports tool call cycles: server emits tool_call events, client submits results.
 *
 * Protocol (JSON over WS):
 *   Client → Server: { type: 'message', content: string }
 *   Server → Client: { type: 'token', content: string }
 *   Server → Client: { type: 'tool_call', calls: [{id, name, input}] }
 *   Client → Server: { type: 'tool_result', results: [{toolUseId, toolName, content}] }
 *   Server → Client: { type: 'done', reply: string }
 *   Server → Client: { type: 'error', message: string }
 */
export class SandboxConnection {
  #ws
  #handlers = {}

  /** @param {WebSocket} ws */
  constructor(ws) {
    this.#ws = ws
    ws.addEventListener('message', ({ data }) => {
      let msg
      try { msg = JSON.parse(data) } catch { return }
      const h = this.#handlers
      if (msg.type === 'token'     && h.token)     h.token(msg.content)
      if (msg.type === 'tool_call' && h.toolCall)  h.toolCall(msg.calls)
      if (msg.type === 'done'      && h.done)       h.done(msg.reply)
      if (msg.type === 'error'     && h.error)      h.error(new VibeError(msg.message))
    })
    ws.addEventListener('error', () => {
      if (this.#handlers.error) this.#handlers.error(new VibeError('WebSocket error'))
    })
    ws.addEventListener('close', () => {
      if (this.#handlers.close) this.#handlers.close()
    })
  }

  /** Called with each streamed token. @param {(token: string) => void} fn */
  onToken(fn)    { this.#handlers.token = fn;    return this }
  /** Called when the model wants to call tools. @param {(calls: {id:string,name:string,input:object}[]) => void} fn */
  onToolCall(fn) { this.#handlers.toolCall = fn; return this }
  /** Called when the turn is complete. @param {(reply: string) => void} fn */
  onDone(fn)     { this.#handlers.done = fn;     return this }
  /** Called on error. @param {(err: VibeError) => void} fn */
  onError(fn)    { this.#handlers.error = fn;    return this }
  /** Called when the connection closes. @param {() => void} fn */
  onClose(fn)    { this.#handlers.close = fn;    return this }

  /** Send a message to start a conversation turn. @param {string} content */
  send(content) {
    this.#ws.send(JSON.stringify({ type: 'message', content }))
  }

  /**
   * Submit tool results after receiving a tool_call event.
   * @param {{ toolUseId: string, toolName: string, content: string }[]} results
   */
  submitToolResults(results) {
    this.#ws.send(JSON.stringify({ type: 'tool_result', results }))
  }

  /** @returns {'connecting'|'open'|'closing'|'closed'} */
  get readyState() {
    const states = ['connecting', 'open', 'closing', 'closed']
    return states[this.#ws.readyState] ?? 'closed'
  }

  /** Close the connection. */
  close() { this.#ws.close() }
}

// ── SandboxHandle ─────────────────────────────────────────────────────────────

export class SandboxHandle {
  /** @type {string} */ id
  /** @type {string} */ name
  /** @type {string} */ description
  /** @type {string} */ model
  /** @type {string} */ systemPrompt
  /** @type {number} */ temperature
  /** @type {number} */ maxTokens
  /** @type {string} */ appUrl
  /** @type {string} */ shortLink
  /** @type {string|null} */ integrityHash
  /** @type {boolean} */ tampered
  /** @type {'strict'|'audit'|'off'} */ guardMode
  /** @type {boolean} */ ragEnabled
  /** @type {object[]} */ tools
  /** @type {string|undefined} */ appHtml
  /** @type {string} */ #base

  /**
   * @param {string} base
   * @param {{ id: string, name: string, description?: string, model?: string, systemPrompt?: string, temperature?: number, maxTokens?: number, appUrl?: string, shortLink?: string, integrityHash?: string, tampered?: boolean, guardMode?: 'strict'|'audit'|'off', ragEnabled?: boolean, tools?: object[], appHtml?: string }} meta
   */
  constructor(base, meta) {
    this.#base         = base
    this.id            = meta.id
    this.name          = meta.name
    this.description   = meta.description   ?? ''
    this.model         = meta.model         ?? ''
    this.systemPrompt  = meta.systemPrompt  ?? ''
    this.temperature   = meta.temperature   ?? 0.7
    this.maxTokens     = meta.maxTokens     ?? 1024
    this.appUrl        = meta.appUrl        ?? `/app/${meta.id}`
    this.shortLink     = meta.shortLink     ?? `/s/${meta.id}`
    this.integrityHash = meta.integrityHash ?? null
    this.tampered      = meta.tampered      ?? false
    this.guardMode     = meta.guardMode     ?? 'strict'
    this.ragEnabled    = meta.ragEnabled    ?? false
    this.tools         = meta.tools         ?? []
    this.appHtml       = meta.appHtml
  }

  /**
   * Send a message and get a blocking reply (persists to conversation memory).
   * @param {string} message
   * @param {string} [sessionId] Named session — omit for default shared thread
   * @returns {Promise<string>}
   */
  async run(message, sessionId) {
    const data = /** @type {{ reply: string }} */ (
      await apiRequest(this.#base, `/api/sandbox/${this.id}/run`, 'POST', { message, sessionId })
    )
    return data.reply
  }

  /**
   * Send a message and stream the response token by token.
   * Memory is NOT updated — use run() if persistence is needed.
   * @param {string} message
   * @param {string} [sessionId]
   * @returns {AsyncGenerator<string>}
   */
  async * stream(message, sessionId) {
    const res = await fetch(`${this.#base}/api/sandbox/${this.id}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId }),
    })
    if (!res.ok || !res.body) throw new VibeError('Stream request failed', res.status)
    yield * parseSSEStream(res.body)
  }

  /**
   * Get full conversation history.
   * @param {string} [sessionId] Named session — omit for default shared thread
   * @returns {Promise<{ role: string, content: string, timestamp: number }[]>}
   */
  async history(sessionId) {
    const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
    return /** @type {any} */ (
      await apiRequest(this.#base, `/api/sandbox/${this.id}/history${qs}`, 'GET')
    )
  }

  /**
   * Open a WebSocket connection for bidirectional real-time conversation.
   * Enables tool call cycles where the server sends tool_call events and
   * the client submits results without needing a new HTTP request.
   * @param {string} [sessionId]
   * @returns {SandboxConnection}
   */
  connect(sessionId) {
    const wsBase = this.#base.replace(/^http/, 'ws') || (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host
    const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
    const ws = new WebSocket(`${wsBase}/api/sandbox/${this.id}/ws${qs}`)
    return new SandboxConnection(ws)
  }

  /**
   * Update sandbox configuration (name, systemPrompt, model, temperature, etc.).
   * @param {object} patch
   */
  async update(patch) {
    await apiRequest(this.#base, `/api/sandbox/${this.id}`, 'PATCH', patch)
  }

  /** Permanently delete this sandbox. */
  async delete() {
    await apiRequest(this.#base, `/api/sandbox/${this.id}`, 'DELETE')
  }

  /**
   * Export this sandbox's configuration as a portable object that can be
   * imported into any Whisper instance via SandboxClient.import().
   * @returns {Promise<{ version: 1, name: string, description: string, systemPrompt: string, tools: object[], model: string, temperature: number, maxTokens: number }>}
   */
  async export() {
    return /** @type {any} */ (
      await apiRequest(this.#base, `/api/sandbox/${this.id}/export`, 'GET')
    )
  }

  /**
   * Upload a document for RAG indexing.
   * @param {File} file
   * @returns {Promise<{ docId: string, name: string, size: number, status: string }>}
   */
  async uploadDocument(file) {
    const form = new FormData()
    form.append('file', file)
    return /** @type {any} */ (
      await apiRequest(this.#base, `/api/sandbox/${this.id}/documents`, 'POST', form)
    )
  }

  /**
   * List all documents uploaded to this sandbox.
   * @returns {Promise<{ docs: Array<{ docId: string, name: string, mimeType: string, size: number, uploadedAt: number, status: string }>, total: number }>}
   */
  async listDocuments() {
    return /** @type {any} */ (
      await apiRequest(this.#base, `/api/sandbox/${this.id}/documents`, 'GET')
    )
  }

  /**
   * Delete a document and its vector chunks.
   * @param {string} docId
   */
  async deleteDocument(docId) {
    await apiRequest(this.#base, `/api/sandbox/${this.id}/documents/${docId}`, 'DELETE')
  }

  /**
   * Get usage metrics for this sandbox.
   * @returns {Promise<{ totalRuns: number, totalTokensIn: number, totalTokensOut: number, avgLatencyMs: number, modelBreakdown: Array<{ model: string, runs: number, tokensIn: number, tokensOut: number }> }>}
   */
  async metrics() {
    return /** @type {any} */ (
      await apiRequest(this.#base, `/api/sandbox/${this.id}/metrics`, 'GET')
    )
  }
}

// ── SandboxClient ─────────────────────────────────────────────────────────────

export class SandboxClient {
  /** @param {string} baseUrl */
  constructor(baseUrl) { this._base = baseUrl }

  /**
   * List all registered sandboxes.
   * @returns {Promise<{ id: string, name: string, description: string, model: string, createdAt: number, fromVibe?: boolean }[]>}
   */
  async list() {
    const data = /** @type {{ apps: any[] }} */ (
      await apiRequest(this._base, '/api/sandbox', 'GET')
    )
    return data.apps
  }

  /**
   * Create a new sandbox.
   * @param {{ name: string, description: string, systemPrompt: string, tools?: object[], model: string, temperature: number, maxTokens: number }} opts
   * @returns {Promise<SandboxHandle>}
   */
  async create(opts) {
    const data = /** @type {{ id: string, name: string, appUrl: string, shortLink: string }} */ (
      await apiRequest(this._base, '/api/sandbox', 'POST', opts)
    )
    return new SandboxHandle(this._base, data)
  }

  /**
   * Load an existing sandbox by ID.
   * @param {string} id
   * @returns {Promise<SandboxHandle>}
   */
  async get(id) {
    const data = /** @type {{ id: string, name: string, description?: string, model?: string, systemPrompt?: string, temperature?: number, maxTokens?: number }} */ (
      await apiRequest(this._base, `/api/sandbox/${id}`, 'GET')
    )
    return new SandboxHandle(this._base, data)
  }

  /**
   * Delete a sandbox by ID.
   * @param {string} id
   */
  async delete(id) {
    await apiRequest(this._base, `/api/sandbox/${id}`, 'DELETE')
  }

  /**
   * Import a sandbox from a previously exported config object.
   * Creates a new sandbox on this instance with a fresh ID.
   * @param {{ version?: number, name: string, description?: string, systemPrompt: string, tools?: object[], model: string, temperature: number, maxTokens: number }} config
   * @returns {Promise<SandboxHandle>}
   */
  async import(config) {
    const data = /** @type {{ id: string, name: string, appUrl: string, shortLink: string }} */ (
      await apiRequest(this._base, '/api/sandbox/import', 'POST', config)
    )
    return new SandboxHandle(this._base, data)
  }
}

// ── VibeBuilderResult ─────────────────────────────────────────────────────────

/** Result of a quick sandbox creation via vibes.create(). */
export class VibeBuilderResult {
  /** @type {string} */ sandboxId
  /** @type {string} */ name
  /** @type {string} */ description
  /** @type {string} */ model
  /** @type {string} */ appUrl
  /** @type {string} */ shortLink
  /** @type {string} */ embedCode
  /** @type {{ run: string, stream: string }} */ shortApi
  /** @type {{ systemPrompt: string, temperature: number, maxTokens: number }} */ config
  /** @type {string} */ #base

  /**
   * @param {string} base
   * @param {object} data
   */
  constructor(base, data) {
    this.#base = base
    Object.assign(this, data)
  }

  /**
   * Return a SandboxHandle for this vibe's sandbox, ready for programmatic use.
   * @returns {SandboxHandle}
   */
  sandbox() {
    return new SandboxHandle(this.#base, {
      id:        this.sandboxId,
      name:      this.name,
      appUrl:    this.appUrl,
      shortLink: this.shortLink,
    })
  }
}

// ── VibesClient ───────────────────────────────────────────────────────────────

/** Quick AI-assistant creator (single sandbox + custom HTML). */
export class VibesClient {
  /** @param {string} baseUrl */
  constructor(baseUrl) { this._base = baseUrl }

  /**
   * List built-in starter templates.
   * @returns {Promise<{ id: string, name: string, tags: string[], description: string }[]>}
   */
  async templates() {
    const data = /** @type {{ templates: any[] }} */ (
      await apiRequest(this._base, '/api/vibes', 'GET')
    )
    return data.templates
  }

  /**
   * Generate a new vibe from a natural-language description.
   * AI picks the best config, creates a Durable Object sandbox, and returns a VibeResult.
   * @param {string} description - Plain-language description of what the AI app should do
   * @param {string} [name] - Optional name; AI generates one if omitted
   * @param {'app'|'environment'|'dashboard'} [mode] - 'app' for a chat app, 'environment' for an agentic workspace, 'dashboard' for a data dashboard
   * @returns {Promise<VibeBuilderResult>}
   */
  async create(description, name, mode) {
    const body = { description, name }
    if (mode) body.mode = mode
    const data = await apiRequest(this._base, '/api/vibes', 'POST', body)
    return new VibeBuilderResult(this._base, data)
  }
}

// ── AppStateHandle ────────────────────────────────────────────────────────────

/**
 * Persistent key-value store for a generated app build.
 * Data survives reloads — backed by a Durable Object per build.
 */
export class AppStateHandle {
  #base
  #buildId

  /** @param {string} base @param {string} buildId */
  constructor(base, buildId) {
    this.#base    = base
    this.#buildId = buildId
  }

  /** Get a value by key. Returns null if not found. @param {string} key */
  async get(key) {
    try {
      return /** @type {{value:string}} */ (
        await apiRequest(this.#base, `/api/app/${this.#buildId}/state/${encodeURIComponent(key)}`, 'GET')
      )
    } catch (e) {
      if (/** @type {any} */ (e).status === 404) return null
      throw e
    }
  }

  /**
   * Set a value.
   * @param {string} key
   * @param {string} value
   */
  async set(key, value) {
    await apiRequest(this.#base, `/api/app/${this.#buildId}/state/${encodeURIComponent(key)}`, 'PUT', { value: String(value) })
  }

  /** List all key-value pairs. @returns {Promise<{key:string,value:string}[]>} */
  async list() {
    const data = /** @type {{entries:{key:string,value:string}[]}} */ (
      await apiRequest(this.#base, `/api/app/${this.#buildId}/state`, 'GET')
    )
    return data.entries
  }

  /** Delete a key. @param {string} key */
  async delete(key) {
    await apiRequest(this.#base, `/api/app/${this.#buildId}/state/${encodeURIComponent(key)}`, 'DELETE')
  }

  /** Clear all key-value pairs. */
  async clear() {
    await apiRequest(this.#base, `/api/app/${this.#buildId}/state`, 'DELETE')
  }
}

// ── AppHandle ─────────────────────────────────────────────────────────────────

/**
 * Handle to a completed (or in-progress) app build.
 * Returned by AppBuilder.get() or AppBuilder.list().
 */
export class AppHandle {
  /** @type {string} */ id
  /** @type {string} */ name
  /** @type {'idle'|'blueprinting'|'generating'|'complete'|'error'} */ status
  /** @type {string|undefined} */ errorMessage
  /** @type {string[]} */ files
  /** @type {AppStateHandle} */ state
  /** @type {string} */ #base

  /**
   * @param {string} base
   * @param {object} data
   */
  constructor(base, data) {
    this.#base  = base
    Object.assign(this, data)
    this.files  = data.files ?? []
    this.state  = new AppStateHandle(base, data.id)
  }

  /** URL where the generated app is served. */
  get appUrl() { return `/build/${this.id}` }

  /** URL of the SVG metadata thumbnail for this build. */
  get thumbnailUrl() { return `${this.#base}/api/v2/build/${this.id}/thumbnail` }

  /**
   * Fetch the content of a generated file.
   * @param {string} filename
   * @returns {Promise<string>}
   */
  async getFile(filename) {
    const res = await fetch(`${this.#base}/api/v2/build/${this.id}/files/${encodeURIComponent(filename)}`)
    if (!res.ok) throw new VibeError(`File not found: ${filename}`, res.status)
    return res.text()
  }

  /**
   * Deploy this build to Cloudflare Pages.
   * Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID to be configured server-side.
   * @returns {Promise<{ deploymentUrl: string, deploymentId?: string, projectName: string }>}
   */
  async deploy() {
    return /** @type {any} */ (
      await apiRequest(this.#base, `/api/v2/build/${this.id}/deploy`, 'POST')
    )
  }

  /** Permanently delete this build and its R2 files. */
  async delete() {
    await apiRequest(this.#base, `/api/v2/build/${this.id}`, 'DELETE')
  }
}

// ── AppSession ────────────────────────────────────────────────────────────────

/**
 * WebSocket-driven build session. Streams real-time progress events
 * from blueprint generation through file-by-file code generation.
 *
 * Protocol (JSON over WS):
 *   Client → Server: { type: 'start', description, name?, sandboxId?, model? }
 *   Server → Client: { type: 'connected', buildId }
 *                    { type: 'blueprint_generating' }
 *                    { type: 'blueprint_chunk', text }
 *                    { type: 'blueprint_ready', blueprint }
 *                    { type: 'file_generating', filename, index, total }
 *                    { type: 'file_chunk', filename, text }
 *                    { type: 'file_complete', filename, bytes }
 *                    { type: 'build_complete', buildId, appUrl, files[], thumbnailUrl }
 *                    { type: 'error', message }
 */
export class AppSession {
  #base
  #description
  #opts
  #handlers = {}
  #ws = null
  #buildId = null
  #status = 'idle'
  #appUrl = null

  /**
   * @param {string} baseUrl
   * @param {string} description
   * @param {{ name?: string, sandboxId?: string, model?: string }} [opts]
   */
  constructor(baseUrl, description, opts = {}) {
    this.#base        = baseUrl
    this.#description = description
    this.#opts        = opts
  }

  // ── Fluent event handlers ──────────────────────────────────────────────────

  /** @param {() => void} fn */
  onBlueprintStart(fn)  { this.#handlers.blueprintStart  = fn; return this }
  /** @param {(text: string) => void} fn */
  onBlueprintChunk(fn)  { this.#handlers.blueprintChunk  = fn; return this }
  /** @param {(blueprint: object) => void} fn */
  onBlueprintReady(fn)  { this.#handlers.blueprintReady  = fn; return this }
  /** @param {(info: { filename: string, index: number, total: number }) => void} fn */
  onFileStart(fn)       { this.#handlers.fileStart        = fn; return this }
  /** @param {(info: { filename: string, text: string }) => void} fn */
  onFileChunk(fn)       { this.#handlers.fileChunk        = fn; return this }
  /** @param {(info: { filename: string, bytes: number }) => void} fn */
  onFileComplete(fn)    { this.#handlers.fileComplete     = fn; return this }
  /** @param {(result: { buildId: string, appUrl: string, files: string[] }) => void} fn */
  onComplete(fn)        { this.#handlers.complete         = fn; return this }
  /** @param {(err: VibeError) => void} fn */
  onError(fn)           { this.#handlers.error            = fn; return this }

  /** Start the build — creates the build record then opens a WebSocket. */
  async start() {
    // Create the build record via REST, then connect WS
    const data = /** @type {{ buildId: string, wsUrl: string }} */ (
      await apiRequest(this.#base, '/api/v2/build', 'POST', {
        description: this.#description,
        ...this.#opts,
      })
    )
    this.#buildId = data.buildId
    this.#status  = 'connecting'
    this.#appUrl  = `/build/${data.buildId}`

    const wsBase = this.#base.replace(/^http/, 'ws') ||
      (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host
    this.#ws = new WebSocket(`${wsBase}/api/v2/build/${data.buildId}/ws`)

    this.#ws.addEventListener('message', ({ data: raw }) => {
      let msg
      try { msg = JSON.parse(raw) } catch { return }
      const h = this.#handlers
      switch (msg.type) {
        case 'connected':          this.#status = 'blueprinting'; break
        case 'blueprint_generating': if (h.blueprintStart) h.blueprintStart(); break
        case 'blueprint_chunk':    if (h.blueprintChunk) h.blueprintChunk(msg.text); break
        case 'blueprint_ready':    if (h.blueprintReady) h.blueprintReady(msg.blueprint); break
        case 'file_generating':    this.#status = 'generating'; if (h.fileStart) h.fileStart({ filename: msg.filename, index: msg.index, total: msg.total }); break
        case 'file_chunk':         if (h.fileChunk) h.fileChunk({ filename: msg.filename, text: msg.text }); break
        case 'file_complete':      if (h.fileComplete) h.fileComplete({ filename: msg.filename, bytes: msg.bytes }); break
        case 'build_complete':     this.#status = 'complete'; this.#appUrl = msg.appUrl; if (h.complete) h.complete({ buildId: msg.buildId, appUrl: msg.appUrl, files: msg.files, thumbnailUrl: msg.thumbnailUrl }); break
        case 'error':              this.#status = 'error'; if (h.error) h.error(new VibeError(msg.message)); break
      }
    })

    this.#ws.addEventListener('open', () => {
      this.#ws.send(JSON.stringify({ type: 'start', description: this.#description, ...this.#opts }))
    })

    this.#ws.addEventListener('error', () => {
      if (this.#handlers.error) this.#handlers.error(new VibeError('WebSocket connection error'))
    })

    return this
  }

  /** Stop the build (closes WebSocket). */
  stop() {
    try { this.#ws?.send(JSON.stringify({ type: 'stop' })) } catch { /* ignore */ }
    this.#ws?.close()
  }

  /** @returns {string|null} Build ID once created. */
  get buildId() { return this.#buildId }

  /** @returns {'idle'|'connecting'|'blueprinting'|'generating'|'complete'|'error'} */
  get status()  { return this.#status }

  /** @returns {string|null} App URL once build is complete. */
  get appUrl()  { return this.#appUrl }
}

// ── AppBuilder ────────────────────────────────────────────────────────────────

/**
 * Client for the Whisper App Builder — generates multi-file web apps
 * from natural language descriptions, stored in R2 and served at /build/:id.
 *
 * Inspired by Cloudflare VibeSDK's PhasicClient.
 */
export class AppBuilder {
  /** @param {string} baseUrl */
  constructor(baseUrl) { this._base = baseUrl }

  /**
   * Create a new build session (lazy — call .start() to begin).
   * @param {string} description - Plain-language description of the app to build
   * @param {{ name?: string, sandboxId?: string, model?: string }} [opts]
   * @returns {AppSession}
   */
  session(description, opts = {}) {
    return new AppSession(this._base, description, opts)
  }

  /**
   * List all builds.
   * @returns {Promise<Array<{ id: string, name: string, description: string, model: string, createdAt: number }>>}
   */
  async list() {
    const data = await apiRequest(this._base, '/api/v2/build', 'GET')
    return /** @type {any} */ (data).builds ?? []
  }

  /**
   * Load an existing build by ID.
   * @param {string} buildId
   * @returns {Promise<AppHandle>}
   */
  async get(buildId) {
    const data = await apiRequest(this._base, `/api/v2/build/${buildId}`, 'GET')
    return new AppHandle(this._base, data)
  }

  /**
   * Delete a build and its generated files.
   * @param {string} buildId
   */
  async delete(buildId) {
    await apiRequest(this._base, `/api/v2/build/${buildId}`, 'DELETE')
  }
}

// ── WhisperClient ──────────────────────────────────────────────────────────

/**
 * Main entry point for the Whisper SDK.
 * Provides access to AI inference, sandbox management, quick vibe creation,
 * and the full multi-file App Builder.
 */
export class WhisperClient {
  /**
   * @param {string} [baseUrl] - Base URL of the Whisper Worker. Defaults to same origin ('').
   */
  constructor(baseUrl = '') {
    /** @type {AiClient} */      this.ai      = new AiClient(baseUrl)
    /** @type {SandboxClient} */ this.sandbox = new SandboxClient(baseUrl)
    /** @type {VibesClient} */   this.vibes   = new VibesClient(baseUrl)
    /** @type {AppBuilder} */    this.builder = new AppBuilder(baseUrl)
  }
}

// Backwards-compatibility alias — existing code using VibeClient continues to work.
export const VibeClient = WhisperClient

// ── <vibe-chat> Web Component ─────────────────────────────────────────────────

// ── Zero-dep markdown renderer (used by VibeChatElement) ─────────────────────

function _escMd(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
function _ilMd(s) {
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, t, u) => `<a href="${u}" rel="noopener noreferrer" target="_blank">${t}</a>`)
  return s
}
function _renderMd(text) {
  const lines = text.split('\n'), out = []; let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    if (raw.startsWith('```')) {
      const code = []; i++
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(_escMd(lines[i])); i++ }
      i++; out.push(`<pre><code>${code.join('\n')}</code></pre>`); continue
    }
    const hm = raw.match(/^(#{1,3})\s+(.+)/)
    if (hm) { out.push(`<h${hm[1].length}>${_ilMd(_escMd(hm[2]))}</h${hm[1].length}>`); i++; continue }
    if (raw.startsWith('> ')) { out.push(`<blockquote>${_ilMd(_escMd(raw.slice(2)))}</blockquote>`); i++; continue }
    if (raw.startsWith('- ') || raw.startsWith('* ')) {
      const it = []
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        it.push(`<li>${_ilMd(_escMd(lines[i].slice(2)))}</li>`); i++
      }
      out.push(`<ul>${it.join('')}</ul>`); continue
    }
    if (/^\d+\.\s/.test(raw)) {
      const it = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        const m = lines[i].match(/^\d+\.\s+(.+)/); it.push(`<li>${_ilMd(_escMd(m?.[1] ?? ''))}</li>`); i++
      }
      out.push(`<ol>${it.join('')}</ol>`); continue
    }
    if (raw.trim() === '') { out.push(''); i++; continue }
    out.push(`<p>${_ilMd(_escMd(raw))}</p>`); i++
  }
  return out.join('\n')
}

const _CSS = /* css */`
:host {
  display: block;
  min-height: 320px;
  height: 420px;
  max-height: 80dvh;
  --vibe-bg: #ffffff;
  --vibe-fg: #111827;
  --vibe-accent: #6366f1;
  --vibe-user-bg: #6366f1;
  --vibe-user-fg: #ffffff;
  --vibe-bot-bg: #f3f4f6;
  --vibe-border: #e5e7eb;
  --vibe-radius: 12px;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
:host([theme="dark"]) {
  --vibe-bg: #0f172a;
  --vibe-fg: #e2e8f0;
  --vibe-accent: #818cf8;
  --vibe-user-bg: #4f46e5;
  --vibe-user-fg: #ffffff;
  --vibe-bot-bg: #1e293b;
  --vibe-border: #334155;
}
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--vibe-bg);
  color: var(--vibe-fg);
  border: 1px solid var(--vibe-border);
  border-radius: var(--vibe-radius);
  overflow: hidden;
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  scroll-behavior: smooth;
}
.msg {
  max-width: 82%;
  padding: 9px 14px;
  border-radius: 14px;
  white-space: pre-wrap;
  word-break: break-word;
  animation: fadein .15s ease;
}
@keyframes fadein { from { opacity: 0; transform: translateY(4px); } }
.msg.user {
  align-self: flex-end;
  background: var(--vibe-user-bg);
  color: var(--vibe-user-fg);
  border-bottom-right-radius: 4px;
}
.msg.bot {
  align-self: flex-start;
  background: var(--vibe-bot-bg);
  border-bottom-left-radius: 4px;
}
.msg.error {
  align-self: flex-start;
  background: #fee2e2;
  color: #dc2626;
}
.input-row {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--vibe-border);
  background: var(--vibe-bg);
}
textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--vibe-border);
  border-radius: 8px;
  padding: 7px 11px;
  font: inherit;
  background: var(--vibe-bg);
  color: var(--vibe-fg);
  outline: none;
  min-height: 36px;
  max-height: 120px;
  overflow-y: auto;
  field-sizing: content;
  transition: border-color 0.15s;
}
textarea:focus { border-color: var(--vibe-accent); }
button {
  background: var(--vibe-accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 7px 16px;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  flex-shrink: 0;
}
button { transition: opacity 0.15s, background 0.15s; }
button:disabled { opacity: .45; cursor: not-allowed; }
button:focus-visible, textarea:focus-visible { outline: 2px solid var(--vibe-accent); outline-offset: 2px; }
@keyframes blink { 0%, 80%, 100% { opacity: 0; } 40% { opacity: 1; } }
.typing-dots { display: inline-flex; gap: 4px; padding: 4px 0; align-items: center; }
.typing-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0; animation: blink 1.2s infinite; }
.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }
`

class VibeChatElement extends HTMLElement {
  static get observedAttributes() {
    return ['sandbox-id', 'base-url', 'placeholder', 'theme']
  }

  _shadow = null
  _handle = null
  _busy   = false

  connectedCallback() {
    this._shadow = this.attachShadow({ mode: 'open' })
    this._paint()
    this._load()
  }

  attributeChangedCallback(name) {
    if (!this._shadow) return
    this._paint()
    if (name === 'sandbox-id' || name === 'base-url') {
      this._handle = null
      this._load()
    }
  }

  _paint() {
    const rawPh = this.getAttribute('placeholder') ?? 'Type a message…'
    // Escape for safe injection into an HTML attribute value
    const ph = rawPh.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    this._shadow.innerHTML = `<style>${_CSS}</style>
<div class="shell">
  <div class="messages" part="messages" role="log" aria-live="polite" aria-label="Chat messages"></div>
  <div class="input-row">
    <textarea part="input" placeholder="${ph}" rows="1" aria-label="Type a message (Enter to send, Shift+Enter for new line)"></textarea>
    <button part="send" type="button" aria-label="Send message">Send</button>
  </div>
</div>`
    this._shadow.querySelector('button').addEventListener('click', () => this._send())
    this._shadow.querySelector('textarea').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._send() }
    })
  }

  async _load() {
    const id      = this.getAttribute('sandbox-id')
    const baseUrl = this.getAttribute('base-url') ?? ''
    if (!id) return
    try {
      this._handle = await new WhisperClient(baseUrl).sandbox.get(id)
    } catch (e) {
      this._msg('error', `Could not load sandbox: ${e.message}`)
    }
  }

  async _send() {
    if (this._busy || !this._handle) return
    const ta  = this._shadow.querySelector('textarea')
    const btn = this._shadow.querySelector('button')
    const text = ta.value.trim()
    if (!text) return

    ta.value = ''
    this._busy = true
    btn.disabled = true
    btn.setAttribute('aria-busy', 'true')

    this._msg('user', text)
    const botEl = this._msg('bot', '')
    botEl.innerHTML = '<span class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>'

    try {
      let buf = ''
      let firstToken = true
      for await (const token of this._handle.stream(text)) {
        if (firstToken) { botEl.innerHTML = ''; firstToken = false }
        buf += token
        botEl.innerHTML = _renderMd(buf)
        this._scroll()
      }
    } catch (e) {
      botEl.className = 'msg error'
      botEl.textContent = `Error: ${e.message}`
    } finally {
      this._busy = false
      btn.disabled = false
      btn.removeAttribute('aria-busy')
      ta.focus()
    }
  }

  /** @param {'user'|'bot'|'error'} type @param {string} text @returns {HTMLElement} */
  _msg(type, text) {
    const msgs = this._shadow.querySelector('.messages')
    const el   = document.createElement('div')
    el.className = `msg ${type}`
    el.textContent = text
    msgs.appendChild(el)
    this._scroll()
    return el
  }

  _scroll() {
    const msgs = this._shadow.querySelector('.messages')
    if (msgs) msgs.scrollTop = msgs.scrollHeight
  }
}

customElements.define('vibe-chat', VibeChatElement)

// <whisper-chat> — canonical name for the Whisper web component
class WhisperChatElement extends VibeChatElement {}
customElements.define('whisper-chat', WhisperChatElement)
