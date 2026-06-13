import type { Handler, Params } from '../../lib/http'
import type { SandboxConfig } from '../../lib/schema'
import { sandboxExists, stub, doFetch } from '../../lib/do'
import { genNonce, htmlHeaders, injectAppToken, sharedCss, navHtml } from './shared'

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
#app-name{font-size:13px;font-weight:600;color:var(--accent2);margin-left:auto}
#app-desc{display:none}
.badge{font-size:10px;padding:2px 8px;border-radius:99px;background:#6366f122;color:var(--accent2);font-family:var(--mono);flex-shrink:0}
.hbtn{font-size:12px;padding:8px 14px;min-height:36px;border-radius:var(--radius);background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer;flex-shrink:0;transition:all .15s}
.hbtn:hover{border-color:var(--accent2);color:var(--accent2)}
.hbtn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
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
.input-row textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.input-row button{padding:10px 18px;min-height:40px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s}
.input-row button:hover:not(:disabled){background:#4f46e5}
.input-row button:disabled{opacity:.45;cursor:not-allowed}
.input-row button:focus-visible{outline:2px solid var(--accent2);outline-offset:2px}
@media(max-width:600px){#messages{padding:12px}.input-row{padding:8px 12px}.input-row textarea{font-size:16px}}
.embed-panel{position:fixed;inset:0;background:#00000088;z-index:100;display:flex;align-items:center;justify-content:center;visibility:hidden;opacity:0;transition:opacity .2s,visibility .2s}
.embed-panel.open{visibility:visible;opacity:1}
.embed-box{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;width:480px;max-width:90vw;display:flex;flex-direction:column;gap:12px;transform:translateY(10px);transition:transform .2s}
.embed-panel.open .embed-box{transform:translateY(0)}
.embed-box h3{font-size:14px;color:var(--accent2)}
.embed-box textarea{width:100%;height:80px;padding:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-family:var(--mono);font-size:12px;resize:none}
.embed-box .row{display:flex;gap:8px}
.embed-box button{flex:1;padding:8px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:13px;cursor:pointer}
.embed-box button.outline{background:none;border:1px solid var(--border);color:var(--text)}
</style>
</head>
<body>
${navHtml('apps', '  <span id="app-name" style="margin-left:auto">Loading…</span>\n  <span id="app-desc" style="display:none"></span>\n  <span id="model-badge" class="badge" style="display:none"></span>\n  <button class="hbtn" id="embed-btn" aria-haspopup="dialog">Embed ↗</button>\n  <button class="hbtn" id="share-btn">Share config</button>')}
<div id="messages" role="log" aria-live="polite" aria-label="Conversation messages">
  <div class="msg system" id="init-msg">Connecting…</div>
</div>
<div class="input-row">
  <textarea id="user-input" placeholder="Type a message… (Enter to send)" rows="2" disabled aria-label="Message input (Enter to send, Shift+Enter for new line)"></textarea>
  <button id="send-btn" disabled aria-label="Send message">Send</button>
</div>
<div id="embed-panel" class="embed-panel" role="presentation">
  <div class="embed-box" role="dialog" aria-modal="true" aria-labelledby="embed-title">
    <h3 id="embed-title">Embed this app</h3>
    <textarea id="embed-code" readonly aria-label="Embed code (read-only)"></textarea>
    <div class="row">
      <button id="embed-copy-btn">Copy code</button>
      <button class="outline" id="embed-close-btn">Close</button>
    </div>
  </div>
</div>

<script type="module" nonce="${nonce}" src="/md.js"></script>
<script nonce="${nonce}">
// Markdown rendering is provided by /md.js as window.renderMd (mirrors src/lib/markdown.ts).
const SANDBOX_ID = ${id}
const API = ''

async function init() {
  try {
    const r = await fetch(API + '/api/sandbox/' + SANDBOX_ID)
    const d = await r.json()
    if (!d.ok) { setMsg('error', d.error); return }
    const app = d.data
    document.title = app.name
    document.getElementById('app-name').textContent = app.name
    document.getElementById('app-desc').textContent = app.description || ''
    const badge = document.getElementById('model-badge')
    badge.textContent = app.model.split('/').pop()
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

function openEmbed() {
  document.getElementById('embed-panel').classList.add('open')
  document.getElementById('embed-close-btn').focus()
}
function closeEmbed() {
  document.getElementById('embed-panel').classList.remove('open')
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeEmbed() })

function copyEmbed() {
  const t = document.getElementById('embed-code').value
  navigator.clipboard?.writeText(t).catch(() => {})
  const btn = event.target
  btn.textContent = 'Copied!'
  setTimeout(() => { btn.textContent = 'Copy code' }, 1500)
}

async function shareConfig(btn) {
  const prev = btn.textContent
  try {
    const r = await fetch(API + '/api/sandbox/' + SANDBOX_ID + '/export')
    const d = await r.json()
    if (!d.ok) return
    await navigator.clipboard?.writeText(JSON.stringify(d.data, null, 2)).catch(() => {})
    btn.textContent = 'Copied!'
    setTimeout(() => { btn.textContent = prev }, 1500)
  } catch {}
}

document.getElementById('send-btn').addEventListener('click', send)
document.getElementById('user-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
})
document.getElementById('embed-btn').addEventListener('click', openEmbed)
document.getElementById('share-btn').addEventListener('click', () => shareConfig(document.getElementById('share-btn')))
document.getElementById('embed-panel').addEventListener('click', e => { if (e.target === document.getElementById('embed-panel')) closeEmbed() })
document.getElementById('embed-copy-btn').addEventListener('click', copyEmbed)
document.getElementById('embed-close-btn').addEventListener('click', closeEmbed)

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
          // Custom app HTML uses 'self' + unsafe-inline; app pages allow framing
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
