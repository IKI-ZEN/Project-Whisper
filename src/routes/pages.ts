import type { Env } from '../types/env'
import type { Handler, Params } from '../lib/http'
import { json, err } from '../lib/http'
import { sandboxExists } from './sandbox'

// ── Standalone app page ───────────────────────────────────────────────────────

function appPageHtml(sandboxId: string): string {
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
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0c0c0f;--surface:#141418;--border:#252530;--muted:#4a4a60;--text:#d8d8e8;--accent:#7c3aed;--accent2:#a78bfa;--radius:8px;--mono:"JetBrains Mono",ui-monospace,monospace}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);height:100dvh;display:flex;flex-direction:column;overflow:hidden}
header{display:flex;align-items:center;gap:12px;padding:0 18px;height:54px;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0}
#app-name{font-size:15px;font-weight:600;color:var(--accent2)}
#app-desc{font-size:12px;color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{font-size:10px;padding:2px 8px;border-radius:99px;background:#7c3aed22;color:var(--accent2);font-family:var(--mono);flex-shrink:0}
.hbtn{font-size:12px;padding:5px 12px;border-radius:var(--radius);background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer;flex-shrink:0;transition:all .15s}
.hbtn:hover{border-color:var(--accent2);color:var(--accent2)}
#messages{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:80%;padding:10px 14px;border-radius:var(--radius);font-size:13.5px;line-height:1.55}
.msg.user{align-self:flex-end;background:#7c3aed28;border:1px solid #7c3aed44}
.msg.assistant{align-self:flex-start;background:var(--surface);border:1px solid var(--border)}
.msg.system{align-self:center;color:var(--muted);font-size:12px;font-style:italic}
.msg.error{align-self:center;color:#f87171;font-size:12px}
.typing{opacity:.5}
.input-row{display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--border);flex-shrink:0}
.input-row textarea{flex:1;resize:none;padding:8px 10px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-size:13px;font-family:inherit;outline:none;transition:border-color .15s}
.input-row textarea:focus{border-color:var(--accent)}
.input-row button{padding:8px 18px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s}
.input-row button:hover:not(:disabled){background:#6d28d9}
.input-row button:disabled{opacity:.45;cursor:not-allowed}
footer{text-align:center;font-size:11px;color:var(--muted);padding:6px;border-top:1px solid var(--border);flex-shrink:0}
footer a{color:var(--muted);text-decoration:none}
footer a:hover{color:var(--accent2)}
.embed-panel{display:none;position:fixed;inset:0;background:#00000088;z-index:100;align-items:center;justify-content:center}
.embed-panel.open{display:flex}
.embed-box{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;width:480px;max-width:90vw;display:flex;flex-direction:column;gap:12px}
.embed-box h3{font-size:14px;color:var(--accent2)}
.embed-box textarea{width:100%;height:80px;padding:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-family:var(--mono);font-size:12px;resize:none}
.embed-box .row{display:flex;gap:8px}
.embed-box button{flex:1;padding:8px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:13px;cursor:pointer}
.embed-box button.outline{background:none;border:1px solid var(--border);color:var(--text)}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border);border-radius:99px}
</style>
</head>
<body>
<header>
  <span id="app-name">Loading…</span>
  <span id="app-desc"></span>
  <span id="model-badge" class="badge" style="display:none"></span>
  <button class="hbtn" onclick="document.getElementById('embed-panel').classList.add('open')">Embed ↗</button>
  <button class="hbtn" onclick="shareConfig(this)">Share config</button>
  <a href="/apps" style="text-decoration:none"><button class="hbtn">All Apps</button></a>
</header>
<div id="messages">
  <div class="msg system" id="init-msg">Connecting…</div>
</div>
<div class="input-row">
  <textarea id="user-input" placeholder="Type a message… (Enter to send)" rows="2" disabled></textarea>
  <button id="send-btn" disabled>Send</button>
</div>
<footer>Powered by <a href="/playground.html">Aether-Lite</a></footer>

<div id="embed-panel" class="embed-panel" onclick="if(event.target===this)this.classList.remove('open')">
  <div class="embed-box">
    <h3>Embed this app</h3>
    <textarea id="embed-code" readonly></textarea>
    <div class="row">
      <button onclick="copyEmbed()">Copy code</button>
      <button class="outline" onclick="document.getElementById('embed-panel').classList.remove('open')">Close</button>
    </div>
  </div>
</div>

<script>
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
      '<iframe src="' + location.origin + '/app/' + SANDBOX_ID + '" width="420" height="640" frameborder="0" allow="microphone"></iframe>'
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
              el.textContent += ev.response
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

init()
</script>
</body>
</html>`
}

// ── Apps gallery page ─────────────────────────────────────────────────────────

const appsGalleryHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Aether-Lite — Apps</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0c0c0f;--surface:#141418;--border:#252530;--muted:#4a4a60;--text:#d8d8e8;--accent:#7c3aed;--accent2:#a78bfa;--radius:8px;--mono:"JetBrains Mono",ui-monospace,monospace}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);min-height:100dvh}
header{display:flex;align-items:center;gap:12px;padding:0 24px;height:54px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10}
header h1{font-size:15px;font-weight:600;color:var(--accent2)}
.pill{font-size:10px;padding:2px 8px;border-radius:99px;background:#7c3aed22;color:var(--accent2)}
header a{margin-left:auto;text-decoration:none}
header button{padding:6px 14px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:12px;font-weight:500;cursor:pointer}
header button:hover{background:#6d28d9}
main{max-width:1100px;margin:0 auto;padding:32px 24px}
h2{font-size:22px;font-weight:700;margin-bottom:6px}
.sub{color:var(--muted);font-size:13px;margin-bottom:28px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:10px;transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--accent);transform:translateY(-2px)}
.card-name{font-size:14px;font-weight:600}
.card-desc{font-size:12px;color:var(--muted);flex:1;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card-foot{display:flex;align-items:center;gap:8px}
.badge{font-size:10px;padding:2px 7px;border-radius:99px;background:#22234a;color:var(--accent2);font-family:var(--mono);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card-date{font-size:10px;color:var(--muted)}
.open-btn{padding:6px 14px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:12px;font-weight:500;cursor:pointer;text-decoration:none;display:inline-block}
.open-btn:hover{background:#6d28d9}
.empty{text-align:center;padding:80px 20px;color:var(--muted)}
.empty h3{font-size:18px;margin-bottom:8px;color:var(--text)}
.empty a{color:var(--accent2)}
.from-vibe{font-size:10px;padding:1px 6px;border-radius:99px;background:#34d39922;color:#34d399}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--border);border-radius:99px}
</style>
</head>
<body>
<header>
  <h1>Aether-Lite</h1>
  <span class="pill">Apps</span>
  <a href="/playground.html"><button>+ New App</button></a>
</header>
<main>
  <h2>Your Apps</h2>
  <p class="sub">AI-powered apps built with the Vibe Builder or API. Click any card to open the app.</p>
  <div id="grid" class="grid"></div>
</main>
<script>
async function load() {
  const grid = document.getElementById('grid')
  try {
    const r = await fetch('/api/sandbox')
    const d = await r.json()
    if (!d.ok || !d.data.apps.length) {
      grid.innerHTML = '<div class="empty"><h3>No apps yet</h3><p>Head to the <a href="/playground.html">Playground</a> to build your first AI app with the Vibe Builder.</p></div>'
      return
    }
    grid.innerHTML = ''
    for (const app of d.data.apps) {
      const date = new Date(app.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      const modelShort = (app.model || '').split('/').pop() || app.model
      grid.insertAdjacentHTML('beforeend', \`
        <div class="card">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="card-name">\${esc(app.name)}</span>
            \${app.fromVibe ? '<span class="from-vibe">vibe</span>' : ''}
          </div>
          <p class="card-desc">\${esc(app.description || 'No description')}</p>
          <div class="card-foot">
            <span class="badge" title="\${esc(app.model)}">\${esc(modelShort)}</span>
            <span class="card-date">\${date}</span>
          </div>
          <a href="/app/\${esc(app.id)}" class="open-btn">Open App →</a>
        </div>
      \`)
    }
  } catch(e) {
    grid.innerHTML = '<div class="empty"><h3>Failed to load apps</h3><p>' + e + '</p></div>'
  }
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

load()
</script>
</body>
</html>`

// ── Route handlers ────────────────────────────────────────────────────────────

const htmlHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
}

export const appPageRoute: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await sandboxExists(env, id)) {
    return new Response('<h1>App not found</h1>', { status: 404, headers: htmlHeaders })
  }
  return new Response(appPageHtml(id), { headers: htmlHeaders })
}

export const appsGalleryRoute: Handler = (_req, _env) =>
  Promise.resolve(new Response(appsGalleryHtml, { headers: htmlHeaders }))

export const pageRoutes: Array<[string, string, Handler]> = [
  ['GET', '/app/:id', appPageRoute],
  ['GET', '/apps',    appsGalleryRoute],
]
