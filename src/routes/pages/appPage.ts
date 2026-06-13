import type { Handler, Params } from '../../lib/http'
import type { SandboxConfig } from '../../lib/schema'
import { sandboxExists, stub, doFetch } from '../../lib/do'
import { genNonce, htmlHeaders, injectAppToken, sharedCss, navHtml, modalCss, modalJs } from './shared'

// ── Standalone app page ───────────────────────────────────────────────────────

export function appPageHtml(sandboxId: string, nonce: string): string {
  const id = JSON.stringify(sandboxId)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\//g, '\\u002f')
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Loading…</title>
${sharedCss()}
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.ws-header{display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0;flex-wrap:wrap}
.ws-name{font-size:13px;font-weight:600;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-actions{display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap}
#messages{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:80%;padding:10px 14px;border-radius:var(--radius);font-size:13.5px;line-height:1.55;animation:msgIn .15s ease-out both}
.msg.user{align-self:flex-end;background:#6366f128;border:1px solid #6366f144}
.msg.assistant{align-self:flex-start;background:var(--surface);border:1px solid var(--border)}
.msg.system{align-self:center;color:var(--muted);font-size:12px;font-style:italic}
.msg.error{align-self:center;color:#f87171;font-size:12px}
.msg.assistant code{background:#ffffff10;padding:2px 5px;border-radius:4px;font-family:var(--mono);font-size:.88em}
.msg.assistant pre{background:#ffffff0d;padding:10px 12px;border-radius:6px;overflow-x:auto;margin:6px 0}
.msg.assistant pre code{background:none;padding:0}
.msg.assistant h1{font-size:1.1em;font-weight:700;margin:10px 0 4px}
.msg.assistant h2{font-size:1.05em;font-weight:600;margin:8px 0 3px}
.msg.assistant h3{font-size:1em;font-weight:600;margin:6px 0 3px}
.msg.assistant ul,.msg.assistant ol{padding-left:20px;margin:4px 0}
.msg.assistant li{margin:2px 0}
.msg.assistant blockquote{border-left:3px solid var(--border);padding-left:10px;color:var(--muted);margin:4px 0}
.msg.assistant p{margin:4px 0}
.msg.assistant a{color:var(--accent2);text-decoration:underline;text-underline-offset:2px}
.typing{opacity:.5}
.input-row{display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--border);flex-shrink:0}
.input-row textarea{flex:1;resize:none;padding:8px 10px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-size:13px;font-family:inherit;outline:none;transition:border-color .15s}
.input-row textarea:focus{border-color:var(--accent)}
.input-row button{padding:10px 18px;min-height:40px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s}
.input-row button:hover:not(:disabled){background:#4f46e5}
.input-row button:disabled{opacity:.45;cursor:not-allowed}
.modal-code{width:100%;height:80px;padding:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-family:var(--mono);font-size:12px;resize:none}
${modalCss()}
</style>
</head>
<body>
${navHtml('apps')}
<div class="ws-header">
  <span class="ws-name" id="app-name">Loading…</span>
  <span id="model-badge" class="badge" style="display:none"></span>
  <div class="ws-actions">
    <button class="act-btn" id="fork-btn" title="Create a copy of this app">Fork</button>
    <button class="act-btn" id="metrics-btn" title="View usage metrics">Metrics</button>
    <button class="act-btn" id="edit-btn" title="Edit app configuration">Edit</button>
    <button class="act-btn" id="export-btn" title="Export conversation as JSONL">Export ↓</button>
    <button class="act-btn" id="embed-btn" title="Get embed code">Embed ↗</button>
    <button class="act-btn act-del" id="delete-btn" title="Delete this app">Delete</button>
  </div>
</div>
<div id="messages" role="log" aria-live="polite" aria-label="Conversation messages">
  <div class="msg system" id="init-msg">Connecting…</div>
</div>
<div class="input-row">
  <textarea id="user-input" placeholder="Type a message… (Enter to send)" rows="2" disabled aria-label="Message input (Enter to send, Shift+Enter for new line)"></textarea>
  <button id="send-btn" disabled aria-label="Send message">Send</button>
</div>

<!-- Embed modal -->
<div id="embed-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="embed-title">
  <div class="modal-box">
    <div class="modal-title" id="embed-title">Embed this app</div>
    <textarea class="modal-code" id="embed-code" readonly aria-label="Embed code (read-only)"></textarea>
    <div class="modal-row">
      <button id="embed-copy-btn">Copy code</button>
      <button class="outline" onclick="closeModal('embed-modal')">Close</button>
    </div>
  </div>
</div>

<!-- Metrics modal -->
<div id="metrics-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="metrics-title">
  <div class="modal-box">
    <div class="modal-title" id="metrics-title">Usage Metrics</div>
    <div id="metrics-body"><div style="color:var(--muted);font-size:12px">Loading…</div></div>
    <div class="modal-row">
      <button class="outline" onclick="closeModal('metrics-modal')">Close</button>
    </div>
  </div>
</div>

<!-- Edit modal -->
<div id="edit-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-title">
  <div class="modal-box" style="width:520px">
    <div class="modal-title" id="edit-title">Edit App</div>
    <div class="form-group">
      <label class="form-label" for="edit-name">Name</label>
      <input class="form-input" id="edit-name" type="text" maxlength="128"/>
    </div>
    <div class="form-group">
      <label class="form-label" for="edit-desc">Description</label>
      <input class="form-input" id="edit-desc" type="text" maxlength="512"/>
    </div>
    <div class="form-group">
      <label class="form-label" for="edit-prompt">System Prompt</label>
      <textarea class="form-input form-textarea" id="edit-prompt" maxlength="16384"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label" for="edit-model">Model</label>
      <input class="form-input" id="edit-model" type="text" maxlength="128"/>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group">
        <label class="form-label" for="edit-temp">Temperature</label>
        <input class="form-input" id="edit-temp" type="number" min="0" max="2" step="0.1"/>
      </div>
      <div class="form-group">
        <label class="form-label" for="edit-maxtok">Max Tokens</label>
        <input class="form-input" id="edit-maxtok" type="number" min="64" max="16384"/>
      </div>
    </div>
    <div id="edit-status" style="font-size:12px;color:var(--muted);min-height:16px"></div>
    <div class="modal-row">
      <button id="edit-save-btn">Save Changes</button>
      <button class="outline" onclick="closeModal('edit-modal')">Cancel</button>
    </div>
  </div>
</div>

<!-- Delete confirm modal -->
<div id="delete-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-title">
  <div class="modal-box">
    <div class="modal-title" id="delete-title">Delete App?</div>
    <p style="font-size:13px;color:var(--muted)">This permanently deletes the app and all its conversation history. This action cannot be undone.</p>
    <div class="modal-row">
      <button class="danger" id="delete-confirm-btn">Yes, delete</button>
      <button class="outline" onclick="closeModal('delete-modal')">Cancel</button>
    </div>
  </div>
</div>

<script type="module" nonce="${nonce}" src="/md.js"></script>
<script nonce="${nonce}">
const SANDBOX_ID = ${id}
const API = ''
${modalJs}

async function init() {
  try {
    const r = await fetch(API + '/api/sandbox/' + SANDBOX_ID)
    const d = await r.json()
    if (!d.ok) { setMsg('error', d.error); return }
    const app = d.data
    document.title = app.name
    document.getElementById('app-name').textContent = app.name
    const badge = document.getElementById('model-badge')
    badge.textContent = (app.model || '').split('/').pop() || app.model
    badge.style.display = ''
    document.getElementById('embed-code').value =
      '<iframe src="' + location.origin + '/app/' + SANDBOX_ID + '" width="420" height="640" frameborder="0" allow="microphone" sandbox="allow-scripts allow-forms allow-same-origin allow-popups"></iframe>'
    setMsg('system', 'Hi! I am ' + app.name + (app.description ? ' — ' + app.description : '') + '. How can I help?')
    document.getElementById('user-input').disabled = false
    document.getElementById('send-btn').disabled = false
    document.getElementById('user-input').focus()
  } catch(e) { setMsg('error', 'Failed to load app: ' + e) }
}

function setMsg(role, text) {
  const el = document.getElementById('init-msg')
  if (el) { el.className = 'msg ' + role; el.textContent = text }
}
function addMsg(role, text) {
  const el = document.createElement('div')
  el.className = 'msg ' + role
  el.textContent = text
  document.getElementById('messages').appendChild(el)
  scroll()
  return el
}
function scroll() {
  const m = document.getElementById('messages')
  m.scrollTop = m.scrollHeight
}

async function send() {
  const input = document.getElementById('user-input')
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  document.getElementById('send-btn').disabled = true
  addMsg('user', text)
  const el = addMsg('assistant', '')
  el.classList.add('typing')
  try {
    const res = await fetch(API + '/s/' + SANDBOX_ID + '/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    })
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\\n\\n')
      buf = parts.pop() ?? ''
      for (const part of parts) {
        for (const line of part.split('\\n')) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if (raw === '[DONE]') continue
          try {
            const ev = JSON.parse(raw)
            if (ev.done) continue
            if (ev.error) { el.textContent += ' [Error: ' + ev.error + ']'; break }
            if (typeof ev.response === 'string') {
              el._buf = (el._buf || '') + ev.response
              el.innerHTML = window.renderMd(el._buf)
              el.classList.remove('typing')
              scroll()
            }
          } catch {}
        }
      }
    }
    if (!el.textContent) el.textContent = '(no response)'
  } catch(e) {
    el.textContent = 'Error: ' + e
    el.className = 'msg error'
  } finally {
    document.getElementById('send-btn').disabled = false
    input.focus()
  }
}

async function doFork() {
  const btn = document.getElementById('fork-btn')
  btn.disabled = true
  btn.textContent = 'Forking…'
  try {
    const r = await fetch(API + '/api/sandbox/' + SANDBOX_ID + '/fork', { method: 'POST' })
    const d = await r.json()
    if (!d.ok) throw new Error(d.error || 'Fork failed')
    window.location.href = d.data.appUrl
  } catch(e) {
    alert('Fork failed: ' + String(e))
    btn.disabled = false
    btn.textContent = 'Fork'
  }
}

async function showMetrics() {
  openModal('metrics-modal')
  const body = document.getElementById('metrics-body')
  body.innerHTML = '<div style="color:var(--muted);font-size:12px">Loading…</div>'
  try {
    const r = await fetch(API + '/api/sandbox/' + SANDBOX_ID + '/metrics')
    const d = await r.json()
    if (!d.ok) throw new Error(d.error)
    const m = d.data
    body.innerHTML = [
      ['Total Runs',      m.totalRuns ?? 0],
      ['Tokens In',       (m.totalTokensIn ?? 0).toLocaleString()],
      ['Tokens Out',      (m.totalTokensOut ?? 0).toLocaleString()],
      ['Avg Latency',     Math.round(m.avgLatencyMs ?? 0) + ' ms'],
    ].map(function(row){ return '<div class="stat-row"><span>'+row[0]+'</span><span class="stat-val">'+row[1]+'</span></div>' }).join('')
    if (m.modelBreakdown && m.modelBreakdown.length) {
      body.innerHTML += '<div style="font-size:11px;color:var(--muted);margin-top:10px;text-transform:uppercase;letter-spacing:.04em">By Model</div>'
      m.modelBreakdown.forEach(function(b){ body.innerHTML += '<div class="stat-row"><span style="font-size:11px;font-family:var(--mono);color:var(--muted)">'+(b.model||'').split('/').pop()+'</span><span class="stat-val">'+b.runs+' runs</span></div>' })
    }
  } catch(e) {
    body.innerHTML = '<div style="color:var(--red);font-size:12px">Failed to load metrics: '+String(e)+'</div>'
  }
}

async function showEdit() {
  try {
    const r = await fetch(API + '/api/sandbox/' + SANDBOX_ID)
    const d = await r.json()
    if (!d.ok) return
    const a = d.data
    document.getElementById('edit-name').value    = a.name || ''
    document.getElementById('edit-desc').value    = a.description || ''
    document.getElementById('edit-model').value   = a.model || ''
    document.getElementById('edit-temp').value    = String(a.temperature ?? 0.7)
    document.getElementById('edit-maxtok').value  = String(a.maxTokens ?? 1024)
    document.getElementById('edit-prompt').value  = ''
    document.getElementById('edit-status').textContent = 'System prompt is not displayed for security. Enter a new value only if you want to change it.'
  } catch {}
  openModal('edit-modal')
}

async function doEdit() {
  const btn = document.getElementById('edit-save-btn')
  const status = document.getElementById('edit-status')
  btn.disabled = true
  btn.textContent = 'Saving…'
  const patch = {}
  const name = document.getElementById('edit-name').value.trim()
  const desc = document.getElementById('edit-desc').value.trim()
  const model = document.getElementById('edit-model').value.trim()
  const temp = parseFloat(document.getElementById('edit-temp').value)
  const maxtok = parseInt(document.getElementById('edit-maxtok').value)
  const prompt = document.getElementById('edit-prompt').value.trim()
  if (name)   patch.name        = name
  if (desc)   patch.description = desc
  if (model)  patch.model       = model
  if (!isNaN(temp))   patch.temperature = temp
  if (!isNaN(maxtok)) patch.maxTokens   = maxtok
  if (prompt) patch.systemPrompt = prompt
  try {
    const r = await fetch(API + '/api/sandbox/' + SANDBOX_ID, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const d = await r.json()
    if (!d.ok) throw new Error(d.error || 'Save failed')
    status.textContent = 'Saved.'
    status.style.color = 'var(--green)'
    if (name) { document.title = name; document.getElementById('app-name').textContent = name }
    if (model) document.getElementById('model-badge').textContent = model.split('/').pop() || model
    setTimeout(function(){ closeModal('edit-modal') }, 800)
  } catch(e) {
    status.textContent = 'Error: ' + String(e)
    status.style.color = 'var(--red)'
  } finally {
    btn.disabled = false
    btn.textContent = 'Save Changes'
  }
}

async function doExportSession() {
  const btn = document.getElementById('export-btn')
  btn.disabled = true
  btn.textContent = 'Exporting…'
  try {
    const r = await fetch(API + '/api/sandbox/' + SANDBOX_ID + '/export-session')
    const d = await r.json()
    if (!d.ok) throw new Error(d.error || 'Export failed')
    const blob = new Blob([JSON.stringify(d.data, null, 2)], {type:'application/json'})
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = 'session-' + SANDBOX_ID.slice(0,8) + '.json'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch(e) {
    alert('Export failed: ' + String(e))
  } finally {
    btn.disabled = false
    btn.textContent = 'Export ↓'
  }
}

function confirmDelete() { openModal('delete-modal') }

async function doDelete() {
  const btn = document.getElementById('delete-confirm-btn')
  btn.disabled = true
  btn.textContent = 'Deleting…'
  try {
    const r = await fetch(API + '/api/sandbox/' + SANDBOX_ID, { method: 'DELETE' })
    const d = await r.json()
    if (!d.ok) throw new Error(d.error || 'Delete failed')
    window.location.href = '/apps'
  } catch(e) {
    alert('Delete failed: ' + String(e))
    btn.disabled = false
    btn.textContent = 'Yes, delete'
  }
}

function copyEmbed() {
  const t = document.getElementById('embed-code').value
  navigator.clipboard?.writeText(t).catch(function(){})
  const btn = document.getElementById('embed-copy-btn')
  btn.textContent = 'Copied!'
  setTimeout(function(){ btn.textContent = 'Copy code' }, 1500)
}

document.getElementById('send-btn').addEventListener('click', send)
document.getElementById('user-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
})
document.getElementById('fork-btn').addEventListener('click', doFork)
document.getElementById('metrics-btn').addEventListener('click', showMetrics)
document.getElementById('edit-btn').addEventListener('click', showEdit)
document.getElementById('export-btn').addEventListener('click', doExportSession)
document.getElementById('embed-btn').addEventListener('click', function(){ openModal('embed-modal') })
document.getElementById('delete-btn').addEventListener('click', confirmDelete)
document.getElementById('embed-copy-btn').addEventListener('click', copyEmbed)
document.getElementById('edit-save-btn').addEventListener('click', doEdit)
document.getElementById('delete-confirm-btn').addEventListener('click', doDelete)
document.querySelectorAll('.modal-overlay').forEach(function(m){
  m.addEventListener('click', function(e){ if(e.target===m) m.classList.remove('open') })
})

init()
</script>
</body>
</html>`
}

export const appPage: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await sandboxExists(env, id)) {
    const nonce = genNonce()
    return new Response('<h1>App not found</h1>', { status: 404, headers: htmlHeaders(nonce) })
  }

  // Serve custom Vibe Builder HTML if present, otherwise fall back to generic chat page
  try {
    const res = await doFetch(stub(env, id), 'config', 'GET')
    const cfg = await res.json() as { ok: boolean; data: Omit<SandboxConfig, 'memory'> }
    if (cfg.ok && cfg.data.appHtml) {
      let html = cfg.data.appHtml.replace(/__SANDBOX_ID__/g, JSON.stringify(id).slice(1, -1))
      html = await injectAppToken(html, id, env)
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin',
          'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:",
        },
      })
    }
  } catch { /* fall through to generic page */ }

  const nonce = genNonce()
  let html = appPageHtml(id, nonce)
  html = await injectAppToken(html, id, env)
  return new Response(html, { headers: htmlHeaders(nonce, true) })
}
