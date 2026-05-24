/**
 * vibeSDK — zero-dependency client for Project Aether-Lite
 *
 * Usage (ES module):
 *   import { VibeClient } from '/vibe-sdk.js'
 *   const client = new VibeClient()
 *
 * Usage (web component):
 *   <script type="module" src="/vibe-sdk.js"></script>
 *   <vibe-chat sandbox-id="abc123"></vibe-chat>
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
}

// ── SandboxHandle ─────────────────────────────────────────────────────────────

export class SandboxHandle {
  /** @type {string} */ id
  /** @type {string} */ name
  /** @type {string} */ description
  /** @type {string} */ model
  /** @type {string} */ appUrl
  /** @type {string} */ shortLink
  /** @type {string} */ #base

  /**
   * @param {string} base
   * @param {{ id: string, name: string, description?: string, model?: string, appUrl?: string, shortLink?: string }} meta
   */
  constructor(base, meta) {
    this.#base       = base
    this.id          = meta.id
    this.name        = meta.name
    this.description = meta.description ?? ''
    this.model       = meta.model       ?? ''
    this.appUrl      = meta.appUrl      ?? `/app/${meta.id}`
    this.shortLink   = meta.shortLink   ?? `/s/${meta.id}`
  }

  /**
   * Send a message and get a blocking reply (persists to conversation memory).
   * @param {string} message
   * @returns {Promise<string>}
   */
  async run(message) {
    const data = /** @type {{ reply: string }} */ (
      await apiRequest(this.#base, `/api/sandbox/${this.id}/run`, 'POST', { message })
    )
    return data.reply
  }

  /**
   * Send a message and stream the response token by token.
   * Memory is NOT updated — use run() if persistence is needed.
   * @param {string} message
   * @returns {AsyncGenerator<string>}
   */
  async * stream(message) {
    const res = await fetch(`${this.#base}/api/sandbox/${this.id}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    if (!res.ok || !res.body) throw new VibeError('Stream request failed', res.status)
    yield * parseSSEStream(res.body)
  }

  /**
   * Get full conversation history.
   * @returns {Promise<{ role: string, content: string, timestamp: number }[]>}
   */
  async history() {
    return /** @type {any} */ (
      await apiRequest(this.#base, `/api/sandbox/${this.id}/history`, 'GET')
    )
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
    const data = /** @type {{ id: string, name: string, description?: string, model?: string }} */ (
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
}

// ── VibeResult ────────────────────────────────────────────────────────────────

export class VibeResult {
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
   * @returns {Promise<VibeResult>}
   */
  async create(description, name) {
    const data = await apiRequest(this._base, '/api/vibes', 'POST', { description, name })
    return new VibeResult(this._base, data)
  }
}

// ── VibeClient ────────────────────────────────────────────────────────────────

export class VibeClient {
  /**
   * Create a new client.
   * @param {string} [baseUrl] - Base URL of the Aether-Lite Worker. Defaults to same origin ('').
   */
  constructor(baseUrl = '') {
    /** @type {AiClient} */      this.ai      = new AiClient(baseUrl)
    /** @type {SandboxClient} */ this.sandbox = new SandboxClient(baseUrl)
    /** @type {VibesClient} */   this.vibes   = new VibesClient(baseUrl)
  }
}

// ── <vibe-chat> Web Component ─────────────────────────────────────────────────

const _CSS = /* css */`
:host {
  display: block;
  height: 420px;
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
button:disabled { opacity: .45; cursor: not-allowed; }
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
    const ph = this.getAttribute('placeholder') ?? 'Type a message…'
    this._shadow.innerHTML = `<style>${_CSS}</style>
<div class="shell">
  <div class="messages" part="messages"></div>
  <div class="input-row">
    <textarea part="input" placeholder="${ph}" rows="1"></textarea>
    <button part="send" type="button">Send</button>
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
      this._handle = await new VibeClient(baseUrl).sandbox.get(id)
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

    this._msg('user', text)
    const botEl = this._msg('bot', '')

    try {
      for await (const token of this._handle.stream(text)) {
        botEl.textContent += token
        this._scroll()
      }
    } catch (e) {
      botEl.className = 'msg error'
      botEl.textContent = `Error: ${e.message}`
    } finally {
      this._busy = false
      btn.disabled = false
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
